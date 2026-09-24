import { projectFeatures, type CalibrationModel } from "../calibration/CalibrationModel";
import type { TrackingSample } from "../tracking/TrackingSample";

export interface Classification {
  valid: boolean;
  score: number;      // 0 ≈ forward, 1 ≈ response
  offAxis: number;    // distance from the calibrated F→R line, in F→R lengths
  /** False when the sample is too far off the F→R line to count as a response (e.g. looking down). */
  onAxis: boolean;
  coverage: number;
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

  classify(s: TrackingSample): Classification {
    if (!s.valid) return { valid: false, score: 0, offAxis: 0, onAxis: false, coverage: 0 };
    const p = projectFeatures(s.features, this.model.F.mean, this.model.weights);
    return { ...p, onAxis: p.offAxis <= this.effectiveGate() };
  }
}
