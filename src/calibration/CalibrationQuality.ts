import { QUALITY } from "../config/defaults";
import type { CalibrationModel } from "./CalibrationModel";
import type { DetectionMode } from "../config/defaults";

export type Grade = "Excellent" | "Good" | "Marginal" | "Unable to distinguish";

export interface QualityReport {
  grade: Grade;
  dPrime: number;
  validFraction: number;
  usedFeatures: number;
  headShare: number; // share of discriminant from head features (rest = eyes)
  problems: string[];
  suggestions: string[];
}

const sd = (a: number[]) => {
  if (a.length < 2) return Infinity;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

export function gradeCalibration(m: Pick<CalibrationModel, "F" | "R" | "weights" | "fScores" | "rScores">): QualityReport {
  const problems: string[] = [];
  const suggestions = new Set<string>();
  const used = m.weights.filter((w) => w.used);
  const headShare = used.filter((w) => w.key.startsWith("head") || w.key.startsWith("nose")).reduce((s, w) => s + w.share, 0);

  const vf = m.F.total ? m.F.valid / m.F.total : 0;
  const vr = m.R.total ? m.R.valid / m.R.total : 0;
  const validFraction = Math.min(vf, vr);

  // Spread of the projected score within each state, in F→R units.
  const sF = Math.max(sd(m.fScores), 1e-3), sR = Math.max(sd(m.rScores), 1e-3);
  let dPrime = used.length ? 1 / Math.sqrt((sF * sF + sR * sR) / 2) : 0;
  if (!Number.isFinite(dPrime)) dPrime = 0;

  if (m.F.valid < QUALITY.minValidSamples) problems.push("Too few usable frames in the forward position.");
  if (m.R.valid < QUALITY.minValidSamples) {
    problems.push("Too few usable frames in the response position.");
    suggestions.add("The face was lost when looking at the device — move the device a little less far to the side, or ask the client to turn their head slightly toward it.");
  }
  if (vr < QUALITY.goodValidFraction && m.R.valid >= QUALITY.minValidSamples) {
    suggestions.add("Tracking was patchy in the response position — the device may be too far to the side.");
  }
  if (vf < QUALITY.goodValidFraction) suggestions.add("Tracking was patchy while looking forward — improve lighting on the face and check nothing blocks the camera.");
  if (!used.length) problems.push("No tracked feature changed consistently between the two positions.");

  let grade: Grade;
  if (problems.length) grade = "Unable to distinguish";
  else if (dPrime >= QUALITY.excellentDPrime && validFraction >= QUALITY.excellentValidFraction) grade = "Excellent";
  else if (dPrime >= QUALITY.goodDPrime && validFraction >= QUALITY.goodValidFraction) grade = "Good";
  else if (dPrime >= QUALITY.marginalDPrime) grade = "Marginal";
  else grade = "Unable to distinguish";

  if (grade === "Marginal" || grade === "Unable to distinguish") {
    suggestions.add("Move the device farther to the side (towards 45–60°).");
    suggestions.add("Ask the client to turn slightly more toward the device, if comfortable.");
    suggestions.add("Improve lighting so the face is evenly lit, then recalibrate.");
  }
  return { grade, dPrime, validFraction, usedFeatures: used.length, headShare, problems, suggestions: [...suggestions] };
}

const RANK: Grade[] = ["Unable to distinguish", "Marginal", "Good", "Excellent"];
const gradeFromDPrime = (d: number): Grade =>
  d >= QUALITY.excellentDPrime ? "Excellent" : d >= QUALITY.goodDPrime ? "Good" : d >= QUALITY.marginalDPrime ? "Marginal" : "Unable to distinguish";

export interface ModeGrade { grade: Grade; dPrime: number; problem?: string }

/** The grade that matters for the selected detection mode. */
export function gradeForMode(m: CalibrationModel, mode: DetectionMode): ModeGrade {
  const rel: ModeGrade = { grade: m.quality.grade, dPrime: m.quality.dPrime };
  const eye: ModeGrade = !m.eye.usable
    ? { grade: "Unable to distinguish", dPrime: 0, problem: m.eye.problem }
    : { grade: m.quality.problems.length ? "Unable to distinguish" : gradeFromDPrime(m.eye.dPrime), dPrime: m.eye.dPrime };
  if (mode === "fixed" || mode === "adaptive") return rel;
  if (mode === "eye") return eye;
  return RANK.indexOf(rel.grade) <= RANK.indexOf(eye.grade) ? { ...rel, problem: eye.problem } : eye;
}

export const gradeOk = (g: Grade) => g === "Excellent" || g === "Good";
