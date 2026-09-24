import "./styles.css";
import { loadSettings, saveSettings } from "./config/settings";
import { CameraManager } from "./camera/CameraManager";
import { TrackingEngine } from "./tracking/TrackingEngine";
import type { App, Screen, ScreenName } from "./ui/app";
import { HomeScreen } from "./ui/HomeScreen";
import { StartScreen, PositionScreen } from "./ui/SetupScreens";
import { CalibrateForwardScreen, CalibrateResponseScreen, ResultScreen } from "./ui/CalibrationScreen";
import { ValidationScreen } from "./ui/ValidationScreen";
import { TestScreen, SummaryScreen } from "./ui/TestScreen";
import { DeveloperScreen } from "./ui/DeveloperScreen";
import { SettingsScreen } from "./ui/SettingsScreen";
import { AboutScreen } from "./ui/AboutScreen";

const SCREENS: Record<ScreenName, Screen> = {
  home: HomeScreen, start: StartScreen, position: PositionScreen,
  "calibrate-forward": CalibrateForwardScreen, "calibrate-response": CalibrateResponseScreen, result: ResultScreen,
  validation: ValidationScreen, test: TestScreen, summary: SummaryScreen,
  developer: DeveloperScreen, settings: SettingsScreen, about: AboutScreen,
};
const NEEDS_SESSION: ScreenName[] = ["start", "position", "calibrate-forward", "calibrate-response", "result", "validation", "test", "summary", "developer"];
const NEEDS_CALIBRATION: ScreenName[] = ["result", "validation", "test", "summary"];
const NEEDS_TRACKING: ScreenName[] = ["position", "calibrate-forward", "calibrate-response", "validation", "test", "developer"];

const root = document.getElementById("app")!;
// The video must stay in the document between screens or browsers pause it.
const parking = document.createElement("div");
parking.className = "hidden-video";
document.body.appendChild(parking);

const settings = loadSettings();
const camera = new CameraManager();
const engine = new TrackingEngine(camera, settings);
let cleanup: void | (() => void);

const app: App = {
  root, settings, camera, engine,
  go(name) {
    if (NEEDS_SESSION.includes(name) && !app.session) name = "home";
    if (NEEDS_CALIBRATION.includes(name) && !app.session?.calibration) name = app.session ? "position" : "home";
    if (NEEDS_TRACKING.includes(name) && !app.engine.ready) name = app.session ? "start" : "home";
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = undefined;
    camera.mount(parking, "hidden-video-el");
    root.replaceChildren();
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
    cleanup = SCREENS[name](app);
  },
  saveSettings: () => saveSettings(settings),
  endSession() {
    engine.stop();
    camera.stop();
    app.session = undefined; // discards calibration and any unexported log
    app.go("home");
  },
};

if (import.meta.env.DEV && new URLSearchParams(location.search).has("sim")) {
  import("./dev/simulator").then(({ installSimulator }) => installSimulator(engine));
  (window as any).__app = app;
}

app.go("home");

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service worker registration failed", e));
  });
}
