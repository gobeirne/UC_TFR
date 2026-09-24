import { EYE } from "../config/defaults";
import type { TrackingSample } from "../tracking/TrackingSample";

/**
 * Eye-contact model: estimated angle between the client's gaze and the camera.
 *
 *   gazeH = headOffH + kH·eyeH − biasH        gazeV = headOffV + kV·eyeV − biasV
 *   angle = hypot(gazeH, gazeV)                score = 1 − angle / forwardAngle
 *
 * headOff is geometric (≈0 when the head points at the camera, whatever the
 * posture), so only three per-person numbers are learnt:
 *  - bias: what "looking at the device" measures for this person and phone;
 *  - k:    how many degrees one unit of the model's eye estimate is worth. Head
 *          and eyes both turn toward a target, which fixes k's sign. Extra
 *          response recordings in different postures fit k properly;
 *  - forwardAngle: how far the ordinary forward gaze is from the device.
 * Score uses the same scale as the other modes: ≈1 looking at the device, ≈0 forward.
 */
export interface EyeContactModel {
  kH: number; kV: number;
  biasH: number; biasV: number;
  forwardAngle: number;
  /** How k was obtained, for the developer view. */
  kSource: "fitted from postures" | "head/eye coupling" | "prior (sign assumed)";
  usable: boolean;
  problem?: string;
  fScores: number[]; rScores: number[];
  dPrime: number;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = (a: number[]) => { if (a.length < 2) return Infinity; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const clampMag = (k: number) => Math.sign(k || 1) * Math.min(EYE.maxScale, Math.max(EYE.minScale, Math.abs(k)));

interface SetMeans { H: number; V: number; E?: number; EV?: number; n: number }
function setMeans(samples: TrackingSample[]): SetMeans | null {
  const g = samples.filter((s) => s.valid && s.gaze).map((s) => s.gaze!);
  if (g.length < 5) return null;
  const e = g.map((x) => x.eyeH).filter((v): v is number => v !== undefined);
  const ev = g.map((x) => x.eyeV).filter((v): v is number => v !== undefined);
  return {
    H: median(g.map((x) => x.headOffH)), V: median(g.map((x) => x.headOffV)),
    E: e.length >= 5 ? median(e) : undefined, EV: ev.length >= 5 ? median(ev) : undefined, n: g.length,
  };
}

export function buildEyeContactModel(fSamples: TrackingSample[], rSets: TrackingSample[][], priorScale: number): EyeContactModel {
  const fail = (problem: string): EyeContactModel => ({ kH: 0, kV: 0, biasH: 0, biasV: 0, forwardAngle: 0, kSource: "prior (sign assumed)", usable: false, problem, fScores: [], rScores: [], dPrime: 0 });
  const F = setMeans(fSamples);
  const Rs = rSets.map(setMeans).filter((x): x is SetMeans => !!x);
  if (!F || !Rs.length) return fail("Head orientation was not available (the face model gave no 3-D pose).");

  const R0 = Rs[Rs.length - 1];
  const hasEyes = F.E !== undefined && Rs.every((r) => r.E !== undefined);

  // ---- k (horizontal) ----
  let kH = 0, kSource: EyeContactModel["kSource"] = "prior (sign assumed)";
  if (hasEyes) {
    const Es = Rs.map((r) => r.E!), Hs = Rs.map((r) => r.H);
    const vE = Es.length >= 2 ? sd(Es) ** 2 : 0;
    if (Rs.length >= 2 && vE > 0.03 ** 2) {
      // Every response recording looks at the same point: H + k·E ≈ const → least squares.
      const mE = mean(Es), mH = mean(Hs);
      const cov = Es.reduce((s, e, i) => s + (e - mE) * (Hs[i] - mH), 0) / (Es.length - 1);
      kH = clampMag(-cov / vE); kSource = "fitted from postures";
    } else {
      const dH = F.H - R0.H, dE = F.E! - R0.E!;
      // Head and eyes turn together toward a target, so their contributions add.
      const sign = Math.abs(dH) > 3 && Math.abs(dE) > 0.05 ? Math.sign(dH * dE) : 1;
      kH = sign * priorScale;
      kSource = sign !== 1 || (Math.abs(dH) > 3 && Math.abs(dE) > 0.05) ? "head/eye coupling" : "prior (sign assumed)";
    }
  }
  // ---- k (vertical): only when the data shows the coupling; otherwise ignore eye pitch ----
  let kV = 0;
  if (hasEyes && F.EV !== undefined && R0.EV !== undefined) {
    const dV = F.V - R0.V, dEV = F.EV - R0.EV;
    if (Math.abs(dV) > 3 && Math.abs(dEV) > 0.05) kV = Math.sign(dV * dEV) * Math.abs(kH || priorScale);
  }

  const gazeOf = (s: TrackingSample, bH: number, bV: number) => {
    const g = s.gaze!;
    const h = g.headOffH + (g.eyeH !== undefined ? kH * g.eyeH : 0) - bH;
    const v = g.headOffV + (g.eyeV !== undefined ? kV * g.eyeV : 0) - bV;
    return Math.hypot(h, v);
  };
  const allR = rSets.flat().filter((s) => s.valid && s.gaze);
  const biasH = median(allR.map((s) => s.gaze!.headOffH + (s.gaze!.eyeH !== undefined ? kH * s.gaze!.eyeH : 0)));
  const biasV = median(allR.map((s) => s.gaze!.headOffV + (s.gaze!.eyeV !== undefined ? kV * s.gaze!.eyeV : 0)));
  const fValid = fSamples.filter((s) => s.valid && s.gaze);
  const forwardAngle = median(fValid.map((s) => gazeOf(s, biasH, biasV)));

  const model: EyeContactModel = { kH, kV, biasH, biasV, forwardAngle, kSource, usable: true, fScores: [], rScores: [], dPrime: 0 };
  if (!(forwardAngle >= EYE.minForwardAngle)) {
    return { ...model, usable: false, problem: `Forward gaze is only ${forwardAngle.toFixed(0)}° from the device. Eye-contact mode needs the device further to the side.` };
  }
  const score = (s: TrackingSample) => 1 - gazeOf(s, biasH, biasV) / forwardAngle;
  model.fScores = fValid.map(score);
  model.rScores = allR.map(score);
  const sF = Math.max(sd(model.fScores), 1e-3), sR = Math.max(sd(model.rScores), 1e-3);
  model.dPrime = 1 / Math.sqrt((sF * sF + sR * sR) / 2);
  return model;
}

/** Live scorer. Holds the last eye estimate briefly so a blink doesn't blank the score. */
export class EyeContactClassifier {
  private lastEye?: { h?: number; v?: number; t: number };
  constructor(public model: EyeContactModel) {}

  classify(s: TrackingSample): { valid: boolean; score: number; angle: number } {
    const m = this.model;
    if (!m.usable || !s.valid || !s.gaze) return { valid: false, score: 0, angle: NaN };
    const g = s.gaze;
    let eh = g.eyeH, ev = g.eyeV;
    if (eh !== undefined || ev !== undefined) this.lastEye = { h: eh, v: ev, t: s.timestampMs };
    else if (m.kH !== 0 && this.lastEye && s.timestampMs - this.lastEye.t <= EYE.eyeHoldMs) { eh = this.lastEye.h; ev = this.lastEye.v; }
    else if (m.kH !== 0) return { valid: false, score: 0, angle: NaN }; // eyes needed but unavailable
    const h = g.headOffH + (eh !== undefined ? m.kH * eh : 0) - m.biasH;
    const v = g.headOffV + (ev !== undefined ? m.kV * ev : 0) - m.biasV;
    const angle = Math.hypot(h, v);
    return { valid: true, score: 1 - angle / m.forwardAngle, angle };
  }
}
