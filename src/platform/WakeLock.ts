/** Keeps the screen on during test mode where supported. Absence is not an error. */
export class WakeLockManager {
  private sentinel: any = null;
  private wanted = false;
  status: "unsupported" | "active" | "released" | "denied" = "wakeLock" in navigator ? "released" : "unsupported";
  private onVis = () => { if (this.wanted && document.visibilityState === "visible") void this.acquire(); };

  static supported(): boolean { return "wakeLock" in navigator; }

  async request(): Promise<void> {
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVis);
    await this.acquire();
  }

  private async acquire(): Promise<void> {
    if (!("wakeLock" in navigator) || this.sentinel) return;
    try {
      this.sentinel = await (navigator as any).wakeLock.request("screen");
      this.status = "active";
      this.sentinel.addEventListener?.("release", () => { this.sentinel = null; if (this.status === "active") this.status = "released"; });
    } catch { this.status = "denied"; }
  }

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVis);
    try { await this.sentinel?.release(); } catch { /* ignore */ }
    this.sentinel = null; if (this.status !== "unsupported") this.status = "released";
  }
}
