import type { Settings } from "../config/defaults";
import type { CameraManager } from "../camera/CameraManager";
import { MediaPipeFaceTracker } from "./MediaPipeFaceTracker";
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
}

const STALL_MS = 700;
/** Camera delivering no frames for this long while visible → restart it. */
const FROZEN_MS = 2500;
/** No face for this long, after a face has been seen, → rebuild the tracker once. */
const ZOMBIE_MS = 6000;
const ZOMBIE_RETRY_MS = 30000;

/**
 * Drives inference from camera frames at a throttled rate and publishes
 * TrackingSamples. Knows nothing about calibration or responses.
 */
export class TrackingEngine {
  readonly tracker = new MediaPipeFaceTracker();
  private subs = new Set<(s: TrackingSample) => void>();
  private running = false;
  private lastInfer = -Infinity;
  private lastMediaTime = -1;
  private lastSampleAt = 0;
  /** Last time a real camera frame was analysed (placeholder samples don't count). */
  private lastRealSampleAt = 0;
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
    } else if (this.pausedForHidden) {
      this.pausedForHidden = false;
      void this.recover("returned to the app", true);
    }
  }

  /**
   * Restart the camera (if needed) and rebuild the tracker. While this runs the
   * watchdog keeps emitting invalid samples, so nothing can register as a response.
   */
  async recover(reason: string, restartCamera = false): Promise<void> {
    if (this.recovering || !this.running) return;
    this.recovering = true;
    this.recoveries++;
    this.lastRecovery = reason;
    this.lastRecoveryAt = performance.now();
    console.warn(`Tracking recovery: ${reason}`);
    this.stopLoop();
    try {
      if (restartCamera || !this.camera.running) await this.camera.start(this.settings.cameraDeviceId, this.settings.cameraResolution);
      const toCpu = this.tracker.delegate === "GPU" && reason.startsWith("repeated tracking errors");
      if (!this.simulate) await this.tracker.rebuild(toCpu ? "CPU" : this.tracker.delegate);
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

  /** Manual "Restart camera and tracking". */
  restart(): Promise<void> { return this.recover("restarted by clinician", true); }

  subscribe(fn: (s: TrackingSample) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }

  /** New session: first time, load everything; afterwards, start from a fresh tracker anyway. */
  async initTracker(): Promise<void> {
    if (this.simulate) return;
    if (this.tracker.ready) await this.tracker.rebuild();
    else await this.tracker.init(this.settings.delegate);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
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
    this.lastMediaTime = -1;
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
      this.rvfcHandle = v.requestVideoFrameCallback((now: number, meta: { mediaTime?: number }) => {
        this.lastFrameCb = performance.now();
        this.onFrame(now, meta?.mediaTime);
        this.schedule();
      });
    } else {
      this.mode = "rAF";
      this.rafHandle = requestAnimationFrame((now) => { this.onFrame(now, v.currentTime); this.schedule(); });
    }
  }

  private onFrame(now: number, mediaTime?: number): void {
    const v = this.camera.video;
    if (mediaTime !== undefined) {
      if (mediaTime === this.lastMediaTime) return; // same frame, dedupe
      this.lastMediaTime = mediaTime;
    }
    this.frameStamps.push(now); this.trim(this.frameStamps, now);
    if (v.readyState < 2 || !v.videoWidth || !this.ready || this.busy) return;
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
      const r = this.simulate ? { sim: this.simulate(frameTime) } : this.tracker.detect(this.camera.video, frameTime);
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
    // Camera frozen while the app is visible (no new frames at all): restart it.
    if (this.running && !this.recovering && !this.pausedForHidden && document.visibilityState === "visible"
        && now - this.lastRealSampleAt > FROZEN_MS && now - this.lastRecoveryAt > 5000) {
      void this.recover("camera stopped delivering images", true);
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
    };
  }
}
