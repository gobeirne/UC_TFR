import type { Screen } from "./app";
import { h } from "./dom";
import { CameraError } from "../camera/CameraManager";
import { createPreview } from "./Preview";
import { pairBadge } from "./widgets";
import { INVALID_REASON_TEXT, type TrackingSample } from "../tracking/TrackingSample";

const CAMERA_HELP: Record<string, string> = {
  permission: "Camera access is required to detect the patient's response. No video is recorded or uploaded. Allow camera access in the browser's site settings (on iPhone: Settings › Safari › Camera, or the “aA” menu › Website Settings), then try again.",
  "no-camera": "No usable camera was found. Connect a webcam or choose another device, then try again.",
  "in-use": "Another app or browser tab is using the camera. Close it, then try again.",
  insecure: "The camera only works over HTTPS. Open the app from its https:// address.",
  unsupported: "This browser does not provide camera access. Try Safari on iPhone/iPad, or Chrome/Edge elsewhere.",
  other: "The camera could not be started.",
};

/** Camera permission + model loading. */
export const StartScreen: Screen = (app) => {
  const status = h("p", { class: "status" }, "Requesting camera…");
  const box = h("main", { class: "page" }, h("h1", {}, "Starting"), status);
  app.root.append(box);
  let cancelled = false;
  (async () => {
    try {
      if (!app.camera.running) await app.camera.start(app.settings.cameraDeviceId, app.settings.cameraResolution);
      if (cancelled) return;
      status.textContent = "Loading the tracking model… (first time only; cached afterwards)";
      await app.engine.initTracker();
      if (cancelled) return;
      app.engine.start();
      app.go("position");
    } catch (e) {
      if (cancelled) return;
      const isCam = e instanceof CameraError;
      box.replaceChildren(
        h("h1", {}, isCam ? "Camera unavailable" : "Tracking model failed to load"),
        h("p", { class: "notice error" }, isCam ? CAMERA_HELP[(e as CameraError).kind] : "The face-tracking model could not be loaded. Check the connection (needed only the first time) and try again."),
        h("p", { class: "fineprint" }, String((e as Error)?.message ?? e)),
        h("div", { class: "actions" },
          h("button", { class: "primary", onclick: () => app.go("start") }, "Try again"),
          h("button", { onclick: () => app.endSession() }, "Back")),
      );
    }
  })();
  return () => { cancelled = true; };
};

/** Step 1: position the device. */
export const PositionScreen: Screen = (app) => {
  const preview = createPreview(app, { guide: true, landmarks: app.settings.developerMode });
  const pair = pairBadge(app);
  const face = h("span", {}, "—"), quality = h("span", {}, "—"), size = h("span", {}, "—");
  const cont = h("button", { class: "primary", disabled: true, onclick: () => app.go("calibrate-forward") }, "Continue");
  const camSelect = h("select", { class: "inline", onchange: async (e: Event) => {
    app.settings.cameraDeviceId = (e.target as HTMLSelectElement).value; app.saveSettings();
    app.engine.stop(); app.camera.stop(); app.go("start");
  } });
  const camRow = h("label", { class: "field hidden" }, "Camera ", camSelect);
  app.camera.listCameras().then((cams) => {
    if (cams.length < 2) return;
    for (const c of cams) camSelect.append(h("option", { value: c.deviceId, selected: c.deviceId === app.camera.activeDeviceId }, c.label || "Camera"));
    camRow.classList.remove("hidden");
  });

  const why = h("p", { class: "notice warn hidden" });
  const restartBtn = h("button", { onclick: async () => {
    restartBtn.disabled = true; restartBtn.textContent = "Restarting…";
    await app.engine.restart();
    restartBtn.disabled = false; restartBtn.textContent = "Restart camera and tracking";
    lastGood = performance.now();
  } }, "Restart camera and tracking");
  let lastGood = performance.now();
  const recent: TrackingSample[] = [];
  const unsub = app.engine.subscribe((s) => {
    recent.push(s);
    while (recent.length && s.timestampMs - recent[0].timestampMs > 1000) recent.shift();
    const valid = recent.filter((r) => r.valid);
    const rate = recent.length ? valid.length / recent.length : 0;
    face.textContent = s.valid ? "Yes" : s.invalidReason === "face-at-edge" ? "Partly — face at edge of view" : "No";
    face.className = s.valid ? "ok" : "bad";
    quality.textContent = rate >= 0.9 ? "Good" : rate >= 0.6 ? "Fair" : "Poor";
    quality.className = rate >= 0.9 ? "ok" : rate >= 0.6 ? "warn" : "bad";
    const sc = s.faceScale;
    size.textContent = sc === undefined ? "—" : sc < 0.07 ? "Small — move closer" : sc > 0.4 ? "Very close — move back" : "OK";
    size.className = sc === undefined ? "" : sc < 0.07 || sc > 0.4 ? "warn" : "ok";
    cont.disabled = !(rate >= 0.8 && recent.length >= 5);
    if (s.valid) lastGood = s.timestampMs;
    const stuck = !s.valid && s.timestampMs - lastGood > 3000;
    why.classList.toggle("hidden", !stuck);
    if (stuck) why.textContent = `Not tracking: ${INVALID_REASON_TEXT[s.invalidReason ?? "no-face"]}. If the face is clearly in view, restart the camera and tracking.`;
  });

  app.root.append(h("main", { class: "page wide" },
    h("h1", {}, "Position the device"),
    h("p", { class: "instruction" }, "Position the device so the client's face is clearly visible while they look straight ahead."),
    h("p", { class: "hint" }, "Place it roughly 30–60° to one side of their forward gaze, near eye level. Either side works. Avoid a bright window behind the client."),
    preview.el,
    h("dl", { class: "readout" }, h("dt", {}, "Face detected"), h("dd", {}, face), h("dt", {}, "Tracking"), h("dd", {}, quality), h("dt", {}, "Face size"), h("dd", {}, size)),
    why,
    camRow,
    h("div", { class: "actions" }, cont, restartBtn, h("button", { onclick: () => app.endSession() }, "Cancel")),
    pair.el,
    h("p", { class: "fineprint" }, "With a clinician remote paired, you can record the calibration positions, start and pause testing, and see responses from the remote — no line of sight to this screen needed."),
  ));
  return () => { unsub(); preview.dispose(); pair.dispose(); };
};
