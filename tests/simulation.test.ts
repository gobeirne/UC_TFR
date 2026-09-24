/**
 * Synthetic harness: feeds a score sequence through the state machine and prints
 * the timeline. Run with `npm run simulate`. Edit SEQUENCE to explore settings.
 */
import { it, expect } from "vitest";
import { ResponseStateMachine } from "../src/detection/ResponseStateMachine";
import { DEFAULTS } from "../src/config/defaults";

const SEQUENCE = [0.05, 0.05, 0.05, 0.05, 0.05, 0.08, 0.12, 0.73, 0.78, 0.85, 0.91, 0.88, 0.40, 0.28, 0.12, 0.10, 0.08, 0.06, 0.05];
const DT = 50; // ms between samples (20 Hz)

it("synthetic score sequence", () => {
  const m = new ResponseStateMachine(() => DEFAULTS);
  const lines: string[] = [];
  SEQUENCE.forEach((score, i) => {
    const trs = m.update({ timestampMs: i * DT, valid: true, score });
    lines.push(`${String(i * DT).padStart(5)} ms  score ${score.toFixed(2)}  ${m.state.padEnd(18)} ${trs.map((t) => t.name).join(", ")}`);
  });
  console.log(lines.join("\n"));
  expect(lines.some((l) => l.includes("response_on"))).toBe(true);
  expect(lines.some((l) => l.includes("response_off"))).toBe(true);
});
