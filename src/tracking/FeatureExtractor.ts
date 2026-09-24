import { LM, LANDMARK_COUNT_WITH_IRIS, EDGE_CHECK_POINTS } from "./landmarks";
import type { FeatureVector, TrackingSample } from "./TrackingSample";

export interface Pt { x: number; y: number }

/** Tracker-agnostic raw input: normalized landmarks plus optional model outputs. */
export interface RawFace {
  landmarks: Pt[];              // normalized 0..1 image coordinates
  imageWidth: number;
  imageHeight: number;
  blendshapes?: Record<string, number>;
  /** 4×4 facial transformation matrix, column-major (MediaPipe's layout). */
  transform?: number[];
}

const EDGE_MARGIN = 0.01;
const BLINK_BLENDSHAPE = 0.5;
const MIN_EYE_OPENNESS = 0.12; // lid gap / eye width

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Position of P along segment A→B (0 at A, 1 at B) and signed perpendicular offset,
 * both in units of |AB|. Roll-invariant and independent of camera resolution.
 */
export function segmentCoords(p: Pt, a: Pt, b: Pt): { along: number; across: number } {
  const ab = sub(b, a), ap = sub(p, a);
  const len2 = dot(ab, ab) || 1e-9;
  return { along: dot(ap, ab) / len2, across: cross(ab, ap) / len2 };
}

/** Euler angles (degrees) from a column-major 4×4 matrix. Consistency matters, not convention. */
export function eulerFromMatrix(m: number[]): { yaw: number; pitch: number; roll: number } {
  const r = (row: number, col: number) => m[col * 4 + row];
  // Normalise columns to remove scale.
  const sx = Math.hypot(r(0, 0), r(1, 0), r(2, 0)) || 1;
  const sy = Math.hypot(r(0, 1), r(1, 1), r(2, 1)) || 1;
  const sz = Math.hypot(r(0, 2), r(1, 2), r(2, 2)) || 1;
  const R20 = r(2, 0) / sx, R21 = r(2, 1) / sy, R22 = r(2, 2) / sz;
  const R10 = r(1, 0) / sx, R00 = r(0, 0) / sx;
  const deg = 180 / Math.PI;
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -R20))) * deg,
    pitch: Math.atan2(R21, R22) * deg,
    roll: Math.atan2(R10, R00) * deg,
  };
}

export function extractFeatures(face: RawFace, frameTimeMs: number, now: number): TrackingSample {
  const n = face.landmarks;
  const base: TrackingSample = { frameTimeMs, timestampMs: now, valid: false, features: {} };
  if (!n || n.length < 468) return { ...base, invalidReason: "no-face" };

  for (const i of EDGE_CHECK_POINTS) {
    const p = n[i];
    if (p.x < EDGE_MARGIN || p.x > 1 - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > 1 - EDGE_MARGIN) {
      return { ...base, invalidReason: "face-at-edge", debugLandmarks: n };
    }
  }

  // Work in pixel-proportional space so aspect ratio does not distort geometry.
  const W = face.imageWidth || 1, H = face.imageHeight || 1;
  const P = (i: number): Pt => ({ x: n[i].x * W, y: n[i].y * H });
  const f: FeatureVector = {};

  // Head orientation from the model's 3-D transform.
  if (face.transform && face.transform.length === 16) {
    const e = eulerFromMatrix(face.transform);
    if ([e.yaw, e.pitch, e.roll].every(Number.isFinite)) {
      f.headYaw = e.yaw; f.headPitch = e.pitch; f.headRoll = e.roll;
    }
  }

  // Geometric head orientation fallback: nose relative to face outline.
  const nose = P(LM.noseTip);
  f.noseX = segmentCoords(nose, P(LM.faceRightEdge), P(LM.faceLeftEdge)).along;
  f.noseY = segmentCoords(nose, P(LM.forehead), P(LM.chin)).along;

  const bs = face.blendshapes;
  const rBlink = bs?.eyeBlinkRight ?? 0, lBlink = bs?.eyeBlinkLeft ?? 0;

  // Eyes: iris relative to the eye's own corners (image-left corner → image-right corner).
  const hasIris = n.length >= LANDMARK_COUNT_WITH_IRIS;
  const eye = (a: number, b: number, up: number, lo: number, iris: number, blink: number) => {
    const A = P(a), B = P(b);
    const width = dist(A, B);
    const openness = width > 0 ? dist(P(up), P(lo)) / width : 0;
    if (!hasIris || blink > BLINK_BLENDSHAPE || openness < MIN_EYE_OPENNESS) return null;
    return segmentCoords(P(iris), A, B);
  };
  const r = eye(LM.rEyeOuter, LM.rEyeInner, LM.rEyeUpper, LM.rEyeLower, LM.rIrisCentre, rBlink);
  if (r) { f.rIrisH = r.along; f.rIrisV = r.across; }
  const l = eye(LM.lEyeInner, LM.lEyeOuter, LM.lEyeUpper, LM.lEyeLower, LM.lIrisCentre, lBlink);
  if (l) { f.lIrisH = l.along; f.lIrisV = l.across; }

  // Model-estimated gaze from blendshapes (often more robust than raw iris position).
  if (bs) {
    const g = (k: string) => bs[k] ?? 0;
    if (lBlink <= BLINK_BLENDSHAPE) {
      f.lGazeH = g("eyeLookInLeft") - g("eyeLookOutLeft");
      f.lGazeV = g("eyeLookUpLeft") - g("eyeLookDownLeft");
    }
    if (rBlink <= BLINK_BLENDSHAPE) {
      f.rGazeH = g("eyeLookOutRight") - g("eyeLookInRight");
      f.rGazeV = g("eyeLookUpRight") - g("eyeLookDownRight");
    }
  }

  const minDim = Math.min(W, H);
  return {
    ...base,
    valid: true,
    features: f,
    faceScale: dist(P(LM.rEyeOuter), P(LM.lEyeOuter)) / minDim,
    faceCentreX: n[LM.noseTip].x,
    faceCentreY: n[LM.noseTip].y,
    debugLandmarks: n,
  };
}
