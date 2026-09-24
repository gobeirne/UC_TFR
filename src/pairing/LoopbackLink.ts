import type { LinkStatus, PairLink, PairRole } from "./PairLink";

/**
 * DEVELOPMENT ONLY (?loopback): pairs two tabs of the same browser through a
 * BroadcastChannel, so the clinician/patient flow can be exercised on one
 * computer without RapidPair, Firebase or a second device.
 */
export class LoopbackLink implements PairLink {
  private ch = new BroadcastChannel("tfr-loopback");
  private listeners = new Map<string, Set<(p: any) => void>>();
  private statusSubs = new Set<(s: LinkStatus) => void>();
  private role: PairRole | null = null;
  status: LinkStatus = { connected: false, state: "idle", role: null, peerBackground: false };

  constructor() {
    window.addEventListener("pagehide", () => this.ch.postMessage({ k: "bye" }));
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m?.k === "hello" && this.role && m.role !== this.role) {
        if (!this.status.connected) this.ch.postMessage({ k: "hello", role: this.role });
        this.setStatus({ connected: true, state: "live", role: this.role });
      } else if (m?.k === "bye") this.setStatus({ connected: false, state: "idle" });
      else if (m?.k === "msg" && m.from !== this.role) for (const cb of this.listeners.get(m.t) ?? []) cb(m.p);
    };
  }
  async open(role: PairRole) { this.role = role; this.ch.postMessage({ k: "hello", role }); }
  isDialogOpen() { return false; }
  closeDialog() {}
  send(t: string, p: unknown) { if (!this.status.connected) return false; this.ch.postMessage({ k: "msg", t, p, from: this.role }); return true; }
  on(t: string, cb: (p: any) => void) { if (!this.listeners.has(t)) this.listeners.set(t, new Set()); this.listeners.get(t)!.add(cb); return () => this.listeners.get(t)?.delete(cb); }
  onStatus(cb: (s: LinkStatus) => void) { this.statusSubs.add(cb); cb(this.status); return () => this.statusSubs.delete(cb); }
  disconnect() { this.ch.postMessage({ k: "bye" }); this.setStatus({ connected: false, state: "idle", role: null }); this.role = null; }
  private setStatus(p: Partial<LinkStatus>) { this.status = { ...this.status, ...p }; for (const cb of this.statusSubs) cb(this.status); }
}
