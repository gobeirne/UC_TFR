import type { Settings } from "../config/defaults";
import type { CameraManager } from "../camera/CameraManager";
import type { TrackingEngine } from "../tracking/TrackingEngine";
import type { Session } from "../session";
import type { CalibrationService } from "../calibration/CalibrationService";
import type { ResponsePipeline } from "../detection/ResponsePipeline";
import type { ResponseOutput } from "../outputs/ResponseOutput";
import type { PairingManager } from "../pairing/PairingManager";

export type ScreenName = "home" | "start" | "position" | "calibrate-forward" | "calibrate-response" | "calibrate-add-response" | "result"
  | "validation" | "test" | "summary" | "developer" | "settings" | "about" | "remote" | "diagnostics";

export interface App {
  root: HTMLElement;
  settings: Settings;
  camera: CameraManager;
  engine: TrackingEngine;
  session?: Session;
  calibration: CalibrationService;
  pairing: PairingManager;
  screen: ScreenName;
  /** The pipeline currently driving responses (try-out, test or developer screen). */
  activePipeline?: ResponsePipeline;
  /**
   * Register a screen's pipeline: attaches plug-in outputs (e.g. the paired
   * remote), follows recalibrations and suspends during recordings.
   * Returns the cleanup function.
   */
  registerPipeline(p: ResponsePipeline): () => void;
  /** Output plug-ins attached to every registered pipeline. */
  outputFactories: Map<string, () => ResponseOutput>;
  go(screen: ScreenName): void;
  saveSettings(): void;
  /** Fully end the session: stop camera, discard calibration and logs. */
  endSession(): void;
}

export type Screen = (app: App) => void | (() => void);
