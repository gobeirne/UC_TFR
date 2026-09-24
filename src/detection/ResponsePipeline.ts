import type { Settings } from "../config/defaults";
import { MOVEMENT } from "../config/defaults";
import type { CalibrationModel } from "../calibration/CalibrationModel";
import { ResponseClassifier, type Classification } from "./ResponseClassifier";
import { ResponseStateMachine, type Transition } from "./ResponseStateMachine";
import type { TrackingSample } from "../tracking/TrackingSample";
import { OutputManager } from "../outputs/OutputManager";
import type { SessionLogger } from "../logging/SessionLogger";

export interface PipelineTick {
  sample: TrackingSample;
  c: Classification;
  transitions: Transition[];
}

/**
 * sample → classifier → state machine → RESPONSE_ON/OFF → OutputManager.
 * The pipeline has no idea what the outputs do.
 */
export class ResponsePipeline {
  readonly classifier: ResponseClassifier;
  readonly machine: ResponseStateMachine;
  readonly outputs = new OutputManager();
  responses = 0;
  lastTick?: PipelineTick;
  private listeners = new Set<(t: PipelineTick) => void>();
  readonly movement: MovementMonitor;

  constructor(model: CalibrationModel, settings: Settings, public logger?: SessionLogger) {
    this.classifier = new ResponseClassifier(model, () => settings.offAxisGate);
    this.machine = new ResponseStateMachine(() => settings);
    this.movement = new MovementMonitor(model);
  }

  onTick(fn: (t: PipelineTick) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  process(sample: TrackingSample): PipelineTick {
    const c = this.classifier.classify(sample);
    const transitions = this.machine.update({
      timestampMs: sample.timestampMs,
      valid: c.valid,
      score: c.score,
      canActivate: c.onAxis,
    });
    for (const tr of transitions) {
      this.logger?.logTransition(tr, sample.frameTimeMs);
      if (tr.name === "response_on") {
        this.responses++;
        this.outputs.dispatch({ type: "response-on", timestampMs: tr.timestampMs, frameTimeMs: sample.frameTimeMs, score: c.score });
      } else if (tr.name === "response_off") {
        this.outputs.dispatch({ type: "response-off", timestampMs: tr.timestampMs, frameTimeMs: sample.frameTimeMs, score: c.score,
          cancelledByTrackingLoss: tr.to === "TRACKING_LOST" });
      }
    }
    this.logger?.logSample(sample, c);
    if (this.machine.state === "FORWARD_ARMED") this.movement.update(sample);
    const tick = { sample, c, transitions };
    this.lastTick = tick;
    for (const l of this.listeners) l(tick);
    return tick;
  }

  /** Force the response off (e.g. leaving test mode). */
  stop(t: number) {
    if (this.machine.active) {
      this.outputs.dispatch({ type: "response-off", timestampMs: t, frameTimeMs: t, score: 0, cancelledByTrackingLoss: false });
    }
    this.machine.reset();
  }
}

/**
 * Gross device-movement heuristic: while armed and looking forward, compare the
 * smoothed face position/size against the forward calibration. Never recalibrates.
 */
export class MovementMonitor {
  private cx?: number; private cy?: number; private sc?: number; private lastT?: number; private accumulated = 0;
  moved = false;
  reason = "";
  constructor(private model: CalibrationModel) {}

  flag(reason: string) { this.moved = true; this.reason = reason; }

  update(s: TrackingSample) {
    if (!s.valid || s.faceCentreX === undefined || s.faceCentreY === undefined || s.faceScale === undefined) return;
    const dt = this.lastT === undefined ? 0 : Math.min(1, (s.timestampMs - this.lastT) / 1000);
    this.lastT = s.timestampMs;
    this.accumulated += dt;
    const a = this.cx === undefined ? 1 : dt / MOVEMENT.emaSeconds;
    this.cx = this.cx === undefined ? s.faceCentreX : this.cx + a * (s.faceCentreX - this.cx);
    this.cy = this.cy === undefined ? s.faceCentreY : this.cy + a * (s.faceCentreY - (this.cy as number));
    this.sc = this.sc === undefined ? s.faceScale : this.sc + a * (s.faceScale - this.sc);
    const F = this.model.F;
    if (this.accumulated < MOVEMENT.emaSeconds) return; // warm-up
    if (F.faceCentreX === undefined || F.faceCentreY === undefined || !F.faceScale) return;
    const shift = Math.hypot(this.cx - F.faceCentreX, (this.cy as number) - F.faceCentreY);
    const ratio = this.sc / F.faceScale;
    if (shift > MOVEMENT.maxCentreShift) this.flag("face position has shifted since calibration");
    else if (ratio > MOVEMENT.maxScaleRatio || ratio < 1 / MOVEMENT.maxScaleRatio) this.flag("face distance has changed since calibration");
  }
}
