import type { Screen } from "./app";
import { h } from "./dom";
import { detectCapabilities, isIOS } from "../platform/capabilities";

export const AboutScreen: Screen = (app) => {
  const caps = detectCapabilities();
  app.root.append(h("main", { class: "page" },
    h("h1", {}, "About"),
    h("p", {}, "An experimental touch-free patient-response interface for behavioural audiometry. It does not measure hearing and is not a diagnostic, certified or validated medical device. It only shows the clinician that the client has intentionally looked toward the device."),
    h("h2", {}, "Privacy"),
    h("p", {}, "Video is processed locally on this device and is not recorded or transmitted. There is no account, no server and no analytics. Calibration is held in memory and discarded when the session ends. The optional research log contains only numbers and timestamps, and leaves the device only if you export it."),
    h("h2", {}, "Using it"),
    h("ol", {},
      h("li", {}, "Place the device 30–60° to one side of the client, camera facing them."),
      h("li", {}, "Tell the client: “Keep looking straight ahead. Whenever you hear a beep, look at the phone. Then look straight ahead again.”"),
      h("li", {}, "Calibrate forward, then response. Try it a few times, then start testing."),
      h("li", {}, "The screen stays black, and turns green while the client looks at it. Record a response each time it goes green."),
      h("li", {}, "To leave the test screen, tap “‹ Back” in its top-left corner (or press Esc on a keyboard).")),
    h("h2", {}, "Install as an app (optional)"),
    isIOS()
      ? h("p", {}, "In Safari: tap Share (or the page menu), choose Add to Home Screen, and switch on Open as Web App if offered. The normal website works too.")
      : h("p", {}, "In Chrome or Edge: open the browser menu and choose Install app or Add to Home screen. The normal website works too."),
    h("p", {}, "After the first full session the app, model and tracking engine are cached, so it can run without internet."),
    h("h2", {}, "This browser"),
    h("table", { class: "caps" }, ...caps.map((c) => h("tr", {},
      h("td", {}, c.name), h("td", { class: c.ok ? "ok" : c.required ? "bad" : "muted" }, c.ok ? "✓" : c.required ? "✗ required" : "–"),
      h("td", { class: "muted" }, c.note ?? "")))),
    h("p", { class: "fineprint" }, `Version ${__APP_VERSION__}`),
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: () => app.go("home") }, "Back")),
  ));
};
