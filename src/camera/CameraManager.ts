export type CameraErrorKind = "permission" | "no-camera" | "in-use" | "insecure" | "unsupported" | "other";

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message: string) { super(message); }
}

/** Owns the single <video> element and the camera stream. Video only; never audio. */
export class CameraManager {
  readonly video: HTMLVideoElement;
  stream?: MediaStream;
  info = "";
  /** Last failure of video.play(), for diagnostics (e.g. blocked without a tap, Low Power Mode). */
  lastPlayError = "";
  /** Called if the camera track ends or is muted by the OS (e.g. app backgrounded, another app took the camera). */
  onTrackProblem?: (why: string) => void;

  constructor() {
    const v = document.createElement("video");
    // muted + autoplay + playsinline is the combination iOS needs to start a camera
    // stream without a tap. (The parked video is kept properly visible, so iOS's
    // "pause invisible autoplay video" policy shouldn't apply.)
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.setAttribute("autoplay", "");
    // Any tap anywhere resumes a video the browser refused to play or paused (taps count as permission).
    document.addEventListener("pointerdown", () => this.nudge(), { capture: true, passive: true });
    v.className = "camera-video";
    this.video = v;
  }

  get running(): boolean { return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === "live"); }

  async start(deviceId: string, resolution: number): Promise<void> {
    if (!window.isSecureContext) throw new CameraError("insecure", "The camera needs a secure (HTTPS) connection.");
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("unsupported", "This browser does not provide camera access.");
    this.stop();
    const size = resolution >= 720 ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const base: MediaTrackConstraints = { ...size, frameRate: { ideal: 30, max: 60 } };
    const attempts: MediaTrackConstraints[] = deviceId
      ? [{ ...base, deviceId: { exact: deviceId } }, { ...base, facingMode: "user" }, {}]
      : [{ ...base, facingMode: "user" }, base, {}];
    let lastErr: unknown;
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio: false });
        break;
      } catch (e) {
        lastErr = e;
        const name = (e as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") break; // don't retry a refusal
      }
    }
    if (!this.stream) throw this.mapError(lastErr);
    const track = this.stream.getVideoTracks()[0];
    const stream = this.stream;
    track?.addEventListener("ended", () => { if (this.stream === stream) this.onTrackProblem?.("camera stopped"); });
    // iOS mutes the camera briefly during some system interruptions and unmutes it
    // again by itself. Only treat it as a problem if it stays muted.
    track?.addEventListener("mute", () => {
      setTimeout(() => { if (this.stream === stream && track.muted && track.readyState === "live") this.onTrackProblem?.("camera paused by the system"); }, 2000);
    });
    this.video.srcObject = this.stream;
    await this.play();
    await new Promise<void>((res) => {
      if (this.video.readyState >= 2) return res();
      this.video.addEventListener("loadeddata", () => res(), { once: true });
      setTimeout(res, 3000);
    });
    const s = this.stream.getVideoTracks()[0]?.getSettings() ?? {};
    this.info = `${s.width ?? "?"}×${s.height ?? "?"} @ ${s.frameRate ? Math.round(s.frameRate) : "?"} fps${s.facingMode ? ` (${s.facingMode})` : ""}`;
  }

  async play(): Promise<void> {
    try { await this.video.play(); this.lastPlayError = ""; }
    catch (e) { this.lastPlayError = `${(e as DOMException)?.name ?? "error"}: ${(e as Error)?.message ?? e}`; }
  }

  /** Resume the video element if the browser paused it. Cheap; no new camera request. */
  nudge(): boolean {
    if (!this.video.paused || !this.running) return false;
    void this.play();
    return true;
  }

  get trackLive(): boolean {
    const t = this.stream?.getVideoTracks()[0];
    return !!t && t.readyState === "live" && !t.muted;
  }

  get activeDeviceId(): string { return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ""; }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); }
    catch { return []; }
  }

  /** Re-insert and resume the video wherever a screen needs it. */
  mount(parent: HTMLElement, className = "camera-video"): void {
    this.video.className = className;
    parent.appendChild(this.video);
    void this.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
  }

  private mapError(e: unknown): CameraError {
    const name = (e as DOMException)?.name;
    switch (name) {
      case "NotAllowedError": case "SecurityError":
        return new CameraError("permission", "Camera access was refused.");
      case "NotFoundError": case "OverconstrainedError":
        return new CameraError("no-camera", "No usable camera was found.");
      case "NotReadableError": case "AbortError":
        return new CameraError("in-use", "The camera is in use by another app or tab.");
      default:
        return new CameraError("other", `The camera could not be started (${name ?? String(e)}).`);
    }
  }
}
