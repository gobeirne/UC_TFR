import type { Settings } from "../config/defaults";
import type { CameraManager } from "../camera/CameraManager";
import type { TrackingEngine } from "../tracking/TrackingEngine";
import type { Session } from "../session";

export type ScreenName = "home" | "start" | "position" | "calibrate-forward" | "calibrate-response" | "result"
  | "validation" | "test" | "summary" | "developer" | "settings" | "about";

export interface App {
  root: HTMLElement;
  settings: Settings;
  camera: CameraManager;
  engine: TrackingEngine;
  session?: Session;
  go(screen: ScreenName): void;
  saveSettings(): void;
  /** Fully end the session: stop camera, discard calibration and logs. */
  endSession(): void;
}

export type Screen = (app: App) => void | (() => void);
