/**
 * Synthetic world: gaze G (°, camera-referenced; device at 0°, forward at 40°).
 * The head rests at posture P and turns a fraction α of the way to a target;
 * the eyes do the rest. The eye estimate is eyeDeg / K_TRUE (K_TRUE ≠ the prior).
 */
import { describe, it, expect } from "vitest";
import { buildCalibration } from "../src/calibration/CalibrationModel";
import { gradeForMode } from "../src/calibration/CalibrationQuality";
import { ResponsePipeline } from "../src/detection/ResponsePipeline";
import { DEFAULTS, type Settings } from "../src/config/defaults";
import type { TrackingSample } from "../src/tracking/TrackingSample";
import { rng, gauss } from "./helpers";

const K_TRUE = 35, ALPHA = 0.6, FORWARD = 40;

function world(r: () => number, P: number, G: number, t: number, noise = 1): TrackingSample {
  const h = P + ALPHA * (G - P) + gauss(r) * 0.8 * noise;
  const eDeg = G - h + gauss(r) * 1.5 * noise;
  const eyeH = eDeg / K_TRUE;
  return {
    frameTimeMs: t, timestampMs: t, valid: true,
    features: {
      headYaw: h, noseX: 0.5 + h * 0.004 + gauss(r) * 0.002 * noise,
      lIrisH: 0.5 + eDeg * 0.004 + gauss(r) * 0.006 * noise, rIrisH: 0.5 + eDeg * 0.004 + gauss(r) * 0.006 * noise,
      lGazeH: eyeH, rGazeH: eyeH, headPitch: gauss(r) * 0.5,
    },
    gaze: { headOffH: h, headOffV: gauss(r) * 0.5, eyeH, eyeV: 0 },
    faceScale: 0.2, faceCentreX: 0.5, faceCentreY: 0.5,
  };
}
const rec = (r: () => number, P: number, G: number, n = 36) => Array.from({ length: n }, (_, i) => world(r, P, G, i * 50));

function pipe(mode: Settings["detectionMode"], model = calibrated()) {
  const settings: Settings = { ...DEFAULTS, detectionMode: mode };
  return { p: new ResponsePipeline(model, settings), settings };
}
function calibrated(extraPosture?: number) {
  const r = rng(5);
  const rSets = [rec(r, FORWARD, 0)];
  if (extraPosture !== undefined) rSets.push(rec(r, extraPosture, 0));
  return buildCalibration(rec(r, FORWARD, FORWARD), rSets, 0, 40);
}
/** Mean score of each mode while holding (P, G) for a while, after warm-up. */
function hold(p: ResponsePipeline, r: () => number, P: number, G: number, t0: number, ms: number) {
  const acc = { fixed: [] as number[], adaptive: [] as number[], eye: [] as number[] };
  let t = t0;
  for (; t < t0 + ms; t += 50) {
    const tick = p.process(world(r, P, G, t));
    for (const k of ["fixed", "adaptive", "eye"] as const) { const v = tick.c.scores?.[k]; if (v !== undefined) acc[k].push(v); }
  }
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  return { fixed: m(acc.fixed), adaptive: m(acc.adaptive), eye: m(acc.eye), t };
}

describe("eye-contact mode", () => {
  it("builds a usable model and grades it", () => {
    const m = calibrated();
    expect(m.eye.usable).toBe(true);
    expect(m.eye.forwardAngle).toBeGreaterThan(30);
    expect(["Excellent", "Good"]).toContain(gradeForMode(m, "eye").grade);
  });

  it("stays at 'forward' after a posture change that fools the fixed model", () => {
    const r = rng(8);
    const { p } = pipe("eye");
    // Client's head now rests 18° toward the device, but they still look forward (eyes compensate).
    const fwd = hold(p, r, 22, FORWARD, 0, 3000);
    expect(fwd.eye).toBeLessThan(0.35);
    expect(Math.abs(fwd.eye)).toBeLessThan(Math.abs(fwd.fixed) + 0.2);
    // Looking at the device from the new posture still reads as a response.
    const look = hold(p, r, 22, 0, fwd.t, 1500);
    expect(look.eye).toBeGreaterThan(0.7);
  });

  it("fits the eye scale from a second response posture", () => {
    const m = calibrated(15);
    expect(m.eye.kSource).toBe("fitted from postures");
    expect(Math.abs(m.eye.kH)).toBeGreaterThan(K_TRUE * 0.75);
    expect(Math.abs(m.eye.kH)).toBeLessThan(K_TRUE * 1.3);
  });

  it("refuses when forward gaze is too close to the device direction", () => {
    const r = rng(2);
    const m = buildCalibration(rec(r, 5, 5), rec(r, 5, 0), 0, 40);
    expect(m.eye.usable).toBe(false);
    const { p } = pipe("eye", m);
    p.process(world(r, 5, 5, 0));
    expect(p.modeFallback).toMatch(/adaptive/);
  });
});

describe("adaptive baseline", () => {
  it("absorbs slow drift that pushes the fixed score toward the threshold", () => {
    const r = rng(12);
    const { p } = pipe("adaptive");
    let t = 0;
    // Resting gaze drifts from 40° to 30° over 60 s (e.g. slumping toward the device side).
    for (let i = 0; i < 1200; i++, t += 50) p.process(world(r, FORWARD, FORWARD - (10 * i) / 1200, t));
    const end = hold(p, r, FORWARD, 30, t, 2000);
    expect(end.fixed).toBeGreaterThan(0.2);
    expect(end.adaptive).toBeLessThan(0.12);
    const look = hold(p, r, FORWARD, 0, end.t, 1000);
    expect(look.adaptive).toBeGreaterThan(0.7);
  });

  it("does not learn from a long look elsewhere (e.g. chatting with the clinician)", () => {
    const r = rng(13);
    const { p } = pipe("adaptive");
    const other = hold(p, r, FORWARD, 85, 0, 30000); // looking the other way for 30 s
    expect(other.adaptive).toBeLessThan(-0.5);
    const back = hold(p, r, FORWARD, FORWARD, other.t, 1500);
    expect(Math.abs(back.adaptive)).toBeLessThan(0.15); // baseline unchanged
  });

  it("caps drift toward the response direction and warns", () => {
    const r = rng(14);
    const { p } = pipe("adaptive");
    let t = 0;
    for (let i = 0; i < 4000; i++, t += 50) p.process(world(r, FORWARD, FORWARD - (20 * Math.min(1, i / 2000)), t));
    expect(Math.abs(p.drift.magnitude().along)).toBeLessThanOrEqual(0.5 + 1e-6);
    // A resting position half-way to the device is not silently accepted.
    expect(p.drift.warning).not.toBe("");
  });
});

describe("cautious mode", () => {
  it("needs both methods to agree", () => {
    const r = rng(21);
    const { p } = pipe("cautious");
    const fwd = hold(p, r, FORWARD, FORWARD, 0, 1500);
    const look = hold(p, r, FORWARD, 0, fwd.t, 1500);
    expect(p.responses).toBe(1);
    void look;
  });
});
