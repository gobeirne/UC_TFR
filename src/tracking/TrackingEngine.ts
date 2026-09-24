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
}

const STALL_MS = 700;

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

  constructor(private camera: CameraManager, private settings: Settings) {}

  subscribe(fn: (s: TrackingSample) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }

  async initTracker(): Promise<void> { if (!this.ready) await this.tracker.init(this.settings.delegate); }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastSampleAt = performance.now();
    this.lastFrameCb = performance.now();
    this.forceRaf = false;
    this.schedule();
    this.watchdog = window.setInterval(() => this.checkStall(), 250);
  }

  stop(): void {
    this.running = false;
    const v = this.camera.video as any;
    if (this.rvfcHandle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcHandle);
    cancelAnimationFrame(this.rafHandle);
    clearInterval(this.watchdog);
    this.mode = "idle";
  }

  private schedule(): void {
    if (!this.running) return;
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
    } catch (e) {
      this.errorCount++; this.consecutiveErrors++;
      console.error("Tracking error", e);
      sample = invalidSample(frameTime, "tracker-error");
      if (this.consecutiveErrors === 3 && this.tracker.delegate === "GPU") {
        this.tracker.fallbackToCpu().catch((err) => console.error("CPU fallback failed", err));
      }
    } finally {
      this.busy = false;
    }
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
    if (this.running && now - this.lastSampleAt > STALL_MS) this.emit(invalidSample(now, "stalled"));
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
    };
  }
}
