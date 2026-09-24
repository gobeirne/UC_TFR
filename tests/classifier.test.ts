import { describe, it, expect } from "vitest";
import { buildCalibration, projectFeatures } from "../src/calibration/CalibrationModel";
import { ResponseClassifier } from "../src/detection/ResponseClassifier";
import { makeSamples, rng } from "./helpers";
import type { TrackingSample } from "../src/tracking/TrackingSample";

const sample = (features: TrackingSample["features"]): TrackingSample => ({ frameTimeMs: 0, timestampMs: 0, valid: true, features });

describe("projection classifier", () => {
  const r = rng(42);
  const F = makeSamples(36, { headYaw: 0, lIrisH: 0.5, headPitch: 2 }, { headYaw: 0.5, lIrisH: 0.01, headPitch: 1 }, r);
  const R = makeSamples(36, { headYaw: 20, lIrisH: 0.62, headPitch: 2 }, { headYaw: 0.8, lIrisH: 0.01, headPitch: 1 }, r);
  const model = buildCalibration(F, R);
  const clf = new ResponseClassifier(model, () => 1);

  it("maps F close to 0, R close to 1 and the midpoint close to 0.5", () => {
    expect(clf.classify(sample(model.F.mean)).score).toBeCloseTo(0, 5);
    expect(clf.classify(sample(model.R.mean)).score).toBeCloseTo(1, 5);
    const mid: any = {};
    for (const k of Object.keys(model.F.mean) as (keyof typeof model.F.mean)[]) mid[k] = ((model.F.mean[k] as number) + (model.R.mean[k] as number)) / 2;
    expect(clf.classify(sample(mid)).score).toBeCloseTo(0.5, 5);
  });

  it("works when the response is in the negative direction (device on the other side)", () => {
    const r2 = rng(7);
    const F2 = makeSamples(36, { headYaw: 0, rIrisH: 0.5 }, { headYaw: 0.5, rIrisH: 0.01 }, r2);
    const R2 = makeSamples(36, { headYaw: -25, rIrisH: 0.38 }, { headYaw: 0.5, rIrisH: 0.01 }, r2);
    const m2 = buildCalibration(F2, R2);
    const c2 = new ResponseClassifier(m2, () => 1);
    expect(c2.classify(sample({ headYaw: -25, rIrisH: 0.38 })).score).toBeGreaterThan(0.9);
    expect(c2.classify(sample({ headYaw: 0, rIrisH: 0.5 })).score).toBeLessThan(0.1);
    expect(c2.classify(sample({ headYaw: 25, rIrisH: 0.62 })).score).toBeLessThan(-0.5); // looking the other way
    expect(m2.quality.grade).toBe("Excellent");
  });

  it("gives irrelevant/noisy features little or no weight", () => {
    const pitch = model.weights.find((w) => w.key === "headPitch")!;
    expect(pitch.used).toBe(false);
    const yaw = model.weights.find((w) => w.key === "headYaw")!;
    expect(yaw.used).toBe(true);
    expect(yaw.share).toBeGreaterThan(0.2);
  });

  it("ignores features that are unavailable in the calibration", () => {
    const w = model.weights.find((w) => w.key === "rGazeH")!;
    expect(w.used).toBe(false);
    expect(w.note).toBe("unavailable");
  });

  it("ignores features missing at runtime and still scores with the rest", () => {
    const p = projectFeatures({ headYaw: 20 }, model.F.mean, model.weights);
    // headYaw carries >= minCoverage of the discriminant here only if it dominates; check both paths.
    if (p.valid) expect(p.score).toBeGreaterThan(0.8);
    else expect(p.coverage).toBeLessThan(0.5);
  });

  it("declares a sample invalid when too little of the discriminant is available", () => {
    const p = projectFeatures({}, model.F.mean, model.weights);
    expect(p.valid).toBe(false);
  });

  it("flags samples far off the F→R axis (e.g. looking down) as unable to activate", () => {
    const r3 = rng(3);
    const F4 = makeSamples(36, { headYaw: 0, lIrisH: 0.5, lIrisV: 0 }, { headYaw: 0.5, lIrisH: 0.01, lIrisV: 0.01 }, r3);
    const R4 = makeSamples(36, { headYaw: 20, lIrisH: 0.62, lIrisV: 0.05 }, { headYaw: 0.5, lIrisH: 0.01, lIrisV: 0.01 }, r3);
    const m4 = buildCalibration(F4, R4);
    const c4 = new ResponseClassifier(m4, () => 1);
    const odd = c4.classify(sample({ headYaw: 20, lIrisH: 0.5, lIrisV: -0.2 }));
    expect(odd.onAxis).toBe(false);
    expect(c4.classify(sample({ headYaw: 20, lIrisH: 0.62, lIrisV: 0.05 })).onAxis).toBe(true);
  });

  it("grades indistinguishable positions as unable to distinguish", () => {
    const r5 = rng(9);
    const F5 = makeSamples(36, { headYaw: 0, lIrisH: 0.5 }, { headYaw: 2, lIrisH: 0.03 }, r5);
    const R5 = makeSamples(36, { headYaw: 0.5, lIrisH: 0.505 }, { headYaw: 2, lIrisH: 0.03 }, r5);
    expect(buildCalibration(F5, R5).quality.grade).toBe("Unable to distinguish");
  });

  it("rejects transient outliers in calibration", () => {
    const r6 = rng(11);
    const F6 = makeSamples(36, { headYaw: 0 }, { headYaw: 0.5 }, r6);
    F6[10].features.headYaw = 40; // glitch frame
    const R6 = makeSamples(36, { headYaw: 20 }, { headYaw: 0.5 }, r6);
    const m6 = buildCalibration(F6, R6);
    expect(Math.abs(m6.F.mean.headYaw!)).toBeLessThan(0.5);
  });
});
