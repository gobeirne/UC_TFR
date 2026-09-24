import type { Screen } from "./app";
import { h } from "./dom";
import type { Settings } from "../config/defaults";
import { resetTunables } from "../config/settings";

export const SettingsScreen: Screen = (app) => {
  const s = app.settings;
  const toggle = (key: keyof Settings, label: string, hint?: string) =>
    h("label", { class: "toggle" },
      h("input", { type: "checkbox", checked: !!s[key], onchange: (e: Event) => { (s as any)[key] = (e.target as HTMLInputElement).checked; app.saveSettings(); } }),
      h("span", {}, label, hint ? h("small", {}, hint) : null));
  const select = (key: keyof Settings, label: string, options: [string | number, string][]) =>
    h("label", { class: "field" }, label,
      h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; (s as any)[key] = typeof s[key] === "number" ? Number(v) : v; app.saveSettings(); } },
        ...options.map(([v, l]) => h("option", { value: v, selected: String(s[key]) === String(v) }, l))));
  const code = h("input", { type: "text", value: s.participantCode, maxlength: 16, placeholder: "e.g. P001", autocomplete: "off", spellcheck: false,
    oninput: (e: Event) => { const el = e.target as HTMLInputElement; el.value = el.value.replace(/[^A-Za-z0-9_-]/g, ""); s.participantCode = el.value; app.saveSettings(); } });

  app.root.append(h("main", { class: "page" },
    h("h1", {}, "Settings"),
    h("h2", {}, "Test screen"),
    toggle("trackingLostMarker", "Show a small amber dot when tracking is lost", "Bottom-right corner, after 2 seconds without tracking."),
    h("h2", {}, "Research"),
    toggle("researchLogging", "Keep a research log of response events", "In memory only; export as CSV from the pause screen. Never contains images."),
    toggle("logFeatures", "Also log every tracking sample's feature values"),
    h("label", { class: "field" }, "Anonymous participant code (optional)", code),
    h("p", { class: "fineprint" }, "Do not enter names or health information."),
    h("h2", {}, "Tracking"),
    select("delegate", "Processor", [["auto", "Automatic (GPU if available)"], ["GPU", "GPU"], ["CPU", "CPU"]]),
    select("cameraResolution", "Camera resolution", [[720, "720p (better eye detail)"], [480, "480p (lighter)"]]),
    h("p", { class: "fineprint" }, "Processor and resolution changes apply from the next session."),
    h("h2", {}, "Developer"),
    toggle("developerMode", "Developer mode", "Landmark overlay, feature weights, score graph and live tuning."),
    toggle("devBeep", "Developer demo beep", "Developer demonstration only — not a calibrated audiometric stimulus. Never plays in test mode."),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: () => app.go("home") }, "Done"),
      h("button", { onclick: () => { resetTunables(s); app.go("settings"); } }, "Reset detection defaults")),
  ));
};
