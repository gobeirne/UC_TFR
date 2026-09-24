/**
 * DEV ONLY (`npm run dev`, open /?sim). Replaces face tracking with synthetic
 * features so the whole flow can be exercised without a face or model.
 * Hold SPACE (or touch-and-hold the lower half of the screen) = "look at device".
 * Hold L = tracking lost. Not included in production builds.
 */
import type { TrackingEngine } from "../tracking/TrackingEngine";
import type { TrackingSample } from "../tracking/TrackingSample";

export function installSimulator(engine: TrackingEngine) {
  let target = 0, look = 0, lost = false, last = performance.now();
  const w = window as any;
  w.__sim = { set look(v: number) { target = v; }, set lost(v: boolean) { lost = v; } };
  window.addEventListener("keydown", (e) => { if (e.code === "Space") { target = 1; e.preventDefault(); } if (e.code === "KeyL") lost = true; });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") target = 0; if (e.code === "KeyL") lost = false; });
  const n = () => (Math.random() - 0.5) * 2;
  engine.simulate = (t: number): TrackingSample => {
    const dt = Math.min(0.2, (t - last) / 1000); last = t;
    look += (target - look) * Math.min(1, dt * 12);
    if (lost) return { frameTimeMs: t, timestampMs: t, valid: false, invalidReason: "no-face", features: {} };
    return {
      frameTimeMs: t, timestampMs: t, valid: true,
      features: {
        headYaw: look * 18 + n() * 0.6, headPitch: n() * 0.8, headRoll: n() * 0.5,
        noseX: 0.5 + look * 0.08 + n() * 0.004, noseY: 0.55 + n() * 0.004,
        lIrisH: 0.5 + look * 0.09 + n() * 0.012, lIrisV: n() * 0.01,
        rIrisH: 0.5 + look * 0.1 + n() * 0.012, rIrisV: n() * 0.01,
        lGazeH: look * 0.5 + n() * 0.03, lGazeV: n() * 0.03, rGazeH: look * 0.5 + n() * 0.03, rGazeV: n() * 0.03,
      },
      faceScale: 0.2, faceCentreX: 0.5, faceCentreY: 0.5,
    };
  };
  console.info("Simulator active: hold SPACE to look at the device, L to lose tracking.");
}
