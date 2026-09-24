import type { Screen } from "./app";
import { h } from "./dom";
import { newSession } from "../session";
import { detectCapabilities } from "../platform/capabilities";

export const HomeScreen: Screen = (app) => {
  const caps = detectCapabilities();
  const missing = caps.filter((c) => c.required && !c.ok);
  app.root.append(
    h("main", { class: "page home" },
      h("h1", {}, "Touch-free response"),
      h("p", { class: "lede" }, "The client answers by looking at this device. Its screen turns green while they do, so you can record the response exactly as you would a button press."),
      h("p", { class: "privacy" }, "Video is processed locally on this device and is not recorded or transmitted."),
      missing.length ? h("div", { class: "notice error" },
        h("strong", {}, "This browser can't run the app: "), missing.map((m) => m.name).join(", "), ".",
        !window.isSecureContext ? h("p", {}, "Open the app over HTTPS (or on localhost during development).") : null) : null,
      h("div", { class: "actions" },
        h("button", { class: "primary", disabled: missing.length > 0, onclick: () => { app.session = newSession(app.settings.participantCode); app.go("start"); } }, "Start new session"),
        h("button", { onclick: () => void app.pairing.openAsClinician().catch((e) => alert(`Pairing could not start: ${e?.message ?? e}`)) }, "Use this device as the clinician remote"),
        h("button", { onclick: () => app.go("settings") }, "Settings"),
        h("button", { onclick: () => app.go("about") }, "About, privacy and installing"),
      ),
      h("p", { class: "hint" }, "Two devices? Start a session on the one facing the client, then pair it with a second device used as the clinician remote."),
      h("p", { class: "fineprint" }, "Experimental touch-free patient-response interface for behavioural audiometry. Not a diagnostic or certified medical device."),
    ),
  );
};
