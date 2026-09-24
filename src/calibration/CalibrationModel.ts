import { QUALITY } from "../config/defaults";
import { FEATURE_INFO, FEATURE_KEYS, type FeatureKey, type FeatureVector, type TrackingSample } from "../tracking/TrackingSample";
import { gradeCalibration, type QualityReport } from "./CalibrationQuality";

export interface StateStats {
  total: number;          // samples recorded, including invalid
  valid: number;          // valid samples
  mean: FeatureVector;
  sd: FeatureVector;
  availability: FeatureVector; // fraction of valid samples with the feature present
  faceScale?: number;
  faceCentreX?: number;
  faceCentreY?: number;
}

export interface FeatureWeight {
  key: FeatureKey;
  label: string;
  diff: number;        // R − F
  pooledSd: number;    // floored within-state SD
  separation: number;  // |diff| / pooledSd  (per-feature d', capped at 10 by the floor)
  rawSeparation: number; // |diff| / measured SD (uncapped, for display)
  used: boolean;
  share: number;       // fraction of total discriminant power (0..1)
  note?: string;
}

export interface CalibrationModel {
  F: StateStats;
  R: StateStats;
  weights: FeatureWeight[];
  /** Scores of the calibration samples themselves, for the quality check. */
  fScores: number[];
  rScores: number[];
  /** 95th percentile off-axis distance seen during calibration. */
  offAxisP95: number;
  quality: QualityReport;
  createdAt: number;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const percentile = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const meanOf = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sdOf = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = meanOf(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/** Drop values more than 3.5 robust SDs from the median (transient outliers). */
function robustValues(values: number[], floor: number): number[] {
  if (values.length < 5) return values;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;
  const lim = 3.5 * Math.max(mad, floor);
  return values.filter((v) => Math.abs(v - med) <= lim);
}

export function summarise(samples: TrackingSample[]): StateStats {
  const valid = samples.filter((s) => s.valid);
  const stats: StateStats = { total: samples.length, valid: valid.length, mean: {}, sd: {}, availability: {} };
  for (const k of FEATURE_KEYS) {
    const raw = valid.map((s) => s.features[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    stats.availability[k] = valid.length ? raw.length / valid.length : 0;
    if (raw.length < 3) continue;
    const vals = robustValues(raw, FEATURE_INFO[k].noiseFloor);
    stats.mean[k] = meanOf(vals);
    stats.sd[k] = sdOf(vals);
  }
  const geo = (f: (s: TrackingSample) => number | undefined) => {
    const v = valid.map(f).filter((x): x is number => typeof x === "number");
    return v.length ? median(v) : undefined;
  };
  stats.faceScale = geo((s) => s.faceScale);
  stats.faceCentreX = geo((s) => s.faceCentreX);
  stats.faceCentreY = geo((s) => s.faceCentreY);
  return stats;
}

/**
 * Diagonal Fisher discriminant between F and R.
 * Each feature is standardised by its pooled within-state SD (with floors), so a
 * feature's influence ∝ separation / noise. Direction comes from the data, so the
 * device can be on either side and any sign convention works.
 */
export function computeWeights(F: StateStats, R: StateStats): FeatureWeight[] {
  const out: FeatureWeight[] = [];
  for (const k of FEATURE_KEYS) {
    const info = FEATURE_INFO[k];
    const w: FeatureWeight = { key: k, label: info.label, diff: 0, pooledSd: info.noiseFloor, separation: 0, rawSeparation: 0, used: false, share: 0 };
    const fm = F.mean[k], rm = R.mean[k];
    if (fm === undefined || rm === undefined) { w.note = "unavailable"; out.push(w); continue; }
    if ((F.availability[k] ?? 0) < QUALITY.minFeatureAvailability || (R.availability[k] ?? 0) < QUALITY.minFeatureAvailability) {
      w.note = "often missing"; out.push(w); continue;
    }
    w.diff = rm - fm;
    const pooled = Math.sqrt(((F.sd[k] ?? 0) ** 2 + (R.sd[k] ?? 0) ** 2) / 2);
    // Floors: instrument noise floor, and 10% of the separation so no single
    // unusually quiet feature dominates (caps per-feature d' at 10).
    w.pooledSd = Math.max(pooled, info.noiseFloor, 0.1 * Math.abs(w.diff));
    w.separation = Math.abs(w.diff) / w.pooledSd;
    w.rawSeparation = Math.abs(w.diff) / Math.max(pooled, info.noiseFloor);
    if (w.separation >= QUALITY.minFeatureSeparation) w.used = true;
    else w.note = "no consistent difference";
    out.push(w);
  }
  const total = out.filter((w) => w.used).reduce((s, w) => s + w.separation ** 2, 0);
  for (const w of out) if (w.used && total > 0) w.share = w.separation ** 2 / total;
  return out;
}

export function buildCalibration(fSamples: TrackingSample[], rSamples: TrackingSample[], now = 0): CalibrationModel {
  const F = summarise(fSamples);
  const R = summarise(rSamples);
  const weights = computeWeights(F, R);
  const partial = { F, R, weights } as CalibrationModel;
  // Local import avoided circularity: projection lives in ResponseClassifier, but
  // the maths is tiny, so evaluate calibration samples here directly.
  const proj = (s: TrackingSample) => projectFeatures(s.features, F.mean, weights);
  const fp = fSamples.filter((s) => s.valid).map(proj).filter((p) => p.valid);
  const rp = rSamples.filter((s) => s.valid).map(proj).filter((p) => p.valid);
  partial.fScores = fp.map((p) => p.score);
  partial.rScores = rp.map((p) => p.score);
  partial.offAxisP95 = percentile([...fp, ...rp].map((p) => p.offAxis), 95) || 0;
  partial.quality = gradeCalibration(partial);
  partial.createdAt = now;
  return partial;
}

export interface Projection { valid: boolean; score: number; offAxis: number; coverage: number }

/**
 * score  = z·dz / |dz|²     (0 at F, 1 at R, unbounded)
 * offAxis = |z − score·dz| / |dz|   (distance from the F→R line, in F→R lengths)
 * where z = (x − F)/sd and dz = (R − F)/sd over *available* used features.
 */
export function projectFeatures(x: FeatureVector, Fmean: FeatureVector, weights: FeatureWeight[]): Projection {
  let dd = 0, zd = 0, zz = 0, ddAll = 0;
  for (const w of weights) {
    if (!w.used) continue;
    const dz = w.diff / w.pooledSd;
    ddAll += dz * dz;
    const v = x[w.key];
    if (v === undefined || !Number.isFinite(v)) continue;
    const z = (v - (Fmean[w.key] as number)) / w.pooledSd;
    dd += dz * dz; zd += z * dz; zz += z * z;
  }
  const coverage = ddAll > 0 ? dd / ddAll : 0;
  if (dd <= 0 || coverage < QUALITY.minCoverage) return { valid: false, score: 0, offAxis: 0, coverage };
  const score = zd / dd;
  const perp2 = Math.max(0, zz - score * score * dd);
  return { valid: true, score, offAxis: Math.sqrt(perp2 / dd), coverage };
}
