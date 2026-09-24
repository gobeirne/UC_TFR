import { describe, it, expect } from "vitest";
import { ResponseStateMachine, type MachineInput } from "../src/detection/ResponseStateMachine";

const params = { activationThreshold: 0.7, activationDwellMs: 150, releaseThreshold: 0.35, releaseDwellMs: 200 };
const DT = 50;

function run(scores: (number | null)[], m = new ResponseStateMachine(() => params), t0 = 0) {
  const names: string[] = [];
  scores.forEach((s, i) => {
    const inp: MachineInput = s === null ? { timestampMs: t0 + i * DT, valid: false, score: 0 } : { timestampMs: t0 + i * DT, valid: true, score: s };
    for (const tr of m.update(inp)) names.push(tr.name);
  });
  return { m, names, ons: names.filter((n) => n === "response_on").length, offs: names.filter((n) => n === "response_off").length };
}
const armed = () => { const r = run(Array(6).fill(0.05)); expect(r.m.state).toBe("FORWARD_ARMED"); return r.m; };

describe("response state machine", () => {
  it("starts unarmed and arms only after a sustained forward period", () => {
    const r = run([0.05, 0.05, 0.05]);
    expect(r.m.state).toBe("TRACKING_LOST");
    armed();
  });
  it("value below threshold → no response", () => {
    expect(run([...Array(6).fill(0.05), ...Array(20).fill(0.6)]).ons).toBe(0);
  });
  it("a single spike above threshold → no response", () => {
    expect(run([...Array(6).fill(0.05), 0.95, 0.1, 0.1]).ons).toBe(0);
  });
  it("sustained crossing → RESPONSE_ON", () => {
    expect(run([...Array(6).fill(0.05), 0.8, 0.8, 0.8, 0.8]).ons).toBe(1);
  });
  it("staying high does not retrigger, and tremor near the response position does not either", () => {
    const tremor = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.95 : 0.55));
    expect(run([...Array(6).fill(0.05), ...Array(5).fill(0.9), ...tremor]).ons).toBe(1);
  });
  it("a brief dip does not release", () => {
    const r = run([...Array(6).fill(0.05), ...Array(5).fill(0.9), 0.2, 0.2, 0.9, 0.9]);
    expect(r.offs).toBe(0);
    expect(r.m.active).toBe(true);
  });
  it("a sustained low value → RESPONSE_OFF", () => {
    expect(run([...Array(6).fill(0.05), ...Array(5).fill(0.9), ...Array(6).fill(0.1)]).offs).toBe(1);
  });
  it("rearms only after release: two separate looks = two responses", () => {
    const look = [...Array(5).fill(0.9), ...Array(6).fill(0.1)];
    expect(run([...Array(6).fill(0.05), ...look, ...look]).ons).toBe(2);
  });
  it("hovering between thresholds after a response does not rearm", () => {
    const r = run([...Array(6).fill(0.05), ...Array(5).fill(0.9), ...Array(20).fill(0.5), ...Array(5).fill(0.9)]);
    expect(r.ons).toBe(1);
  });
  it("tracking loss never creates RESPONSE_ON", () => {
    const r = run([...Array(6).fill(0.05), null, null, null, null, null, null, null]);
    expect(r.ons).toBe(0);
    expect(r.m.state).toBe("TRACKING_LOST");
  });
  it("tracking loss cancels an active response and requires forward before rearming", () => {
    const r = run([...Array(6).fill(0.05), ...Array(5).fill(0.9), null, 0.9, 0.9, 0.9, 0.9, 0.9]);
    expect(r.ons).toBe(1); expect(r.offs).toBe(1);
    expect(r.m.state).toBe("TRACKING_LOST"); // high score after loss does not re-trigger
  });
  it("off-axis samples cannot activate", () => {
    const m = armed();
    let ons = 0;
    for (let i = 0; i < 10; i++) for (const t of m.update({ timestampMs: 1000 + i * DT, valid: true, score: 0.9, canActivate: false })) if (t.name === "response_on") ons++;
    expect(ons).toBe(0);
  });
});

describe("tracking-loss grace (blinks)", () => {
  const g = { ...params, trackingLossGraceMs: 300 };
  const runG = (scores: (number | null)[]) => {
    const m = new ResponseStateMachine(() => g); const names: string[] = [];
    scores.forEach((s, i) => { for (const tr of m.update(s === null ? { timestampMs: i * DT, valid: false, score: 0 } : { timestampMs: i * DT, valid: true, score: s })) names.push(tr.name); });
    return { m, ons: names.filter((n) => n === "response_on").length, offs: names.filter((n) => n === "response_off").length };
  };
  it("a blink during a held response does not end it", () => {
    const r = runG([...Array(6).fill(0.05), ...Array(5).fill(0.9), null, null, null, 0.9, 0.9]);
    expect(r.ons).toBe(1); expect(r.offs).toBe(0); expect(r.m.active).toBe(true);
  });
  it("a longer gap still cancels the response", () => {
    const r = runG([...Array(6).fill(0.05), ...Array(5).fill(0.9), ...Array(8).fill(null)]);
    expect(r.offs).toBe(1); expect(r.m.state).toBe("TRACKING_LOST");
  });
  it("invalid data during the activation dwell can never complete a response", () => {
    const r = runG([...Array(6).fill(0.05), 0.9, null, null, null, 0.9]);
    expect(r.ons).toBe(0);
  });
  it("a blink while armed does not require re-arming", () => {
    const r = runG([...Array(6).fill(0.05), null, null, 0.05, 0.9, 0.9, 0.9, 0.9]);
    expect(r.ons).toBe(1);
  });
});

describe("hard loss (camera/app stopped)", () => {
  it("ends an active response immediately, ignoring the blink grace", () => {
    const m = new ResponseStateMachine(() => ({ ...params, trackingLossGraceMs: 300 }));
    let t = 0; const names: string[] = [];
    const feed = (i: MachineInput) => { for (const tr of m.update(i)) names.push(tr.name); };
    for (let i = 0; i < 6; i++) feed({ timestampMs: (t += DT), valid: true, score: 0.05 });
    for (let i = 0; i < 5; i++) feed({ timestampMs: (t += DT), valid: true, score: 0.9 });
    expect(m.active).toBe(true);
    feed({ timestampMs: (t += DT), valid: false, score: 0, hardLoss: true });
    expect(m.active).toBe(false);
    expect(names.filter((n) => n === "response_off").length).toBe(1);
    feed({ timestampMs: (t += DT), valid: true, score: 0.9 });
    expect(m.active).toBe(false); // must look forward before the next response
  });
});
