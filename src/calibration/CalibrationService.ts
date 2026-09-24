import type { App } from "../ui/app";
import type { TrackingSample } from "../tracking/TrackingSample";
import { buildCalibration, type CalibrationModel } from "./CalibrationModel";
import { gradeForMode, type ModeGrade } from "./CalibrationQuality";

export type RecordKind = "forward" | "response" | "add-response";

export interface RecordOutcome {
  ok: boolean;
  kind: RecordKind;
  message?: string;
  /** Forward recorded but no response recording exists yet. */
  needsResponse?: boolean;
  model?: CalibrationModel;
  grade?: ModeGrade;
}

export type CalEvent =
  | { type: "recording"; kind: RecordKind; progress: number }
  | { type: "recorded"; outcome: RecordOutcome }
  | { type: "applied"; model: CalibrationModel };

/**
 * Records calibration positions and builds/applies calibrations. Screen-independent,
 * so a paired clinician remote can recalibrate while the client's screen stays black.
 */
export class CalibrationService {
  recording: RecordKind | null = null;
  progress = 0;
  private subs = new Set<(e: CalEvent) => void>();
  constructor(private app: App) {}

  on(fn: (e: CalEvent) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private emit(e: CalEvent) { for (const f of this.subs) { try { f(e); } catch (err) { console.error(err); } } }

  async record(kind: RecordKind): Promise<RecordOutcome> {
    const { app } = this;
    const s = app.session;
    const fail = (message: string): RecordOutcome => ({ ok: false, kind, message });
    if (this.recording) return fail("A recording is already in progress.");
    if (!s || !app.engine.ready) return fail("The patient device isn't running a session. Tap Start new session on it first.");
    if (kind !== "forward" && !s.forwardSamples) return fail("Record the forward position first.");
    if (kind === "add-response" && !s.responseSets?.length) kind = "response";

    this.recording = kind; this.progress = 0;
    this.emit({ type: "recording", kind, progress: 0 });
    const samples: TrackingSample[] = [];
    const t0 = performance.now();
    const settle = app.settings.calibrationSettleMs, dur = app.settings.calibrationRecordMs;
    const unsub = app.engine.subscribe((smp) => { if (smp.frameTimeMs - t0 >= settle) samples.push(smp); });
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        this.progress = Math.min(1, (performance.now() - t0) / (settle + dur));
        this.emit({ type: "recording", kind, progress: this.progress });
        if (this.progress >= 1) { clearInterval(tick); resolve(); }
      }, 100);
    });
    unsub();
    this.recording = null;

    const valid = samples.filter((x) => x.valid).length;
    let outcome: RecordOutcome;
    if (valid < 8 || valid / Math.max(1, samples.length) < 0.5) {
      outcome = fail(kind === "forward"
        ? "No face detected for most of the recording. Reposition the device or client, then record again."
        : "The face was lost while looking at the device. Try moving the device a little less far to the side, or ask the client to turn their head slightly toward it.");
    } else {
      if (kind === "forward") s.forwardSamples = samples;
      else if (kind === "response") s.responseSets = [samples];
      else s.responseSets = [...(s.responseSets ?? []), samples];
      if (!s.responseSets?.length) outcome = { ok: true, kind, needsResponse: true };
      else {
        const model = buildCalibration(s.forwardSamples!, s.responseSets, performance.now(), app.settings.eyeScaleDeg);
        s.pendingCalibration = model;
        outcome = { ok: true, kind, model, grade: gradeForMode(model, app.settings.detectionMode) };
      }
    }
    this.emit({ type: "recorded", outcome });
    return outcome;
  }

  apply(model = this.app.session?.pendingCalibration): boolean {
    const s = this.app.session;
    if (!s || !model) return false;
    s.calibration = model;
    s.pendingCalibration = undefined;
    s.deviceMovedNote = undefined;
    this.emit({ type: "applied", model });
    return true;
  }
}
