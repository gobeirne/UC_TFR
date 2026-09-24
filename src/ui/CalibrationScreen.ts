import type { App, Screen } from "./app";
import { h, fmt } from "./dom";
import { createPreview } from "./Preview";
import type { TrackingSample } from "../tracking/TrackingSample";
import { buildCalibration } from "../calibration/CalibrationModel";
import { featureTable } from "./featureTable";

function calibrationStep(app: App, which: "forward" | "response") {
  const isF = which === "forward";
  const preview = createPreview(app, { small: true, landmarks: app.settings.developerMode });
  const bar = h("div", { class: "progress-fill" });
  const progress = h("div", { class: "progress hidden" }, bar);
  const msg = h("p", { class: "status" });
  const btn = h("button", { class: "primary big" }, isF ? "Record forward position" : "Record response position");
  let unsub = () => {}; let raf = 0;

  btn.onclick = () => {
    btn.disabled = true; progress.classList.remove("hidden"); msg.textContent = "Hold still in that position…"; msg.className = "status";
    const samples: TrackingSample[] = [];
    const t0 = performance.now();
    const settle = app.settings.calibrationSettleMs, dur = app.settings.calibrationRecordMs;
    unsub = app.engine.subscribe((s) => { if (s.frameTimeMs - t0 >= settle) samples.push(s); });
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / (settle + dur));
      bar.style.width = `${p * 100}%`;
      if (p < 1) { raf = requestAnimationFrame(tick); return; }
      unsub();
      const valid = samples.filter((s) => s.valid).length;
      const frac = samples.length ? valid / samples.length : 0;
      if (valid < 8 || frac < 0.5) {
        msg.textContent = isF
          ? "No face detected for most of the recording. Reposition the device or client, then record again."
          : "The face was lost while looking at the device. Try moving the device a little less far to the side, or ask the client to turn their head slightly toward it. Then record again.";
        msg.className = "notice error";
        btn.disabled = false; progress.classList.add("hidden");
        return;
      }
      if (isF) { app.session!.forwardSamples = samples; app.go("calibrate-response"); }
      else {
        app.session!.calibration = buildCalibration(app.session!.forwardSamples ?? [], samples, performance.now());
        app.go("result");
      }
    };
    raf = requestAnimationFrame(tick);
  };

  app.root.append(h("main", { class: "page" },
    h("p", { class: "step" }, isF ? "Calibration, step 1 of 2" : "Calibration, step 2 of 2"),
    h("h1", {}, isF ? "Ask the client to look straight ahead." : "Ask the client to look at this device."),
    h("p", { class: "hint" }, isF
      ? "Their normal, relaxed forward position — how they'll sit between beeps."
      : "The way they'll naturally respond: eyes, head or both. It should be comfortable to repeat many times."),
    btn, progress, msg,
    preview.el,
    h("div", { class: "actions" },
      h("button", { onclick: () => app.go(isF ? "position" : "calibrate-forward") }, "Back")),
  ));
  return () => { unsub(); cancelAnimationFrame(raf); preview.dispose(); };
}

export const CalibrateForwardScreen: Screen = (app) => calibrationStep(app, "forward");
export const CalibrateResponseScreen: Screen = (app) => calibrationStep(app, "response");

export const ResultScreen: Screen = (app) => {
  const m = app.session!.calibration!;
  const q = m.quality;
  const ok = q.grade === "Excellent" || q.grade === "Good";
  const using = q.usedFeatures === 0 ? "nothing usable" : q.headShare > 0.75 ? "mainly head movement" : q.headShare < 0.25 ? "mainly eye movement" : "both head and eye movement";

  const actions = h("div", { class: "actions" });
  if (ok) {
    actions.append(h("button", { class: "primary", onclick: () => app.go("validation") }, "Continue to try-out"),
      h("button", { onclick: () => app.go("calibrate-forward") }, "Recalibrate"));
  } else {
    actions.append(h("button", { class: "primary", onclick: () => app.go("calibrate-forward") }, "Recalibrate"),
      h("button", { onclick: () => app.go("position") }, "Reposition device"));
    if (q.grade === "Marginal" && app.settings.developerMode) {
      const chk = h("input", { type: "checkbox" });
      const go = h("button", { disabled: true, onclick: () => app.go("validation") }, "Proceed with marginal calibration");
      chk.onchange = () => { go.disabled = !chk.checked; };
      actions.append(h("label", { class: "override" }, chk, " Research override: I understand this calibration may be unreliable."), go);
    }
  }

  app.root.append(h("main", { class: "page" },
    h("p", { class: "step" }, "Calibration result"),
    h("h1", { class: `grade grade-${q.grade.split(" ")[0].toLowerCase()}` }, q.grade),
    h("p", {}, q.usedFeatures ? `Detection will use ${using}.` : "The two positions could not be reliably distinguished. Move the device farther to the side or repeat calibration."),
    q.problems.length ? h("ul", { class: "problems" }, ...q.problems.map((p) => h("li", {}, p))) : null,
    q.suggestions.length ? h("div", { class: "notice" }, h("strong", {}, "Suggestions"), h("ul", {}, ...q.suggestions.map((s) => h("li", {}, s)))) : null,
    h("dl", { class: "readout" },
      h("dt", {}, "Separation (d′)"), h("dd", {}, fmt(q.dPrime, 1)),
      h("dt", {}, "Frames tracked"), h("dd", {}, `${Math.round(q.validFraction * 100)}%`),
      h("dt", {}, "Features used"), h("dd", {}, String(q.usedFeatures))),
    actions,
    app.settings.developerMode ? h("details", { open: true }, h("summary", {}, "What is the system using?"), featureTable(m)) : null,
  ));
};
