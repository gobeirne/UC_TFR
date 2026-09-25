import type { App, Screen } from "./app";
import { h, fmt } from "./dom";
import { ResponsePipeline } from "../detection/ResponsePipeline";
import { VisualResponseOutput } from "../outputs/VisualOutput";
import { WakeLockManager } from "../platform/WakeLock";
import { enterFullscreen } from "../platform/fullscreen";
import { isIOS } from "../platform/capabilities";
import { INVALID_REASON_TEXT } from "../tracking/TrackingSample";
import { modePicker, pairBadge } from "./widgets";

/** Score bar with activation/release markers. Shared with developer mode. */
export function scoreBar(app: App) {
  const fill = h("div", { class: "scorebar-fill" });
  const act = h("div", { class: "scorebar-mark act" }), rel = h("div", { class: "scorebar-mark rel" });
  const el = h("div", { class: "scorebar", title: "Response score: 0 = forward, 1 = response position" }, fill, act, rel,
    h("span", { class: "scorebar-label l" }, "forward"), h("span", { class: "scorebar-label r" }, "device"));
  const pos = (v: number) => `${((Math.max(-0.25, Math.min(1.25, v)) + 0.25) / 1.5) * 100}%`;
  return {
    el,
    set(score: number, valid: boolean) {
      act.style.left = pos(app.settings.activationThreshold); rel.style.left = pos(app.settings.releaseThreshold);
      fill.style.width = valid ? pos(score) : "0";
      el.classList.toggle("invalid", !valid);
    },
  };
}

export function startTesting(app: App) {
  void enterFullscreen(); // must be called inside the tap handler to be allowed
  app.go("test");
}

export const ValidationScreen: Screen = (app) => {
  const m = app.session!.calibration!;
  const pipeline = new ResponsePipeline(m, app.settings);
  const lamp = h("div", { class: "lamp" });
  pipeline.outputs.add(new VisualResponseOutput(lamp));
  const unregister = app.registerPipeline(pipeline);
  const bar = scoreBar(app);
  const status = h("span", {}), count = h("strong", {}, "0"), scoreTxt = h("span", {}, "—");
  const warn = h("p", { class: "notice warn hidden" });
  const pair = pairBadge(app);
  const unsub = app.engine.subscribe((s) => {
    const t = pipeline.process(s);
    const w = [app.engine.gaveUp, pipeline.modeFallback, (t.mode === "adaptive" || t.mode === "cautious") ? pipeline.drift.warning : ""].filter(Boolean).join(" ");
    warn.textContent = w; warn.classList.toggle("hidden", !w);
    bar.set(t.c.score, t.c.valid);
    scoreTxt.textContent = t.c.valid ? fmt(t.c.score) : "—";
    count.textContent = String(pipeline.responses);
    const st = pipeline.machine.state;
    status.textContent = pipeline.suspended ? "Recording a calibration position…" : !t.c.valid ? `Not tracking: ${INVALID_REASON_TEXT[s.invalidReason ?? "low-coverage"]}`
      : st === "TRACKING_LOST" ? "Waiting for a forward look to arm"
      : !t.c.onAxis && t.c.score > app.settings.releaseThreshold ? "Movement not toward the device — ignored"
      : pipeline.machine.active ? "Response detected" : "Ready";
    status.className = t.c.valid && st !== "TRACKING_LOST" ? "ok" : "warn";
  });

  const wakeNote = WakeLockManager.supported() ? null : h("p", { class: "notice" },
    "This browser can't keep the screen awake automatically. ",
    isIOS() ? "Set Settings › Display & Brightness › Auto-Lock to Never during testing, or update iOS." : "Increase the screen-timeout setting before testing.");

  app.root.append(h("main", { class: "page" },
    h("p", { class: "step" }, "Try it"),
    h("h1", {}, "Look forward, then look at the device, several times."),
    h("p", { class: "hint" }, "Each look should turn the circle green once, and looking forward again should turn it black. Aim for 3–5 clean responses."),
    lamp,
    bar.el,
    warn,
    h("dl", { class: "readout" },
      h("dt", {}, "Status"), h("dd", {}, status),
      h("dt", {}, "Score"), h("dd", {}, scoreTxt),
      h("dt", {}, "Responses"), h("dd", {}, count)),
    wakeNote,
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => startTesting(app) }, "Start testing"),
      h("button", { onclick: () => app.go("calibrate-forward") }, "Recalibrate"),
      h("button", { onclick: () => void app.engine.restart() }, "Restart tracking"),
      app.settings.developerMode ? h("button", { onclick: () => app.go("developer") }, "Developer view") : null),
    modePicker(app),
    pair.el,
    h("p", { class: "hint" }, "To leave the black test screen: tap “‹ Back” in the top-left corner, or press Esc on a keyboard. Don't move the device after calibration."),
  ));
  return () => { unsub(); pair.dispose(); pipeline.stop(performance.now()); unregister(); };
};
