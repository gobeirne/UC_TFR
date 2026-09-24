import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { RawFace } from "./FeatureExtractor";

/** Fallback used only if the locally bundled model is missing (e.g. `npm run setup` not run). */
const REMOTE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface DetectResult { faces: number; raw?: RawFace }

/** The only module that touches MediaPipe. Swap this to change tracker. */
export class MediaPipeFaceTracker {
  private lm?: FaceLandmarker;
  private lastTs = 0;
  delegate: "GPU" | "CPU" = "CPU";
  modelSource = "";
  private fileset?: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
  private model?: Uint8Array;
  /** Set when the browser discards the tracker's WebGL context (common on iOS after backgrounding). */
  contextLost = false;
  onContextLost?: () => void;

  get ready() { return !!this.lm; }

  async init(pref: "auto" | "GPU" | "CPU"): Promise<void> {
    const base = new URL(".", document.baseURI);
    this.fileset ??= await FilesetResolver.forVisionTasks(new URL("wasm", base).href.replace(/\/$/, ""));
    this.model ??= await this.loadModel(new URL("models/face_landmarker.task", base).href);
    const order: ("GPU" | "CPU")[] = pref === "CPU" ? ["CPU"] : pref === "GPU" ? ["GPU", "CPU"] : ["GPU", "CPU"];
    let lastErr: unknown;
    for (const d of order) {
      try { await this.create(d); return; } catch (e) { lastErr = e; console.warn(`FaceLandmarker ${d} delegate failed`, e); }
    }
    throw lastErr ?? new Error("Face tracker could not start");
  }

  /** Throw away the tracker and build a fresh one (new WebGL context). Model stays in memory, so this is quick. */
  async rebuild(delegate: "GPU" | "CPU" = this.delegate): Promise<void> {
    this.close();
    try { await this.create(delegate); }
    catch (e) { if (delegate === "GPU") await this.create("CPU"); else throw e; }
  }

  private async create(delegate: "GPU" | "CPU") {
    this.close();
    // Our own canvas, so we can see when the browser drops its WebGL context.
    const canvas = document.createElement("canvas");
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    this.contextLost = false;
    this.lm = await FaceLandmarker.createFromOptions(this.fileset!, {
      canvas,
      baseOptions: { modelAssetBuffer: this.model!, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    this.delegate = delegate;
  }

  private async loadModel(localUrl: string): Promise<Uint8Array> {
    const tryFetch = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const ct = r.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await r.arrayBuffer());
      if (ct.includes("text/html") || buf.byteLength < 500_000) throw new Error("not a model file");
      return buf;
    };
    try { const b = await tryFetch(localUrl); this.modelSource = "bundled"; return b; }
    catch (e) {
      console.warn("Bundled model unavailable, trying Google-hosted model", e);
      const b = await tryFetch(REMOTE_MODEL); this.modelSource = "remote (run npm run setup to bundle it)"; return b;
    }
  }

  detect(video: HTMLVideoElement, nowMs: number): DetectResult {
    if (!this.lm) throw new Error("tracker not initialised");
    if (this.contextLost) throw new Error("tracker graphics context lost");
    // VIDEO mode requires strictly increasing integer timestamps.
    const ts = Math.max(this.lastTs + 1, Math.round(nowMs));
    this.lastTs = ts;
    const res = this.lm.detectForVideo(video, ts);
    const faces = res.faceLandmarks?.length ?? 0;
    if (!faces) return { faces: 0 };
    const blend: Record<string, number> = {};
    for (const c of res.faceBlendshapes?.[0]?.categories ?? []) blend[c.categoryName] = c.score;
    return {
      faces,
      raw: {
        landmarks: res.faceLandmarks[0],
        imageWidth: video.videoWidth,
        imageHeight: video.videoHeight,
        blendshapes: Object.keys(blend).length ? blend : undefined,
        transform: res.facialTransformationMatrixes?.[0]?.data,
      },
    };
  }

  close() { try { this.lm?.close(); } catch { /* ignore */ } this.lm = undefined; }
}
