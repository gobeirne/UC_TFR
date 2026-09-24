import { describe, it, expect } from "vitest";
import { OutputManager } from "../src/outputs/OutputManager";
import type { ResponseEvent, ResponseOutput } from "../src/outputs/ResponseOutput";

class Counter implements ResponseOutput {
  on = 0; off = 0;
  constructor(public name: string, private fail = false) {}
  onResponseStart(_e: ResponseEvent) { if (this.fail) throw new Error("boom"); this.on++; }
  onResponseEnd(_e: ResponseEvent) { if (this.fail) throw new Error("boom"); this.off++; }
}
const ev = (type: ResponseEvent["type"]): ResponseEvent => ({ type, timestampMs: 1, frameTimeMs: 1, score: 1 });

describe("output manager", () => {
  it("delivers RESPONSE_ON and RESPONSE_OFF once to every enabled output", () => {
    const m = new OutputManager(); const a = new Counter("a"), b = new Counter("b");
    m.add(a); m.add(b);
    m.dispatch(ev("response-on")); m.dispatch(ev("response-off"));
    expect([a.on, a.off, b.on, b.off]).toEqual([1, 1, 1, 1]);
  });
  it("respects disabling", () => {
    const m = new OutputManager(); const a = new Counter("a");
    m.add(a); m.setEnabled("a", false); m.dispatch(ev("response-on"));
    expect(a.on).toBe(0);
  });
  it("isolates a failing output", () => {
    const m = new OutputManager(); const bad = new Counter("bad", true), good = new Counter("good");
    m.add(bad); m.add(good);
    expect(() => m.dispatch(ev("response-on"))).not.toThrow();
    expect(good.on).toBe(1); expect(m.errors.length).toBe(1);
  });
});
