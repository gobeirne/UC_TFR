import { describe, it, expect } from "vitest";
import { segmentCoords, eulerFromMatrix } from "../src/tracking/FeatureExtractor";

describe("feature geometry", () => {
  it("segment coordinates are roll-invariant", () => {
    const a = segmentCoords({ x: 0.5, y: 0.1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    const ang = 0.6, rot = (p: { x: number; y: number }) => ({ x: p.x * Math.cos(ang) - p.y * Math.sin(ang), y: p.x * Math.sin(ang) + p.y * Math.cos(ang) });
    const b = segmentCoords(rot({ x: 0.5, y: 0.1 }), rot({ x: 0, y: 0 }), rot({ x: 1, y: 0 }));
    expect(b.along).toBeCloseTo(a.along, 9); expect(b.across).toBeCloseTo(a.across, 9);
  });
  it("identity matrix gives zero angles; a yaw rotation changes only yaw", () => {
    const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const e = eulerFromMatrix(I);
    expect(Math.abs(e.yaw) + Math.abs(e.pitch) + Math.abs(e.roll)).toBeCloseTo(0, 9);
    const t = (20 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    // rotation about Y, column-major
    const Ry = [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
    const e2 = eulerFromMatrix(Ry);
    expect(Math.abs(e2.yaw)).toBeCloseTo(20, 6);
    expect(Math.abs(e2.pitch)).toBeCloseTo(0, 6);
  });
});

import { headToCamera, matrixAccessor } from "../src/tracking/FeatureExtractor";

/** Column-major 4×4 from a yaw rotation (about Y) and translation. */
function pose(yawDeg: number, tx: number, tz = -50): number[] {
  const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, 0, tz, 1];
}

describe("head-to-camera angle", () => {
  it("detects column- and row-major layouts", () => {
    const m = pose(10, 5);
    const rowMajor = [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]));
    expect(matrixAccessor(m)(0, 3)).toBeCloseTo(5);
    expect(matrixAccessor(rowMajor)(0, 3)).toBeCloseTo(5);
  });
  it("is ~0 when the head points at the camera, even off-centre in the frame", () => {
    expect(Math.abs(headToCamera(pose(0, 0))!.h)).toBeLessThan(0.01);
    // Face 20 cm to the side, turned to point back at the camera:
    const turn = (Math.atan2(20, 50) * 180) / Math.PI;
    const a = headToCamera(pose(-turn, 20))!.h, b = headToCamera(pose(turn, 20))!.h;
    expect(Math.min(Math.abs(a), Math.abs(b))).toBeLessThan(0.5);
  });
  it("grows with head rotation away from the camera", () => {
    const h30 = Math.abs(headToCamera(pose(30, 0))!.h);
    expect(h30).toBeGreaterThan(29); expect(h30).toBeLessThan(31);
  });
});
