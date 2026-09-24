/**
 * Central configuration. Every tunable lives here; developer mode edits a live
 * copy (persisted in localStorage) and "Reset defaults" restores these values.
 */
export interface Settings {
  // Response state machine
  activationThreshold: number;
  activationDwellMs: number;
  releaseThreshold: number;
  releaseDwellMs: number;
  /** Max off-axis distance (in F→R lengths) a sample may have and still activate. 0 = gate disabled. */
  offAxisGate: number;

  // Tracking
  inferenceHz: number;
  delegate: "auto" | "GPU" | "CPU";
  cameraDeviceId: string; // "" = front camera by facingMode
  cameraResolution: number; // 480 or 720

  // Calibration
  calibrationRecordMs: number;
  calibrationSettleMs: number;

  // Test screen
  trackingLostMarker: boolean;
  trackingLostMarkerMs: number;
  exitHoldMs: number;

  // Modes
  developerMode: boolean;
  researchLogging: boolean;
  logFeatures: boolean;
  participantCode: string;
  devBeep: boolean;
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  activationThreshold: 0.7,
  activationDwellMs: 150,
  releaseThreshold: 0.35,
  releaseDwellMs: 200,
  offAxisGate: 1.0,

  inferenceHz: 20,
  delegate: "auto",
  cameraDeviceId: "",
  cameraResolution: 720,

  calibrationRecordMs: 1800,
  calibrationSettleMs: 300,

  trackingLostMarker: true,
  trackingLostMarkerMs: 2000,
  exitHoldMs: 1500,

  developerMode: false,
  researchLogging: false,
  logFeatures: false,
  participantCode: "",
  devBeep: false,
});

/** Calibration quality grading (d' of the projected score between F and R). Initial guesses. */
export const QUALITY = Object.freeze({
  excellentDPrime: 10,
  goodDPrime: 6,
  marginalDPrime: 3.5,
  excellentValidFraction: 0.9,
  goodValidFraction: 0.75,
  minValidSamples: 10,
  /** A feature is used only if |F−R| / pooled SD reaches this. */
  minFeatureSeparation: 1.5,
  /** A feature must be present in this fraction of samples of both states. */
  minFeatureAvailability: 0.7,
  /** A live sample is invalid if its available features carry less than this share of the discriminant. */
  minCoverage: 0.5,
});

/** Device-movement heuristic thresholds (forward state vs forward calibration). */
export const MOVEMENT = Object.freeze({
  maxCentreShift: 0.12, // fraction of frame
  maxScaleRatio: 1.25,
  emaSeconds: 4,
});
