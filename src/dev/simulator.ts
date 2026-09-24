/**
 * DEV ONLY (`npm run dev`, open /?sim). Replaces face tracking with a synthetic
 * client so the whole flow can be exercised without a face or model.
 *   SPACE (hold)  look at the device
 *   ← / →         shift the client's resting posture (head turns, eyes compensate)
 *   L (hold)      tracking lost
 * Gaze is camera-referenced: device at 0°, forward at 40°. Not in production builds.
 */
import type { TrackingEngine } from "../tracking/TrackingEngine";
import type { TrackingSample } from "../tracking/TrackingSample";

export function installSimulator(engine: TrackingEngine) {
  let target = 0, look = 0, lost = false, posture = 40, last = performance.now();
  const w = window as any;
  w.__sim = {
    set look(v: number) { target = v; }, set lost(v: boolean) { lost = v; },
    set posture(v: number) { posture = v; }, get posture() { return posture; },
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { target = 1; e.preventDefault(); }
    if (e.code === "KeyL") lost = true;
    if (e.code === "ArrowLeft") posture -= 5;
    if (e.code === "ArrowRight") posture += 5;
  });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") target = 0; if (e.code === "KeyL") lost = false; });
  const n = () => (Math.random() - 0.5) * 2;
  const K = 35, ALPHA = 0.6, FORWARD = 40;
  engine.simulate = (t: number): TrackingSample => {
    const dt = Math.min(0.2, (t - last) / 1000); last = t;
    look += (target - look) * Math.min(1, dt * 12);
    if (lost) return { frameTimeMs: t, timestampMs: t, valid: false, invalidReason: "no-face", features: {} };
    const G = FORWARD * (1 - look);                 // where they're looking
    const h = posture + ALPHA * (G - posture) + n() * 0.6; // head
    const eDeg = G - h + n() * 1.2;                  // eyes do the rest
    const eyeH = eDeg / K;
    return {
      frameTimeMs: t, timestampMs: t, valid: true,
      features: {
        headYaw: h, headPitch: n() * 0.8, headRoll: n() * 0.5,
        noseX: 0.5 + h * 0.004 + n() * 0.003, noseY: 0.55 + n() * 0.004,
        lIrisH: 0.5 + eDeg * 0.004 + n() * 0.008, lIrisV: n() * 0.01,
        rIrisH: 0.5 + eDeg * 0.004 + n() * 0.008, rIrisV: n() * 0.01,
        lGazeH: eyeH + n() * 0.02, lGazeV: n() * 0.03, rGazeH: eyeH + n() * 0.02, rGazeV: n() * 0.03,
      },
      gaze: { headOffH: h, headOffV: n() * 0.8, eyeH, eyeV: n() * 0.02 },
      faceScale: 0.2, faceCentreX: 0.5, faceCentreY: 0.5,
    };
  };
  console.info("Simulator: hold SPACE to look at the device, ←/→ shift posture, hold L to lose tracking.");
}
