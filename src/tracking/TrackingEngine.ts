import type { Settings } from "../config/defaults";
import type { CameraManager } from "../camera/CameraManager";
import { MediaPipeFaceTracker } from "./MediaPipeFaceTracker";
import { isIOS } from "../platform/capabilities";
import { extractFeatures } from "./FeatureExtractor";
import { invalidSample, type TrackingSample } from "./TrackingSample";

export interface EngineStats {
  inferenceFps: number;
  inferenceMsAvg: number;
  inferenceMsMax: number;
  cameraFps: number;
  skippedFrames: number;
  loop: "rVFC" | "rAF" | "idle";
  delegate: string;
  errors: number;
  recoveries: number;
  lastRecovery: string;
  cameraRestartsLastMinute: number;
  videoResumes: number;
  gaveUp: string;
  log: RecoveryLogEntry[];
  lastError: string;
  lastFaces: number;
  inputMode: string;
  ownCanvas: boolean;
  /** False when the browser gives no way to count camera frames (cameraFps then unknown). */
  frameCounter: boolean;
  /** Share of recent samples by outcome, last ~5 s. */
  outcomes: Record<string, number>;
}

export interface RecoveryLogEntry { at: number; reason: string; action: "resumed video" | "restarted camera" | "rebuilt tracker" | "gave up" }

const STALL_MS = 700;
/** Camera delivering no frames for this long while visible → restart it. */
const FROZEN_MS = 2500;
/** No face for this long, after a face has been seen, → rebuild the tracker once. */
const ZOMBIE_MS = 6000;
const ZOMBIE_RETRY_MS = 30000;
/** Loop breaker: more automatic camera restarts than this per minute and we stop and ask. */
const MAX_CAMERA_RESTARTS_PER_MIN = 3;

/**
 * Drives inference from camera frames at a throttled rate and publishes
 * TrackingSamples. Knows nothing about calibration or responses.
 */
export class TrackingEngine {
  readonly tracker = new MediaPipeFaceTracker();
  private subs = new Set<(s: TrackingSample) => void>();
  private running = false;
  private lastInfer = -Infinity;
  private lastFrameId = -1;
  private lastCurrentTime = -1;
  private sawFrameCounter = false;
  private lastSampleAt = 0;
  /** Last time a real camera frame was analysed (placeholder samples don't count). */
  private lastRealSampleAt = 0;
  /** Last time a NEW camera frame arrived (independent of whether it was analysed). */
  private lastCameraFrameAt = 0;
  private lastNudgeAt = -Infinity;
  private videoResumes = 0;
  private cameraRestarts: number[] = [];
  /** Non-empty when automatic camera restarts have been stopped to break a loop. */
  gaveUp = "";
  readonly recoveryLog: RecoveryLogEntry[] = [];
  private outcomes: { t: number; k: string }[] = [];
  private copyCanvas?: HTMLCanvasElement;
  /** Set by diagnostics to pause normal inference while it runs its own tests. */
  paused = false;
  private rvfcHandle = 0; private rafHandle = 0; private watchdog = 0;
  private lastFrameCb = 0;
  private forceRaf = false;
  private consecutiveErrors = 0;
  private busy = false;
  // stats
  private inferTimes: number[] = [];
  private inferStamps: number[] = [];
  private frameStamps: number[] = [];
  private skipped = 0;
  private mode: EngineStats["loop"] = "idle";
  private errorCount = 0;
  last?: TrackingSample;
  /** Dev-only synthetic sample source (see src/dev/simulator.ts). */
  simulate?: (t: number) => TrackingSample;

  get ready(): boolean { return !!this.simulate || this.tracker.ready; }

  private recovering = false;
  private recoveries = 0;
  private lastRecovery = "";
  private lastRecoveryAt = -Infinity;
  private lastZombieFix = -Infinity;
  private lastFaceAt = 0;
  private sawFace = false;
  private pausedForHidden = false;

