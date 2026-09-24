import { projectFeatures, type CalibrationModel } from "../calibration/CalibrationModel";
import type { FeatureVector, TrackingSample } from "../tracking/TrackingSample";

export interface Classification {
  valid: boolean;
  score: number;      // 0 ≈ forward, 1 ≈ response
  offAxis: number;    // distance from the calibrated F→R line, in F→R lengths
  /** False when the sample is too far off the F→R line to count as a response (e.g. looking down). */
  onAxis: boolean;
  coverage: number;
  /** Every mode's score this frame (for comparison graphs); undefined = invalid. */
  scores?: { fixed?: number; adaptive?: number; eye?: number; eyeAngle?: number };
}

/** Personalised projection classifier. Knows nothing about screens or outputs. */
export class ResponseClassifier {
  constructor(public readonly model: CalibrationModel, private gate: () => number) {}

  /** Effective gate: configured value, widened if calibration itself was noisier than that. */
  effectiveGate(): number {
    const g = this.gate();
    if (g <= 0) return Infinity;
    return Math.max(g, 3 * this.model.offAxisP95);
  }

  /** fMean: an adapted forward baseline (adaptive mode); defaults to the calibrated one. */
  classify(s: TrackingSample, fMean: FeatureVector = this.model.F.mean): Classification {
    if (!s.valid) return { valid: false, score: 0, offAxis: 0, onAxis: false, coverage: 0 };
    const p = projectFeatures(s.features, fMean, this.model.weights);
    return { ...p, onAxis: p.offAxis <= this.effectiveGate() };
  }
}
