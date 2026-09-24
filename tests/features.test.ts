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
