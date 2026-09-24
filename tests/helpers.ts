import type { FeatureVector, TrackingSample } from "../src/tracking/TrackingSample";

/** Deterministic PRNG so tests are reproducible. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
export function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function makeSamples(n: number, mean: FeatureVector, sd: FeatureVector, r: () => number, t0 = 0): TrackingSample[] {
  const out: TrackingSample[] = [];
  for (let i = 0; i < n; i++) {
    const f: FeatureVector = {};
    for (const [k, m] of Object.entries(mean)) f[k as keyof FeatureVector] = (m as number) + gauss(r) * ((sd as any)[k] ?? 0);
    out.push({ frameTimeMs: t0 + i * 50, timestampMs: t0 + i * 50, valid: true, features: f, faceScale: 0.2, faceCentreX: 0.5, faceCentreY: 0.5 });
  }
  return out;
}
