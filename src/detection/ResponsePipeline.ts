import type { DetectionMode, Settings } from "../config/defaults";
import { MOVEMENT } from "../config/defaults";
import type { CalibrationModel } from "../calibration/CalibrationModel";
import { ResponseClassifier, type Classification } from "./ResponseClassifier";
import { ResponseStateMachine, type Transition } from "./ResponseStateMachine";
import type { TrackingSample } from "../tracking/TrackingSample";
import { OutputManager } from "../outputs/OutputManager";
import type { SessionLogger } from "../logging/SessionLogger";
import { DriftTracker } from "./DriftTracker";
import { EyeContactClassifier } from "../calibration/EyeContactModel";

export interface PipelineTick {
  sample: TrackingSample;
  c: Classification;
  transitions: Transition[];
  mode: DetectionMode;
}

/**
 * sample → classifier(s) → state machine → RESPONSE_ON/OFF → OutputManager.
 * The pipeline has no idea what the outputs do. All modes are scored every
 * frame; the selected one drives the state machine.
 */
export class ResponsePipeline {
  classifier!: ResponseClassifier;
  eye?: EyeContactClassifier;
  drift!: DriftTracker;
  movement!: MovementMonitor;
  readonly machine: ResponseStateMachine;
  readonly outputs = new OutputManager();
  responses = 0;
  lastTick?: PipelineTick;
  /** Set when the chosen mode can't run with this calibration and adaptive is used instead. */
  modeFallback = "";
  /** While suspended (e.g. recording a calibration) nothing can register as a response. */
  suspended = false;
  private listeners = new Set<(t: PipelineTick) => void>();
  private lastMode?: DetectionMode;

  constructor(model: CalibrationModel, private settings: Settings, public logger?: SessionLogger) {
    this.machine = new ResponseStateMachine(() => settings);
    this.setModel(model);
  }

  get model(): CalibrationModel { return this.classifier.model; }

  /** Swap in a new calibration. The client must look forward again before the next response counts. */
  setModel(model: CalibrationModel) {
    if (this.classifier) this.stop(performance.now());
    this.classifier = new ResponseClassifier(model, () => this.settings.offAxisGate);
    this.eye = model.eye?.usable ? new EyeContactClassifier(model.eye) : undefined;
    this.drift = new DriftTracker(model, () => this.settings.driftTimeConstantS);
    this.movement = new MovementMonitor(model);
    this.machine.reset();
  }

  onTick(fn: (t: PipelineTick) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  suspend(t: number) { this.stop(t); this.suspended = true; }
  resume() { this.suspended = false; this.machine.reset(); }

  effectiveMode(): DetectionMode {
    const m = this.settings.detectionMode;
    if ((m === "eye" || m === "cautious") && !this.eye) {
      this.modeFallback = `${m === "eye" ? "Eye-contact" : "Cautious"} mode isn't available with this calibration (${this.model.eye?.problem ?? "no eye-contact model"}); using adaptive baseline.`;
      return "adaptive";
    }
    this.modeFallback = "";
    return m;
  }

  process(sample: TrackingSample): PipelineTick {
    const mode = this.effectiveMode();
    if (this.lastMode !== undefined && mode !== this.lastMode) {
      // Changing mode mid-stream: end any response and require a forward look.
      this.stop(sample.timestampMs);
      this.logger?.logNote(sample.timestampMs, `mode_${mode}`);
    }
    this.lastMode = mode;

    const fixed = this.classifier.classify(sample);
    const adaptive = this.classifier.classify(sample, this.drift.forwardMean());
    const eye = this.eye?.classify(sample);
    this.drift.update(sample, adaptive.score, adaptive.valid, adaptive.onAxis);

    let c: Classification;
    switch (mode) {
      case "fixed": c = fixed; break;
      case "adaptive": c = adaptive; break;
      case "eye": c = { valid: !!eye?.valid, score: eye?.score ?? 0, offAxis: 0, onAxis: true, coverage: 1 }; break;
      case "cautious": c = {
        valid: adaptive.valid && !!eye?.valid,
        score: Math.min(adaptive.score, eye?.score ?? -Infinity),
        offAxis: adaptive.offAxis, onAxis: adaptive.onAxis, coverage: adaptive.coverage,
      }; break;
    }
    c = { ...c, scores: {
      fixed: fixed.valid ? fixed.score : undefined,
      adaptive: adaptive.valid ? adaptive.score : undefined,
      eye: eye?.valid ? eye.score : undefined,
      eyeAngle: eye?.valid ? eye.angle : undefined,
    } };

    if (this.suspended) {
      const tick = { sample, c: { ...c, valid: false }, transitions: [], mode };
      this.lastTick = tick;
      for (const l of this.listeners) l(tick);
      return tick;
    }

    const transitions = this.machine.update({
      timestampMs: sample.timestampMs,
      valid: c.valid,
      score: c.score,
      canActivate: c.onAxis,
      hardLoss: sample.invalidReason === "stalled" || sample.invalidReason === "recovering" || sample.invalidReason === "tracker-error",
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
    const tick = { sample, c, transitions, mode };
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
