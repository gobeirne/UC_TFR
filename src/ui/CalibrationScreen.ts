import type { App, Screen } from "./app";
import { h, fmt } from "./dom";
import { createPreview } from "./Preview";
import { featureTable } from "./featureTable";
import type { RecordKind } from "../calibration/CalibrationService";
import { gradeForMode, gradeOk } from "../calibration/CalibrationQuality";
import { MODE_INFO, type DetectionMode } from "../config/defaults";
import { modePicker } from "./widgets";

function calibrationStep(app: App, kind: RecordKind) {
  const isF = kind === "forward", isAdd = kind === "add-response";
  const preview = createPreview(app, { small: true, landmarks: app.settings.developerMode });
  const bar = h("div", { class: "progress-fill" });
  const progress = h("div", { class: "progress hidden" }, bar);
  const msg = h("p", { class: "status" });
  const btn = h("button", { class: "primary big" }, isF ? "Record forward position" : "Record response position");
  const unsub = app.calibration.on((e) => { if (e.type === "recording") bar.style.width = `${e.progress * 100}%`; });
  let alive = true;

  btn.onclick = async () => {
    btn.disabled = true; progress.classList.remove("hidden"); msg.textContent = "Hold still in that position…"; msg.className = "status";
    const o = await app.calibration.record(kind);
    if (!alive) return;
    if (!o.ok) {
      msg.textContent = o.message ?? "Recording failed."; msg.className = "notice error";
      btn.disabled = false; progress.classList.add("hidden");
      return;
    }
    app.go(o.needsResponse ? "calibrate-response" : "result");
  };

  app.root.append(h("main", { class: "page" },
    h("p", { class: "step" }, isF ? "Calibration, step 1 of 2" : isAdd ? "Extra response posture" : "Calibration, step 2 of 2"),
    h("h1", {}, isF ? "Ask the client to look straight ahead." : "Ask the client to look at this device."),
    h("p", { class: "hint" }, isF
      ? "Their normal, relaxed forward position — how they'll sit between beeps."
      : isAdd
        ? "Ask the client to sit a little differently (lean, turn slightly, sit back) and look at the device again. Each extra posture teaches eye-contact mode how this person's eyes and head combine."
        : "The way they'll naturally respond: eyes, head or both. It should be comfortable to repeat many times."),
    btn, progress, msg,
    preview.el,
    h("div", { class: "actions" },
      h("button", { onclick: () => app.go(isF ? "position" : isAdd ? "result" : "calibrate-forward") }, "Back")),
  ));
  return () => { alive = false; unsub(); preview.dispose(); };
}

export const CalibrateForwardScreen: Screen = (app) => calibrationStep(app, "forward");
export const CalibrateResponseScreen: Screen = (app) => calibrationStep(app, "response");
export const CalibrateAddResponseScreen: Screen = (app) => calibrationStep(app, "add-response");

export const ResultScreen: Screen = (app) => {
  const s = app.session!;
  const m = s.pendingCalibration ?? s.calibration!;
  const body = h("div");
  const render = () => {
    const mode = app.settings.detectionMode;
    const g = gradeForMode(m, mode);
    const q = m.quality;
    const ok = gradeOk(g.grade);
    const grades = Object.fromEntries((Object.keys(MODE_INFO) as DetectionMode[]).map((k) => [k, gradeForMode(m, k).grade])) as Record<DetectionMode, string>;
    const using = q.usedFeatures === 0 ? "nothing usable" : q.headShare > 0.75 ? "mainly head movement" : q.headShare < 0.25 ? "mainly eye movement" : "both head and eye movement";
    const accept = () => { app.calibration.apply(m); app.go("validation"); };

    const actions = h("div", { class: "actions" });
    if (ok) actions.append(h("button", { class: "primary", onclick: accept }, "Continue to try-out"),
      h("button", { onclick: () => app.go("calibrate-forward") }, "Recalibrate"));
    else {
      actions.append(h("button", { class: "primary", onclick: () => app.go("calibrate-forward") }, "Recalibrate"),
        h("button", { onclick: () => app.go("position") }, "Reposition device"));
      if (g.grade === "Marginal" && app.settings.developerMode) {
        const chk = h("input", { type: "checkbox" });
        const go = h("button", { disabled: true, onclick: accept }, "Proceed with marginal calibration");
        chk.onchange = () => { go.disabled = !chk.checked; };
        actions.append(h("label", { class: "override" }, chk, " Research override: I understand this calibration may be unreliable."), go);
      }
    }
    const eyeMode = mode === "eye" || mode === "cautious";
    body.replaceChildren(...[
      h("h1", { class: `grade grade-${g.grade.split(" ")[0].toLowerCase()}` }, g.grade),
      h("p", {}, g.grade === "Unable to distinguish"
        ? (g.problem ?? "The two positions could not be reliably distinguished. Move the device farther to the side or repeat calibration.")
        : `${MODE_INFO[mode].name}. The relative methods use ${using}.`),
      q.problems.length ? h("ul", { class: "problems" }, ...q.problems.map((p) => h("li", {}, p))) : null,
      q.suggestions.length && !ok ? h("div", { class: "notice" }, h("strong", {}, "Suggestions"), h("ul", {}, ...q.suggestions.map((x) => h("li", {}, x)))) : null,
      actions,
      modePicker(app, () => render(), grades),
      eyeMode && m.eye.usable ? h("div", { class: "notice" },
        h("p", {}, `Eye contact: forward gaze is about ${fmt(m.eye.forwardAngle, 0)}° from the device. `,
          m.responseRecordings > 1 ? `${m.responseRecordings} response postures recorded.` : "Recording the response in one or two more postures makes this mode more robust to posture changes."),
        h("button", { onclick: () => app.go("calibrate-add-response") }, "Add another response posture")) : null,
      h("dl", { class: "readout" },
        h("dt", {}, "Separation (d′)"), h("dd", {}, fmt(g.dPrime, 1)),
        h("dt", {}, "Frames tracked"), h("dd", {}, `${Math.round(q.validFraction * 100)}%`),
        h("dt", {}, "Features used"), h("dd", {}, String(q.usedFeatures))),
      app.settings.developerMode ? h("details", { open: true }, h("summary", {}, "What is the system using?"), featureTable(m),
        h("p", { class: "fineprint" }, `Eye contact model: ${m.eye.usable ? `k=${fmt(m.eye.kH, 1)}°/unit (${m.eye.kSource}), bias ${fmt(m.eye.biasH, 1)}°/${fmt(m.eye.biasV, 1)}°, d′ ${fmt(m.eye.dPrime, 1)}` : m.eye.problem}`)) : null,
    ].filter((x) => !!x) as HTMLElement[]);
  };
  render();
  app.root.append(h("main", { class: "page" }, h("p", { class: "step" }, "Calibration result"), body));
};
