import type { DetectionMode } from "../config/defaults";
import type { MachineState } from "../detection/ResponseStateMachine";
import type { RecordKind } from "../calibration/CalibrationService";

/**
 * Messages between the patient device (camera, detector) and the clinician remote.
 * Only states, scores and events are ever sent — never video, images, landmarks
 * or feature values.
 */
export const MSG = {
  hello: "tfr-hello",
  status: "tfr-status",   // patient → clinician, ~4 Hz
  resp: "tfr-resp",       // patient → clinician, immediately on RESPONSE_ON / OFF
  rec: "tfr-rec",         // patient → clinician, calibration recording progress/result
  cmd: "tfr-cmd",         // clinician → patient
  ack: "tfr-ack",         // patient → clinician
  bg: "tfr-bg",           // either way: app went to background / came back
} as const;

export const PROTOCOL_VERSION = 1;

export type Command =
  | "record-forward" | "record-response" | "add-response" | "apply-pending"
  | "start-test" | "pause-test" | "set-mode" | "restart-tracking";

export interface HelloMsg { app: "tfr"; v: number; role: "clinician" | "patient"; version: string }
export interface CmdMsg { id: number; cmd: Command; mode?: DetectionMode }
export interface AckMsg { id: number; ok: boolean; message?: string }
export interface RespMsg { on: boolean; seq: number; score: number; cancelledByTrackingLoss?: boolean }

export interface StatusMsg {
  seq: number;
  screen: string;
  session: boolean;
  calibrated: boolean;
  hasForward: boolean;
  tracking: boolean;
  reason?: string;
  recovering: boolean;
  mode: DetectionMode;
  modeFallback?: string;
  state?: MachineState;
  active: boolean;
  score?: number;
  responses: number;
  grade?: string;
  pendingGrade?: string;
  warnings: string[];
  recording?: { kind: RecordKind; progress: number };
  testing: boolean;
}

export interface RecMsg {
  kind: RecordKind;
  phase: "start" | "done";
  ok?: boolean;
  message?: string;
  needsResponse?: boolean;
  grade?: string;
  gradesByMode?: Partial<Record<DetectionMode, string>>;
  applied?: boolean;
  responseRecordings?: number;
}
