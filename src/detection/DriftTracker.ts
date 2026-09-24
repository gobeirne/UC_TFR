import { DRIFT } from "../config/defaults";
import type { CalibrationModel } from "../calibration/CalibrationModel";
import type { FeatureVector, TrackingSample } from "../tracking/TrackingSample";

/**
 * Adaptive baseline: slowly follows gradual posture drift.
 *
 * Both calibrated positions are shifted together (a rigid translation in feature
 * space), so sensitivity — the F→R distance — never changes. Only frames that
 * already look like "forward" (score within ±learnBand of the current baseline)
 * teach it, so a look at the device, a look elsewhere, or a spasm can't be
 * absorbed. Movement along the response direction is capped.
 */
export class DriftTracker {
  shift: FeatureVector = {};
  private lastT?: number;
  warning = "";

  constructor(private model: CalibrationModel, private timeConstantS: () => number) {}

  reset() { this.shift = {}; this.lastT = undefined; this.warning = ""; }

  /** Shifted forward mean to project against. */
  forwardMean(): FeatureVector {
    const out: FeatureVector = {};
    for (const [k, v] of Object.entries(this.model.F.mean)) out[k as keyof FeatureVector] = (v as number) + ((this.shift as any)[k] ?? 0);
    return out;
  }

  /** Shift expressed as (along F→R, total) in F→R lengths. */
  magnitude(): { along: number; total: number } {
    let dd = 0, sd = 0, ss = 0;
    for (const w of this.model.weights) {
      if (!w.used) continue;
      const dz = w.diff / w.pooledSd, sz = ((this.shift as any)[w.key] ?? 0) / w.pooledSd;
      dd += dz * dz; sd += sz * dz; ss += sz * sz;
    }
    if (dd <= 0) return { along: 0, total: 0 };
    return { along: sd / dd, total: Math.sqrt(ss / dd) };
  }

  update(s: TrackingSample, score: number, valid: boolean, onAxis: boolean): void {
    const t = s.timestampMs;
    const dt = this.lastT === undefined ? 0 : Math.min(0.5, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    if (!valid || !onAxis || Math.abs(score) > DRIFT.learnBand || dt === 0) return;
    const a = Math.min(1, dt / Math.max(1, this.timeConstantS()));
    const F = this.model.F.mean;
    for (const w of this.model.weights) {
      if (!w.used) continue;
      const x = s.features[w.key];
      if (x === undefined) continue;
      const cur = (this.shift as any)[w.key] ?? 0;
      (this.shift as any)[w.key] = cur + a * (x - ((F[w.key] as number) + cur));
    }
    // Cap movement toward/away from the response position.
    const m = this.magnitude();
    if (Math.abs(m.along) > DRIFT.maxAlongShift) {
      const excess = m.along - Math.sign(m.along) * DRIFT.maxAlongShift;
      for (const w of this.model.weights) if (w.used) (this.shift as any)[w.key] = ((this.shift as any)[w.key] ?? 0) - excess * w.diff;
    }
    const m2 = this.magnitude();
    this.warning = m2.total > DRIFT.warnShift || Math.abs(m2.along) >= 0.9 * DRIFT.maxAlongShift
      ? "Posture has changed a lot since calibration — consider recalibrating." : "";
  }
}
