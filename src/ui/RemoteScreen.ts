import type { Screen } from "./app";
import { h } from "./dom";
import { MODE_INFO, type DetectionMode } from "../config/defaults";
import { WakeLockManager } from "../platform/WakeLock";
import type { RecordKind } from "../calibration/CalibrationService";

const SCREEN_TEXT: Record<string, string> = {
  home: "on its home screen (no session)", start: "starting the camera", position: "positioning",
  "calibrate-forward": "calibrating", "calibrate-response": "calibrating", "calibrate-add-response": "calibrating",
  result: "showing a calibration result", validation: "on the try-out screen", test: "testing (black screen)",
  summary: "paused", developer: "in developer view", settings: "in settings", about: "on the about screen",
};
const KIND_TEXT: Record<RecordKind, string> = { forward: "forward position", response: "response position", "add-response": "extra response posture" };

/** Clinician remote: see responses and control the patient device without line of sight to it. */
export const RemoteScreen: Screen = (app) => {
  const P = app.pairing;
  const lamp = h("div", { class: "lamp remote-lamp" });
  const lampText = h("p", { class: "lamp-text" });
  const link = h("span", { class: "link-badge" });
  const patient = h("p", { class: "status" });
  const count = h("strong", {}, "0");
  const warnings = h("div");
  const recBar = h("div", { class: "progress-fill" });
  const recProgress = h("div", { class: "progress hidden" }, recBar);
  const recText = h("p", { class: "status" });
  const ackText = h("p", { class: "fineprint" });
  const applyBtn = h("button", { class: "hidden", onclick: () => {
    if (confirm("Apply a calibration that is not graded Good or Excellent? Responses may be unreliable.")) P.command("apply-pending");
  } }, "Apply anyway");
  const addBtn = h("button", { onclick: () => P.command("add-response") }, "Add another response posture");
  const btnF = h("button", { class: "primary", onclick: () => P.command("record-forward") }, "Record forward position");
  const btnR = h("button", { class: "primary", onclick: () => P.command("record-response") }, "Record response position");
  const testBtn = h("button", { class: "primary big" });
  const modeSel = h("select", { class: "mode-select", onchange: (e: Event) => P.command("set-mode", { mode: (e.target as HTMLSelectElement).value as DetectionMode }) },
    ...(Object.keys(MODE_INFO) as DetectionMode[]).map((m) => h("option", { value: m }, MODE_INFO[m].name)));
  const modeDesc = h("p", { class: "hint" });

  const render = () => {
    const st = P.status, v = P.clinician, s = v.status;
    const fresh = st.connected && v.fresh();
    const silentFor = v.statusAt ? (performance.now() - v.statusAt) / 1000 : Infinity;
    link.textContent = !st.connected ? "Not connected" : !fresh ? "No signal" : st.state === "stale" ? "Link unstable" : st.state === "dead" ? "Link lost — reconnecting" : "Connected";
    link.dataset.state = !st.connected || !fresh ? "down" : st.state;

    // Lamp: never show "no response" when we don't actually know.
    const recording = !!s?.recording;
    lamp.dataset.state = !fresh ? "unknown" : v.active ? "on" : "off";
    lampText.textContent = !fresh ? "No signal — responses are not being shown here"
      : recording ? `Recording ${KIND_TEXT[s!.recording!.kind]}…`
      : !s!.calibrated ? "Not calibrated yet"
      : !s!.tracking ? `Not tracking: ${s!.reason ?? "no face"}`
      : v.active ? "Responding" : s!.state === "TRACKING_LOST" ? "Waiting for a forward look" : "Ready";
    count.textContent = String(v.responses);

    patient.textContent = !st.connected ? "The patient device is not connected."
      : !s ? "Waiting for the patient device…"
      : !fresh ? `Nothing heard from the patient device for ${Number.isFinite(silentFor) ? Math.round(silentFor) : "?"} s. Its screen still works on its own; check it, or re-pair.`
      : `Patient device is ${SCREEN_TEXT[s.screen] ?? s.screen}${s.recovering ? " — restarting camera" : ""}.`;

    const w = [...(s?.warnings ?? []), s?.modeFallback, st.peerBackground ? "The patient device app is in the background — it can't detect responses." : ""].filter(Boolean) as string[];
    warnings.replaceChildren(...w.map((x) => h("p", { class: "notice warn" }, x)));

    const canCmd = fresh && !!s?.session;
    for (const b of [btnF, btnR, addBtn, testBtn]) b.disabled = !canCmd || recording;
    btnR.disabled ||= !s?.hasForward;
    addBtn.classList.toggle("hidden", !(s?.calibrated && (s.mode === "eye" || s.mode === "cautious")));
    testBtn.textContent = s?.testing ? "Pause testing" : "Start testing";
    testBtn.onclick = () => P.command(s?.testing ? "pause-test" : "start-test");
    testBtn.disabled ||= !s?.calibrated;
    if (s && document.activeElement !== modeSel) modeSel.value = s.mode;
    modeDesc.textContent = s ? MODE_INFO[s.mode].description : "";

    // Recording progress / last result
    recProgress.classList.toggle("hidden", !recording);
    if (recording) recBar.style.width = `${(s!.recording!.progress ?? 0) * 100}%`;
    const r = v.lastRec;
    applyBtn.classList.add("hidden");
    if (recording) recText.textContent = "Keep the client in that position…";
    else if (r) {
      if (!r.ok) { recText.textContent = r.message ?? "Recording failed."; recText.className = "status bad"; }
      else if (r.needsResponse) { recText.textContent = "Forward position recorded. Now ask the client to look at the device and record the response position."; recText.className = "status ok"; }
      else if (r.applied) { recText.textContent = `Calibration ${r.grade ?? ""} — applied.`; recText.className = "status ok"; }
      else if (r.grade) {
        const good = r.grade === "Excellent" || r.grade === "Good";
        recText.textContent = good ? `Calibration ${r.grade}.` : `Calibration ${r.grade} for this mode — not applied; the previous calibration is still in use.${r.message ? ` ${r.message}` : ""}`;
        recText.className = good ? "status ok" : "status warn";
        if (!good && s?.pendingGrade && r.grade === "Marginal") applyBtn.classList.remove("hidden");
      }
    } else recText.textContent = "";
    const a = v.lastAck;
    ackText.textContent = a && !a.ok ? a.message ?? "" : "";
  };

  const unsub = P.onChange(render);
  const timer = window.setInterval(render, 250); // staleness must show even when no messages arrive
  const wake = new WakeLockManager(); void wake.request();
  render();

  app.root.append(h("main", { class: "page remote" },
    h("div", { class: "remote-top" }, h("h1", {}, "Clinician remote"), link),
    patient,
    lamp, lampText,
    h("p", { class: "remote-count" }, "Responses: ", count, " ",
      h("button", { class: "small", onclick: () => { P.clinician.responses = 0; render(); } }, "Reset count")),
    warnings,
    h("section", { class: "remote-section" },
      h("h2", {}, "Testing"),
      testBtn),
    h("section", { class: "remote-section" },
      h("h2", {}, "Recalibrate"),
      h("p", { class: "hint" }, "Ask the client to look straight ahead, then record forward. Ask them to look at the device, then record response. You can refresh either one on its own at any time — for example after the client shifts in their seat. The client's screen stays black while recording."),
      h("div", { class: "actions" }, btnF, btnR, addBtn),
      recProgress, recText, applyBtn, ackText),
    h("section", { class: "remote-section" },
      h("h2", {}, "Detection mode"), modeSel, modeDesc),
    h("div", { class: "actions" },
      h("button", { onclick: () => P.command("restart-tracking") }, "Restart tracking on patient device"),
      h("button", { class: "danger", onclick: () => { if (confirm("Disconnect from the patient device?")) { P.disconnect(); app.go("home"); } } }, "Disconnect")),
    h("p", { class: "fineprint" }, "Only response events, scores and status travel between the devices, end-to-end encrypted. Video never leaves the patient device."),
  ));
  return () => { unsub(); clearInterval(timer); void wake.release(); };
};
