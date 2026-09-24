import type { App } from "./app";
import { h } from "./dom";
import { MODE_INFO, type DetectionMode } from "../config/defaults";

/** Detection-mode picker with a one-line description. */
export function modePicker(app: App, onChange?: (m: DetectionMode) => void, grades?: Partial<Record<DetectionMode, string>>) {
  const desc = h("p", { class: "hint mode-desc" }, MODE_INFO[app.settings.detectionMode].description);
  const sel = h("select", { class: "mode-select", onchange: (e: Event) => {
    const m = (e.target as HTMLSelectElement).value as DetectionMode;
    app.settings.detectionMode = m; app.saveSettings();
    desc.textContent = MODE_INFO[m].description;
    onChange?.(m);
  } }, ...(Object.keys(MODE_INFO) as DetectionMode[]).map((m) =>
    h("option", { value: m, selected: m === app.settings.detectionMode }, grades?.[m] ? `${MODE_INFO[m].name} — ${grades[m]}` : MODE_INFO[m].name)));
  return h("label", { class: "field" }, "Detection mode", sel, desc);
}

/**
 * Patient-device pairing badge + button. Shows whether a clinician remote is
 * connected; tapping pairs (the camera pauses while the pairing dialog is open).
 */
export function pairBadge(app: App) {
  const text = h("span", {});
  const btn = h("button", { class: "small", onclick: () => {
    if (app.pairing.connected && app.pairing.role === "patient") {
      if (confirm("Disconnect the clinician remote?")) app.pairing.disconnect();
    } else void app.pairing.openAsPatient().catch((e) => alert(`Pairing could not start: ${e?.message ?? e}`));
  } });
  const el = h("div", { class: "pair-badge" }, text, btn);
  const render = () => {
    const st = app.pairing.status;
    const on = st.connected && app.pairing.role === "patient";
    el.dataset.state = on ? st.state : "idle";
    text.textContent = on ? (st.state === "live" ? "Clinician remote connected" : "Clinician remote: link unstable") : "No clinician remote";
    btn.textContent = on ? "Disconnect" : "Pair clinician remote";
  };
  render();
  const unsub = app.pairing.onChange(render);
  return { el, dispose: unsub };
}
