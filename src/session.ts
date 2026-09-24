import type { CalibrationModel } from "./calibration/CalibrationModel";
import type { SessionLogger } from "./logging/SessionLogger";
import type { TrackingSample } from "./tracking/TrackingSample";

/** Lives in memory only. Discarded at session end unless the clinician exports the log. */
export interface Session {
  id: string;
  startedAt: Date;
  t0: number; // performance.now() at start
  participantCode: string;
  forwardSamples?: TrackingSample[];
  calibration?: CalibrationModel;
  logger?: SessionLogger;
  deviceMovedNote?: string;
  lastTestSummary?: { responses: number; durationMs: number; lostMs: number };
}

export function newSession(participantCode: string): Session {
  const id = (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2);
  return { id, startedAt: new Date(), t0: performance.now(), participantCode };
}
