import type { Screen } from "./app";
import { h, fmt } from "./dom";
import { ResponsePipeline } from "../detection/ResponsePipeline";
import { VisualResponseOutput } from "../outputs/VisualOutput";
import { SessionLogger } from "../logging/SessionLogger";
import { WakeLockManager } from "../platform/WakeLock";
import { exitFullscreen } from "../platform/fullscreen";
import { downloadText } from "../logging/CsvExporter";
import { startTesting } from "./ValidationScreen";

/**
 * The clinical screen: pure black, pure green on response. No text, sound,
 * haptics or motion. Only the tiny exit acknowledgement and optional amber
 * tracking marker ever appear.
 */
export const TestScreen: Screen = (app) => {
  const s = app.session!;
  if (app.settings.researchLogging && !s.logger) s.logger = new SessionLogger(s.t0, app.settings.logFeatures);
  if (s.logger) s.logger.logFeatures = app.settings.logFeatures;
  const pipeline = new ResponsePipeline(s.calibration!, app.settings, s.logger);
  const screen = h("div", { class: "test-screen" });
  pipeline.outputs.add(new VisualResponseOutput(screen));

  const holder = h("div", { class: "hidden-video" });
  app.camera.mount(holder, "hidden-video-el");
  const marker = h("div", { class: "lost-marker" });
  const ring = h("div", { class: "exit-ring" });
  const exitZone = h("div", { class: "exit-zone" }, ring);
  screen.append(marker, exitZone);
  app.root.append(holder, screen);
  document.body.classList.add("testing");

  const tStart = performance.now();
  s.logger?.logNote(tStart, "test_start");
  let lostSince: number | null = null, lostMs = 0, lastT = tStart;
  const unsub = app.engine.subscribe((smp) => {
    const t = pipeline.process(smp);
    const now = smp.timestampMs;
    if (!t.c.valid) {
      lostMs += now - lastT;
      lostSince ??= now;
      marker.classList.toggle("on", app.settings.trackingLostMarker && now - lostSince > app.settings.trackingLostMarkerMs);
    } else { lostSince = null; marker.classList.remove("on"); }
    lastT = now;
  });

  const wake = new WakeLockManager();
  void wake.request();

  // Exit: press and hold the top-left corner.
  let holdTimer = 0;
  const cancelHold = () => { clearTimeout(holdTimer); ring.classList.remove("filling"); };
  exitZone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ring.style.animationDuration = `${app.settings.exitHoldMs}ms`;
    ring.classList.add("filling");
    holdTimer = window.setTimeout(exit, app.settings.exitHoldMs);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) exitZone.addEventListener(ev, cancelHold);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exit(); };
  const block = (e: Event) => e.preventDefault();
  const onOrient = () => pipeline.movement.flag("device orientation changed");
  document.addEventListener("keydown", onKey);
  document.addEventListener("touchmove", block, { passive: false });
  document.addEventListener("gesturestart", block as any);
  document.addEventListener("contextmenu", block);
  window.screen.orientation?.addEventListener?.("change", onOrient);
  window.addEventListener("orientationchange", onOrient);

  let exited = false;
  function exit() {
    if (exited) return; exited = true;
    const end = performance.now();
    s.logger?.logNote(end, "test_end");
    s.lastTestSummary = { responses: pipeline.responses, durationMs: end - tStart, lostMs };
    if (pipeline.movement.moved) s.deviceMovedNote = pipeline.movement.reason;
    app.go("summary");
  }

  return () => {
    unsub(); cancelHold();
    pipeline.stop(performance.now());
    pipeline.outputs.disposeAll();
    void wake.release(); void exitFullscreen();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("touchmove", block);
    document.removeEventListener("gesturestart", block as any);
    document.removeEventListener("contextmenu", block);
    window.removeEventListener("orientationchange", onOrient);
    window.screen.orientation?.removeEventListener?.("change", onOrient);
    document.body.classList.remove("testing");
  };
};

export const SummaryScreen: Screen = (app) => {
  const s = app.session!;
  const sum = s.lastTestSummary;
  const lg = s.logger;
  const stamp = () => `${s.participantCode || "session"}_${s.startedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  app.root.append(h("main", { class: "page" },
    h("h1", {}, "Testing paused"),
    sum ? h("dl", { class: "readout" },
      h("dt", {}, "Responses"), h("dd", {}, String(sum.responses)),
      h("dt", {}, "Duration"), h("dd", {}, `${fmt(sum.durationMs / 60000, 1)} min`),
      h("dt", {}, "Time not tracking"), h("dd", {}, `${Math.round((sum.lostMs / Math.max(1, sum.durationMs)) * 100)}%`)) : null,
    s.deviceMovedNote ? h("p", { class: "notice warn" }, `Device may have moved — consider recalibrating (${s.deviceMovedNote}).`) : null,
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => startTesting(app) }, "Resume testing"),
      h("button", { onclick: () => app.go("validation") }, "Try-out screen"),
      h("button", { onclick: () => { s.deviceMovedNote = undefined; app.go("calibrate-forward"); } }, "Recalibrate"),
      app.settings.developerMode ? h("button", { onclick: () => app.go("developer") }, "Developer view") : null),
    lg ? h("div", { class: "notice" },
      h("p", {}, `Research log: ${lg.eventCount} events${lg.sampleCount ? `, ${lg.sampleCount} feature samples` : ""}. Held in memory only — it is discarded when the session ends unless you export it.`),
      h("div", { class: "actions" },
        h("button", { onclick: () => downloadText(`${stamp()}_events.csv`, lg.eventsCsv()) }, "Export events CSV"),
        lg.sampleCount ? h("button", { onclick: () => downloadText(`${stamp()}_samples.csv`, lg.samplesCsv()) }, "Export samples CSV") : null)) : null,
    h("div", { class: "actions" },
      h("button", { class: "danger", onclick: () => { if (!lg?.eventCount || confirm("End the session? Calibration and any unexported log will be discarded.")) app.endSession(); } }, "End session")),
  ));
};