  constructor(private camera: CameraManager, private settings: Settings) {
    // iOS in particular discards the camera and the tracker's graphics context when
    // the app is backgrounded or the screen locks. Detect and rebuild instead of
    // silently returning "no face" for ever.
    this.tracker.onContextLost = () => void this.recover("tracker graphics were reset by the browser");
    camera.onTrackProblem = (why) => {
      if (this.running && document.visibilityState === "visible") void this.recover(why, true);
    };
    document.addEventListener("visibilitychange", () => this.onVisibility());
    window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted && this.running) void this.recover("page restored", true); });
  }

  get isRecovering() { return this.recovering; }

  /** Leaving the app: release the camera (also better for privacy). Returning: restart everything. */
  private onVisibility(): void {
    if (!this.running) return;
    if (document.visibilityState === "hidden") {
      this.pausedForHidden = true;
      this.stopLoop();
      this.camera.stop();
      this.emit(invalidSample(performance.now(), "stalled")); // end any response now, not after the stall timeout
    } else if (this.pausedForHidden && !this.holdPaused?.()) {
      this.pausedForHidden = false;
      void this.recover("returned to the app", true);
    }
  }

  /**
   * Restart the camera (if needed) and rebuild the tracker. While this runs the
   * watchdog keeps emitting invalid samples, so nothing can register as a response.
   */
  private logRecovery(reason: string, action: RecoveryLogEntry["action"]) {
    this.recoveryLog.push({ at: Date.now(), reason, action });
    if (this.recoveryLog.length > 30) this.recoveryLog.shift();
    console.warn(`Tracking: ${action} — ${reason}`);
  }

  async recover(reason: string, restartCamera = false, manual = false): Promise<void> {
    if (this.recovering || !this.running) return;
    const now = performance.now();
    if (restartCamera || !this.camera.running) {
      this.cameraRestarts = this.cameraRestarts.filter((t) => now - t < 60000);
      if (!manual && this.cameraRestarts.length >= MAX_CAMERA_RESTARTS_PER_MIN) {
        if (!this.gaveUp) {
          this.gaveUp = `The camera keeps stopping (last reason: ${reason}). Automatic restarts are paused — use Restart camera and tracking.`;
          this.logRecovery(reason, "gave up");
        }
        return;
      }
      this.cameraRestarts.push(now);
    }
    if (manual) this.gaveUp = "";
    this.logRecovery(reason, restartCamera || !this.camera.running ? "restarted camera" : "rebuilt tracker");
    this.recovering = true;
    this.recoveries++;
    this.lastRecovery = reason;
    this.lastRecoveryAt = performance.now();
    this.stopLoop();
    this.emit(invalidSample(performance.now(), "recovering"));
    try {
      if (restartCamera || !this.camera.running) await this.camera.start(this.settings.cameraDeviceId, this.settings.cameraResolution);
      const toCpu = this.tracker.delegate === "GPU" && reason.startsWith("repeated tracking errors");
      if (!this.simulate) await this.tracker.rebuild(toCpu ? { delegate: "CPU" } : {});
    } catch (e) {
      console.error("Recovery failed", e);
      this.lastRecovery = `${reason} — recovery failed: ${(e as Error)?.message ?? e}`;
    } finally {
      this.recovering = false;
      this.consecutiveErrors = 0;
      this.sawFace = false;
      if (this.running && document.visibilityState === "visible") this.resumeLoop();
    }
  }

  /** While this returns true (pairing dialog open), returning to the app does not restart the camera. */
  holdPaused?: () => boolean;

  /** Release the camera while a pairing dialog might need it (QR scanning). Returns false if not running. */
  pauseForPairing(): boolean {
    if (!this.running || this.simulate) return false;
    this.pausedForHidden = true; // reuse the "paused" path: watchdog keeps emitting invalid samples
    this.stopLoop();
    this.camera.stop();
    this.emit(invalidSample(performance.now(), "stalled"));
    return true;
  }
  async resumeAfterPairing(): Promise<void> {
    if (!this.pausedForHidden) return;
    this.pausedForHidden = false;
    await this.recover("resumed after pairing", true);
  }

  /** Manual "Restart camera and tracking". */
  restart(): Promise<void> { return this.recover("restarted by clinician", true, true); }

  subscribe(fn: (s: TrackingSample) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }

  /** Whether to supply the tracker's canvas under the current settings. */
  wantOwnCanvas(): boolean {
    const t = this.settings.trackerCanvas;
    return t === "on" || (t === "auto" && !isIOS());
  }

  /** New session: first time, load everything; afterwards, start from a fresh tracker anyway. */
  async initTracker(): Promise<void> {
    if (this.simulate) return;
    if (this.tracker.ready) await this.tracker.rebuild({ ownCanvas: this.wantOwnCanvas() });
    else await this.tracker.init(this.settings.delegate, this.wantOwnCanvas());
  }

  /** Copy the current video frame into a canvas (input mode "canvas", and diagnostics). */
  frameToCanvas(): HTMLCanvasElement {
    const v = this.camera.video;
    this.copyCanvas ??= document.createElement("canvas");
    const c = this.copyCanvas;
    const scale = Math.min(1, 960 / Math.max(1, v.videoWidth));
    const w = Math.max(1, Math.round(v.videoWidth * scale)), h = Math.max(1, Math.round(v.videoHeight * scale));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return c;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.gaveUp = ""; this.cameraRestarts = [];
    this.lastSampleAt = performance.now();
    this.resumeLoop();
    this.watchdog = window.setInterval(() => this.checkStall(), 250);
  }

  stop(): void {
    this.running = false;
    this.pausedForHidden = false;
    this.stopLoop();
    clearInterval(this.watchdog);
  }

  private loopActive = false;

  private resumeLoop(): void {
    this.stopLoop();
    this.loopActive = true;
    this.lastFrameCb = performance.now();
    this.lastRealSampleAt = performance.now();
    this.lastCameraFrameAt = performance.now();
    this.lastFrameId = -1;
    this.lastCurrentTime = -1;
    this.forceRaf = false;
    this.schedule();
  }

  private stopLoop(): void {
    this.loopActive = false;
    const v = this.camera.video as any;
    if (this.rvfcHandle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcHandle);
    cancelAnimationFrame(this.rafHandle);
    this.rvfcHandle = 0;
    this.mode = "idle";
  }

  private schedule(): void {
    if (!this.running || !this.loopActive) return;
    const v = this.camera.video as HTMLVideoElement & { requestVideoFrameCallback?: Function };
    // Prefer frame-driven callbacks; fall back to rAF if unsupported or if they stop firing.
    if (!this.forceRaf && typeof v.requestVideoFrameCallback === "function") {
      this.mode = "rVFC";
      this.rvfcHandle = v.requestVideoFrameCallback((now: number, meta: { presentedFrames?: number }) => {
        this.lastFrameCb = performance.now();
        // rVFC fires once per new frame by definition. presentedFrames (a per-frame
        // counter) guards against duplicates. Do NOT use mediaTime for this: iPhone
        // Safari updates it only about once a second for camera streams, which
        // silently dropped 29 of every 30 frames.
        this.onFrame(now, typeof meta?.presentedFrames === "number" ? meta.presentedFrames : undefined, true);
        this.schedule();
      });
    } else {
      this.mode = "rAF";
      this.rafHandle = requestAnimationFrame((now) => {
        const q = (v as any).getVideoPlaybackQuality?.();
        const total = q && q.totalVideoFrames > 0 ? q.totalVideoFrames : undefined;
        this.onFrame(now, total, false);
        this.schedule();
      });
    }
  }

  /**
   * frameId: a per-frame counter if the browser provides one (used to skip duplicates).
   * fromFrameCallback: called by rVFC, so it is a new frame even without a counter.
   */
  private onFrame(now: number, frameId: number | undefined, fromFrameCallback: boolean): void {
    const v = this.camera.video;
    let isNew: boolean;
    if (frameId !== undefined || fromFrameCallback) this.sawFrameCounter = true;
    if (frameId !== undefined) { isNew = frameId !== this.lastFrameId; this.lastFrameId = frameId; }
    else isNew = fromFrameCallback;
    if (isNew) {
      this.frameStamps.push(now); this.trim(this.frameStamps, now);
      this.lastCameraFrameAt = performance.now();
    } else if (frameId === undefined && v.currentTime !== this.lastCurrentTime) {
      // rAF with no frame counter: currentTime is only a coarse liveness signal.
      this.lastCurrentTime = v.currentTime;
      this.lastCameraFrameAt = performance.now();
    }
    // Without any frame counter (rAF on some browsers) analyse at the inference rate anyway:
    // re-analysing an identical frame is harmless, dropping real ones is not.
    const analysable = isNew || (!fromFrameCallback && frameId === undefined);
    if (!analysable) return;
    if (v.readyState < 2 || !v.videoWidth || !this.ready || this.busy || this.paused) return;
    const interval = 1000 / Math.max(1, this.settings.inferenceHz);
    if (now - this.lastInfer < interval * 0.9) { this.skipped++; return; }
    this.lastInfer = now;
    this.infer();
  }

  private infer(): void {
    const frameTime = performance.now();
    let sample: TrackingSample;
    try {
      this.busy = true;
      const r = this.simulate ? { sim: this.simulate(frameTime) }
        : this.tracker.detect(this.settings.inputMode === "canvas" ? this.frameToCanvas() : this.camera.video, frameTime);
      const done = performance.now();
      this.inferTimes.push(done - frameTime); if (this.inferTimes.length > 60) this.inferTimes.shift();
      this.inferStamps.push(done); this.trim(this.inferStamps, done);
      sample = "sim" in r ? r.sim : r.raw ? extractFeatures(r.raw, frameTime, performance.now()) : invalidSample(frameTime, "no-face");
      this.consecutiveErrors = 0;
      if (sample.valid || sample.invalidReason === "face-at-edge") { this.sawFace = true; this.lastFaceAt = frameTime; }
      else if (this.sawFace && frameTime - this.lastFaceAt > ZOMBIE_MS && frameTime - this.lastZombieFix > ZOMBIE_RETRY_MS) {
        // A face was being tracked and has vanished for a while although frames keep coming:
        // the tracker may be silently broken. Rebuilding is cheap and harmless if the face really left.
        this.lastZombieFix = frameTime;
        void this.recover("face lost for several seconds — refreshing the tracker");
      }
    } catch (e) {
      this.errorCount++; this.consecutiveErrors++;
      console.error("Tracking error", e);
      sample = invalidSample(frameTime, "tracker-error");
      if (this.consecutiveErrors === 3) void this.recover(this.tracker.contextLost ? "tracker graphics were reset by the browser" : "repeated tracking errors");
    } finally {
      this.busy = false;
    }
    this.lastRealSampleAt = performance.now();
    this.outcomes.push({ t: frameTime, k: sample.valid ? "face" : sample.invalidReason ?? "invalid" });
    while (this.outcomes.length && frameTime - this.outcomes[0].t > 5000) this.outcomes.shift();
    this.emit(sample);
  }

  private emit(s: TrackingSample): void {
    this.last = s;
    this.lastSampleAt = s.timestampMs;
    for (const fn of this.subs) { try { fn(s); } catch (e) { console.error(e); } }
  }

  /** If frames stop arriving (camera frozen, tab throttled), emit invalid samples: never a response. */
  private checkStall(): void {
    const now = performance.now();
    if (this.running && now - this.lastSampleAt > STALL_MS) this.emit(invalidSample(now, this.recovering ? "recovering" : "stalled"));
    const active = this.running && !this.recovering && !this.pausedForHidden && !this.paused && document.visibilityState === "visible";
    if (active && now - this.lastCameraFrameAt > FROZEN_MS) {
      // 1. The video element was paused (iOS power saving): just resume it.
      if (this.camera.video.paused && this.camera.trackLive && now - this.lastNudgeAt > 1500) {
        this.lastNudgeAt = now; this.videoResumes++;
        this.camera.nudge();
        this.logRecovery("video playback was paused by the browser", "resumed video");
      // 2. The camera itself stopped: restart it (budgeted).
      } else if (now - this.lastRecoveryAt > 5000 && now - this.lastNudgeAt > 1500) {
        void this.recover(this.camera.trackLive ? "camera stopped delivering images" : "camera track ended", true);
      }
    } else if (active && now - this.lastRealSampleAt > FROZEN_MS && now - this.lastRecoveryAt > 5000) {
      // 3. Frames arrive but nothing is analysed: the tracker is stuck. No need to touch the camera.
      void this.recover("images arriving but the tracker is silent");
    }
    if (this.mode === "rVFC" && now - this.lastFrameCb > 1000 && this.camera.running && this.camera.video.readyState >= 2) {
      // rVFC has stopped firing (some browsers pause it for hidden/occluded video): switch to rAF for this run.
      const v = this.camera.video as any;
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcHandle);
      this.forceRaf = true;
      this.schedule();
    }
  }

  private trim(a: number[], now: number) { while (a.length && now - a[0] > 1000) a.shift(); }

  stats(): EngineStats {
    const avg = this.inferTimes.length ? this.inferTimes.reduce((s, v) => s + v, 0) / this.inferTimes.length : 0;
    return {
      inferenceFps: this.inferStamps.length,
      inferenceMsAvg: avg,
      inferenceMsMax: this.inferTimes.length ? Math.max(...this.inferTimes) : 0,
      cameraFps: this.frameStamps.length,
      skippedFrames: this.skipped,
      loop: this.mode,
      delegate: this.simulate ? "simulated" : this.tracker.ready ? this.tracker.delegate : "—",
      errors: this.errorCount,
      recoveries: this.recoveries,
      lastRecovery: this.lastRecovery,
      cameraRestartsLastMinute: this.cameraRestarts.filter((t) => performance.now() - t < 60000).length,
      videoResumes: this.videoResumes,
      gaveUp: this.gaveUp,
      log: [...this.recoveryLog],
      lastError: this.tracker.lastError,
      lastFaces: this.tracker.lastFaces,
      inputMode: this.settings.inputMode,
      ownCanvas: this.tracker.ownCanvas,
      frameCounter: this.sawFrameCounter,
      outcomes: this.outcomes.reduce((a, o) => { a[o.k] = (a[o.k] ?? 0) + 1; return a; }, {} as Record<string, number>),
    };
  }
}
