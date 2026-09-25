import type { Screen } from "./app";
import { h, fmt } from "./dom";
import { createPreview } from "./Preview";
import { CameraError } from "../camera/CameraManager";
import { detectCapabilities, isIOS, isStandalone } from "../platform/capabilities";
import type { TrackerConfig } from "../tracking/MediaPipeFaceTracker";

interface TestConfig extends TrackerConfig { input: "video" | "canvas"; label: string }
interface TestResult { cfg: TestConfig; started: boolean; faces: number; tries: number; errors: number; ms: number; note: string }

const CONFIGS: TestConfig[] = [
  { delegate: "GPU", ownCanvas: true, input: "video", label: "GPU, app canvas, live video" },
  { delegate: "GPU", ownCanvas: false, input: "video", label: "GPU, live video" },
  { delegate: "GPU", ownCanvas: false, input: "canvas", label: "GPU, copied frame" },
  { delegate: "CPU", ownCanvas: false, input: "video", label: "CPU, live video" },
  { delegate: "CPU", ownCanvas: false, input: "canvas", label: "CPU, copied frame" },
];
const TRIES = 12;

/**
 * Step-by-step check of camera → video element → frame content → tracker.
 * Everything stays on the device; the copyable report contains no images.
 */
export const DiagnosticsScreen: Screen = (app) => {
  const e = app.engine, cam = app.camera, t = e.tracker;
  const ownsCamera = !app.session; // started here → stop again on leaving
  const statusLine = h("p", { class: "status" }, "Starting camera and tracker…");
  const checks = h("dl", { class: "readout small diag" });
  const snap = h("canvas", { class: "diag-snap", width: 160, height: 120 });
  const results = h("div");
  const reportBox = h("textarea", { class: "diag-report", readonly: true, rows: 8 });
  const testBtn = h("button", { class: "primary", disabled: true }, "Run tracker self-test (about 20 s)");
  let preview: ReturnType<typeof createPreview> | undefined;
  const previewHolder = h("div");
  let lastResults: TestResult[] = [];
  let brightness = NaN;
  let alive = true;

  const row = (label: string, value: string, state: "ok" | "warn" | "bad" | "" = "") => [h("dt", {}, label), h("dd", { class: state }, value)];

  const measureBrightness = () => {
    const v = cam.video;
    if (!v.videoWidth) { brightness = NaN; return; }
    const g = snap.getContext("2d", { willReadFrequently: true })!;
    const w = snap.width, hh = Math.round((w * v.videoHeight) / v.videoWidth);
    if (snap.height !== hh) snap.height = hh;
    g.drawImage(v, 0, 0, w, hh); // unmirrored: what the tracker receives
    const d = g.getImageData(0, 0, w, hh).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 16) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    brightness = sum / (d.length / 16);
  };

  const collect = (): [string, string, "ok" | "warn" | "bad" | ""][] => {
    const st = e.stats();
    const track = cam.stream?.getVideoTracks()[0];
    const ts = track?.getSettings() ?? {};
    const v = cam.video;
    const out = st.outcomes, total = Object.values(out).reduce((a, b) => a + b, 0);
    const pct = (k: string) => (total ? `${Math.round(((out[k] ?? 0) / total) * 100)}%` : "—");
    return [
      ["App version", __APP_VERSION__, ""],
      ["Device", `${isIOS() ? "iPhone/iPad" : navigator.platform || "?"}${isStandalone() ? ", Home Screen app" : ", browser"}`, ""],
      ["Camera stream", !track ? "none" : `${track.readyState}${track.muted ? ", MUTED" : ""}${track.enabled ? "" : ", disabled"}`, !track ? "bad" : track.readyState === "live" && !track.muted ? "ok" : "bad"],
      ["Camera settings", track ? `${ts.width ?? "?"}×${ts.height ?? "?"} @ ${ts.frameRate ? Math.round(ts.frameRate) : "?"} fps, ${ts.facingMode ?? "facing ?"}` : "—", ""],
      ["Video element", `${v.paused ? "PAUSED — tap the screen to resume" : "playing"}, readyState ${v.readyState}, ${v.videoWidth}×${v.videoHeight}`, v.paused || v.readyState < 2 || !v.videoWidth ? "bad" : "ok"],
      ["Video play() error", cam.lastPlayError || "none", cam.lastPlayError ? "bad" : "ok"],
      !st.frameCounter && st.loop === "rAF"
        ? ["New camera frames", "not measurable in this browser (analysing at the inference rate)", ""]
        : ["New camera frames", `${st.cameraFps}/s (${st.loop})`, st.cameraFps >= 5 ? "ok" : st.cameraFps > 0 ? "warn" : "bad"],
      ["Frame brightness", Number.isFinite(brightness) ? `${fmt(brightness, 0)} / 255${brightness < 8 ? " — BLACK FRAMES" : brightness < 40 ? " — very dark" : ""}` : "—", !Number.isFinite(brightness) ? "" : brightness < 8 ? "bad" : brightness < 40 ? "warn" : "ok"],
      ["Tracker", t.ready ? `${t.delegate}, ${t.ownCanvas ? "app canvas" : "own canvas"}, input: ${st.inputMode === "canvas" ? "copied frame" : "live video"}` : "not loaded", t.ready ? "ok" : "bad"],
      ["Model / engine", `${t.modelSource || "?"} (${fmt(t.modelBytes / 1e6, 1)} MB), ${t.wasmPath || "?"}`, t.modelBytes > 1e6 ? "ok" : "warn"],
      ["Inference", `${st.inferenceFps}/s, ${fmt(st.inferenceMsAvg, 1)} ms avg, ${st.errors} errors`, st.inferenceFps > 0 ? "ok" : "bad"],
      ["Last 5 s", total ? `face ${pct("face")}, no face ${pct("no-face")}, at edge ${pct("face-at-edge")}, errors ${pct("tracker-error")}` : "no results yet", total && (out.face ?? 0) > 0 ? "ok" : total ? "bad" : ""],
      ["Frame size analysed", t.lastSourceSize || "—", ""],
      ["Last tracker error", st.lastError || "none", st.lastError ? "warn" : "ok"],
      ["Recoveries", st.log.length ? st.log.slice(-4).map((x) => `${x.action} (${x.reason})`).join("; ") : "none", st.gaveUp ? "bad" : st.log.length ? "warn" : "ok"],
    ];
  };

  const render = () => {
    measureBrightness();
    checks.replaceChildren(...collect().flatMap(([a, b, c]) => row(a, b, c)));
  };

  const reportText = () => {
    const lines = ["Touch-free response diagnostics", new Date().toISOString(), ...collect().map(([a, b]) => `${a}: ${b}`)];
    lines.push(`Settings: delegate=${app.settings.delegate}, trackerCanvas=${app.settings.trackerCanvas}, inputMode=${app.settings.inputMode}, resolution=${app.settings.cameraResolution}, hz=${app.settings.inferenceHz}`);
    if (lastResults.length) {
      lines.push("Self-test:");
      for (const r of lastResults) lines.push(`  ${r.cfg.label}: ${r.started ? `${r.faces}/${r.tries} faces, ${r.errors} errors, ${fmt(r.ms, 0)} ms` : "did not start"}${r.note ? ` — ${r.note}` : ""}`);
    }
    lines.push(`Capabilities: ${detectCapabilities().map((c) => `${c.name}=${c.ok ? "y" : "n"}`).join(", ")}`);
    lines.push(`User agent: ${navigator.userAgent}`);
    lines.push(`Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x, SW controlled: ${!!navigator.serviceWorker?.controller}`);
    return lines.join("\n");
  };

  const runSelfTest = async () => {
    testBtn.disabled = true;
    const original = { ...t.config };
    e.paused = true;
    lastResults = [];
    const tbl = h("table", { class: "features" }, h("tr", {}, ...["Setup", "Faces found", "Errors", "Time"].map((x) => h("th", {}, x))));
    results.replaceChildren(h("p", { class: "status" }, "Testing… keep your face in view of the camera."), tbl);
    for (const cfg of CONFIGS) {
      if (!alive) return;
      const r: TestResult = { cfg, started: false, faces: 0, tries: 0, errors: 0, ms: 0, note: "" };
      try { await t.rebuild({ delegate: cfg.delegate, ownCanvas: cfg.ownCanvas }); r.started = t.delegate === cfg.delegate; if (!r.started) r.note = "fell back to CPU"; }
      catch (err) { r.note = `start failed: ${(err as Error)?.message ?? err}`; }
      if (r.started) {
        let msSum = 0;
        for (let i = 0; i < TRIES; i++) {
          await new Promise((res) => setTimeout(res, 90));
          const t0 = performance.now();
          try {
            const src = cfg.input === "canvas" ? e.frameToCanvas() : cam.video;
            const d = t.detect(src, performance.now());
            if (d.faces > 0) r.faces++;
          } catch (err) { r.errors++; r.note = String((err as Error)?.message ?? err).slice(0, 80); }
          msSum += performance.now() - t0; r.tries++;
        }
        r.ms = msSum / Math.max(1, r.tries);
      }
      lastResults.push(r);
      tbl.append(h("tr", {}, h("td", {}, cfg.label),
        h("td", { class: r.faces > TRIES / 2 ? "ok" : r.faces ? "warn" : "bad" }, r.started ? `${r.faces}/${r.tries}` : "—"),
        h("td", {}, r.started ? String(r.errors) : r.note), h("td", {}, r.started ? `${fmt(r.ms, 0)} ms` : "")));
    }
    // Pick the best: most faces, then fewest errors, then fastest; prefer the app canvas when tied (it enables context-loss detection).
    const best = [...lastResults].filter((r) => r.started && r.faces > 0)
      .sort((a, b) => b.faces - a.faces || a.errors - b.errors || Number(b.cfg.ownCanvas) - Number(a.cfg.ownCanvas) || a.ms - b.ms)[0];
    const current = CONFIGS.find((c) => c.delegate === original.delegate && c.ownCanvas === original.ownCanvas && c.input === app.settings.inputMode);
    const summary = h("div", { class: "notice" });
    if (!best) {
      summary.append(h("p", {}, "No setup found a face. If the preview shows your face clearly, copy the report below and send it. If the frame brightness says black frames, the camera image isn't reaching the page."));
      await t.rebuild(original).catch(() => {});
    } else {
      const same = current && best.cfg.label === current.label;
      summary.append(h("p", {}, `Best: ${best.cfg.label} (${best.faces}/${best.tries} faces, ${fmt(best.ms, 0)} ms).`));
      if (same) { summary.append(h("p", {}, "That's the setup already in use.")); await t.rebuild(original).catch(() => {}); }
      else {
        summary.append(h("button", { class: "primary", onclick: async () => {
          app.settings.delegate = best.cfg.delegate === "CPU" ? "CPU" : "auto";
          app.settings.trackerCanvas = best.cfg.ownCanvas ? "on" : "off";
          app.settings.inputMode = best.cfg.input;
          app.saveSettings();
          await t.rebuild({ delegate: best.cfg.delegate, ownCanvas: best.cfg.ownCanvas });
          summary.replaceChildren(h("p", { class: "ok" }, `Now using: ${best.cfg.label}. This is saved on this device.`));
        } }, "Use this setup"));
        await t.rebuild(original).catch(() => {});
      }
    }
    results.firstElementChild?.replaceWith(summary);
    e.paused = false;
    testBtn.disabled = false;
    reportBox.value = reportText();
  };
  testBtn.onclick = () => void runSelfTest();

  // Start camera + tracker if needed.
  (async () => {
    try {
      if (!cam.running) await cam.start(app.settings.cameraDeviceId, app.settings.cameraResolution);
      if (!e.ready) await e.initTracker();
      e.start();
      if (!alive) return;
      statusLine.textContent = "Live checks (updating):";
      preview = createPreview(app, { small: true, landmarks: true });
      previewHolder.replaceChildren(preview.el);
      testBtn.disabled = false;
    } catch (err) {
      statusLine.className = "notice error";
      statusLine.textContent = err instanceof CameraError ? `Camera: ${err.message}` : `Tracker failed to load: ${(err as Error)?.message ?? err}`;
    }
  })();

  const timer = window.setInterval(render, 500);
  const reportTimer = window.setInterval(() => { if (document.activeElement !== reportBox) reportBox.value = reportText(); }, 2000);

  const copy = async () => {
    reportBox.value = reportText();
    try { await navigator.clipboard.writeText(reportBox.value); copyBtn.textContent = "Copied"; }
    catch { reportBox.select(); copyBtn.textContent = "Select and copy the text above"; }
    setTimeout(() => (copyBtn.textContent = "Copy report"), 2500);
  };
  const copyBtn = h("button", { onclick: () => void copy() }, "Copy report");
  const shareBtn = "share" in navigator ? h("button", { onclick: () => void navigator.share({ title: "Touch-free response diagnostics", text: reportText() }).catch(() => {}) }, "Share report") : null;

  app.root.append(h("main", { class: "page" },
    h("h1", {}, "Diagnostics"),
    h("p", { class: "hint" }, "Checks each step from the camera to the face tracker. Hold the device so your face is in view. Nothing leaves this device unless you copy or share the report, which contains no images."),
    h("div", { class: "diag-views" },
      h("figure", {}, previewHolder, h("figcaption", {}, "Camera preview (mirrored)")),
      h("figure", {}, snap, h("figcaption", {}, "What the tracker receives"))),
    statusLine, checks,
    h("h2", {}, "Tracker self-test"),
    h("p", { class: "hint" }, "Tries the tracker several ways and shows which one finds your face. You can then use the best one."),
    testBtn, results,
    h("h2", {}, "Report"),
    reportBox,
    h("div", { class: "actions" }, copyBtn, shareBtn,
      h("button", { onclick: () => app.go(app.session ? "position" : "home") }, "Done")),
  ));

  return () => {
    alive = false;
    clearInterval(timer); clearInterval(reportTimer);
    preview?.dispose();
    e.paused = false;
    if (ownsCamera && !app.session) { e.stop(); cam.stop(); }
  };
};
