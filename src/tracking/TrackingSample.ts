/**
 * Platform-independent tracking representation. The classifier only ever sees this,
 * never MediaPipe objects, so the tracker can be swapped later.
 */
export const FEATURE_KEYS = [
  "headYaw", "headPitch", "headRoll",
  "noseX", "noseY",
  "lIrisH", "lIrisV", "rIrisH", "rIrisV",
  "lGazeH", "lGazeV", "rGazeH", "rGazeV",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Partial<Record<FeatureKey, number>>;

export interface FeatureInfo {
  label: string;
  group: "head" | "eye";
  /** Smallest plausible within-state SD; stops near-zero variance producing huge weights. */
  noiseFloor: number;
}

export const FEATURE_INFO: Record<FeatureKey, FeatureInfo> = {
  headYaw:   { label: "Head yaw (°)",                  group: "head", noiseFloor: 0.3 },
  headPitch: { label: "Head pitch (°)",                group: "head", noiseFloor: 0.3 },
  headRoll:  { label: "Head roll (°)",                 group: "head", noiseFloor: 0.3 },
  noseX:     { label: "Nose horizontal (geometric)",   group: "head", noiseFloor: 0.004 },
  noseY:     { label: "Nose vertical (geometric)",     group: "head", noiseFloor: 0.004 },
  lIrisH:    { label: "Left iris horizontal",          group: "eye",  noiseFloor: 0.006 },
  lIrisV:    { label: "Left iris vertical",            group: "eye",  noiseFloor: 0.006 },
  rIrisH:    { label: "Right iris horizontal",         group: "eye",  noiseFloor: 0.006 },
  rIrisV:    { label: "Right iris vertical",           group: "eye",  noiseFloor: 0.006 },
  lGazeH:    { label: "Left gaze horizontal (model)",  group: "eye",  noiseFloor: 0.01 },
  lGazeV:    { label: "Left gaze vertical (model)",    group: "eye",  noiseFloor: 0.01 },
  rGazeH:    { label: "Right gaze horizontal (model)", group: "eye",  noiseFloor: 0.01 },
  rGazeV:    { label: "Right gaze vertical (model)",   group: "eye",  noiseFloor: 0.01 },
};

export type InvalidReason = "no-face" | "face-at-edge" | "tracker-error" | "stalled" | "low-coverage";

export interface TrackingSample {
  /** performance.now() when the frame was handed to the tracker. */
  frameTimeMs: number;
  /** performance.now() after features were extracted. */
  timestampMs: number;
  valid: boolean;
  invalidReason?: InvalidReason;
  features: FeatureVector;
  /** Used for gross device-movement detection, not classification. */
  faceScale?: number;
  faceCentreX?: number;
  faceCentreY?: number;
  /** Raw landmarks, kept only in memory for the developer overlay. Never stored. */
  debugLandmarks?: { x: number; y: number }[];
}

export function invalidSample(t: number, reason: InvalidReason): TrackingSample {
  return { frameTimeMs: t, timestampMs: t, valid: false, invalidReason: reason, features: {} };
}
