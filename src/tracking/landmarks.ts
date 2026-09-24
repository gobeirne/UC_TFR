/**
 * The ONLY place canonical MediaPipe Face Mesh landmark indices appear.
 * "Right"/"left" are the subject's own right/left (the subject's right eye
 * appears on the image-left of an unmirrored camera frame). Direction labels do
 * not matter for classification, because calibration establishes direction.
 */
export const LM = Object.freeze({
  // Subject's right eye
  rEyeOuter: 33,
  rEyeInner: 133,
  rEyeUpper: 159,
  rEyeLower: 145,
  rIrisCentre: 468, // 469–472 are the iris ring

  // Subject's left eye
  lEyeInner: 362,
  lEyeOuter: 263,
  lEyeUpper: 386,
  lEyeLower: 374,
  lIrisCentre: 473, // 474–477 are the iris ring

  noseTip: 1,
  faceRightEdge: 234, // subject's right cheek (image-left)
  faceLeftEdge: 454,
  forehead: 10,
  chin: 152,
});

/** Total landmarks including iris refinement. Fewer means iris points are unavailable. */
export const LANDMARK_COUNT_WITH_IRIS = 478;

/** Landmarks drawn in the developer overlay. */
export const OVERLAY_POINTS = [
  LM.rEyeOuter, LM.rEyeInner, LM.rEyeUpper, LM.rEyeLower,
  LM.lEyeInner, LM.lEyeOuter, LM.lEyeUpper, LM.lEyeLower,
  LM.noseTip, LM.faceRightEdge, LM.faceLeftEdge, LM.forehead, LM.chin,
];
export const OVERLAY_IRIS = [LM.rIrisCentre, LM.lIrisCentre];

/** Points that must be inside the frame for a sample to be valid. */
export const EDGE_CHECK_POINTS = [LM.faceRightEdge, LM.faceLeftEdge, LM.forehead, LM.chin, LM.noseTip];
