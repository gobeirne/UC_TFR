import type { App } from "./app";
import { h } from "./dom";
import { OVERLAY_IRIS, OVERLAY_POINTS } from "../tracking/landmarks";
import type { TrackingSample } from "../tracking/TrackingSample";

/**
 * Mirrored live camera preview with optional face guide and landmark overlay.
 * Shown to the clinician during setup only; never in test mode.
 */
export function createPreview(app: App, opts: { guide?: boolean; landmarks?: boolean; small?: boolean } = {}) {
  const canvas = h("canvas", { class: "preview-overlay" });
  const wrap = h("div", { class: `preview${opts.small ? " small" : ""}` }, canvas);
  if (opts.guide) wrap.append(h("div", { class: "face-guide" }));
  app.camera.mount(wrap, "preview-video");
  wrap.insertBefore(app.camera.video, canvas);

  let last: TrackingSample | undefined;
  const unsub = app.engine.subscribe((s) => { last = s; });
  let raf = 0;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    const v = app.camera.video;
    if (!v.videoWidth) return;
    if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      wrap.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    }
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    wrap.dataset.face = last?.valid ? "yes" : "no";
    if (!opts.landmarks || !last?.debugLandmarks) return;
    const L = last.debugLandmarks, W = canvas.width, H = canvas.height;
    const r = Math.max(2, W / 320);
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < L.length; i += 3) g.fillRect(L[i].x * W - 1, L[i].y * H - 1, 2, 2);
    g.fillStyle = "#6cc4ff";
    for (const i of OVERLAY_POINTS) { const p = L[i]; if (p) { g.beginPath(); g.arc(p.x * W, p.y * H, r, 0, 7); g.fill(); } }
    g.fillStyle = "#ff5ad1";
    for (const i of OVERLAY_IRIS) { const p = L[i]; if (p) { g.beginPath(); g.arc(p.x * W, p.y * H, r * 1.5, 0, 7); g.fill(); } }
  };
  draw();
  return { el: wrap, dispose: () => { cancelAnimationFrame(raf); unsub(); } };
}
