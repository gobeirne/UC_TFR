/**
 * Central configuration. Every tunable lives here; developer mode edits a live
 * copy (persisted in localStorage) and "Reset defaults" restores these values.
 */
export type DetectionMode = "fixed" | "adaptive" | "eye" | "cautious";

export const MODE_INFO: Record<DetectionMode, { name: string; short: string; description: string }> = {
  fixed: {
    name: "Fixed calibration",
    short: "Fixed",
    description: "Compares each moment with the two calibrated positions. Most predictable; best when the client can hold a steady posture.",
  },
  adaptive: {
    name: "Adaptive baseline",
    short: "Adaptive",
    description: "Like fixed, but slowly follows gradual posture drift while the client is looking forward. Sudden movements and long looks elsewhere are ignored.",
  },
  eye: {
    name: "Eye contact",
    short: "Eye contact",
    description: "Estimates whether the client's gaze points at the camera, whatever their posture. Needs the face well lit; noisier with glasses.",
  },
  cautious: {
    name: "Cautious (both agree)",
    short: "Cautious",
    description: "A response needs both the adaptive and eye-contact methods to agree. Fewest false responses; may miss weak looks.",
  },
};

export interface Settings {
  // Response state machine
  activationThreshold: number;
  activationDwellMs: number;
  releaseThreshold: number;
  releaseDwellMs: number;
  /** Max off-axis distance (in F→R lengths) a sample may have and still activate. 0 = gate disabled. */
  offAxisGate: number;
  /** Invalid frames shorter than this (blinks) hold the current state instead of cancelling it. */
  trackingLossGraceMs: number;

  // Detection mode (see README "Detection modes")
  detectionMode: DetectionMode;
  /** Adaptive baseline: time constant of the slow drift follower, seconds. */
  driftTimeConstantS: number;
  /** Eye-contact mode: prior degrees of eye rotation per blendshape unit (refined by extra response recordings). */
  eyeScaleDeg: number;

  // Tracking
  inferenceHz: number;
  delegate: "auto" | "GPU" | "CPU";
  /** How frames reach the tracker: the live video element, or a copied still (works around some iOS video-texture problems). */
  inputMode: "video" | "canvas";
  /** Let the app supply the tracker's canvas (context-loss detection). "auto" = off on iPhone/iPad. */
  trackerCanvas: "auto" | "on" | "off";
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
  trackingLossGraceMs: 300,

  detectionMode: "adaptive",
  driftTimeConstantS: 20,
  eyeScaleDeg: 40,

  inferenceHz: 20,
  delegate: "auto",
  inputMode: "video",
  trackerCanvas: "auto",
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

/** Adaptive baseline safety limits. */
export const DRIFT = Object.freeze({
  /** Only frames scoring within ±this of the (current) forward baseline teach the baseline. */
  learnBand: 0.3,
  /** Max baseline shift along the forward→response direction, in F→R lengths. */
  maxAlongShift: 0.5,
  /** Total baseline shift (any direction, F→R lengths) that triggers a "consider recalibrating" warning. */
  warnShift: 0.8,
});

/** Eye-contact mode limits. */
export const EYE = Object.freeze({
  /** Smallest usable angle between forward gaze and the device, degrees. */
  minForwardAngle: 8,
  /** Eye features may be missing (blink) this long before the eye estimate is invalid, ms. */
  eyeHoldMs: 400,
  minScale: 10, maxScale: 90,
});

/** Device-movement heuristic thresholds (forward state vs forward calibration). */
export const MOVEMENT = Object.freeze({
  maxCentreShift: 0.12, // fraction of frame
  maxScaleRatio: 1.25,
  emaSeconds: 4,
});
