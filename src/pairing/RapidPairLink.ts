import type { LinkStatus, PairLink, PairRole } from "./PairLink";
import { MSG } from "./protocol";

/**
 * Wraps the UC KTT <rapid-pair> element (vendor/rapidpair.js, unchanged) and ports
 * the link-health lessons from KTT's pairedMode.js:
 *  - sends are checked; repeated failures mean the link is gone even without an event;
 *  - a watchdog notices a channel that died silently;
 *  - a wedged element is thrown away and rebuilt (the only reliable recovery);
 *  - each side tells the other when it is backgrounded.
 * Vendor scripts are loaded only when pairing is first used.
 */
const VENDOR_SCRIPTS = ["vendor/pako.min.js", "vendor/qrcode.js", "vendor/html5-qrcode.min.js", "vendor/rapidpair.js"];
let vendorLoad: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = new URL(src, document.baseURI).href;
    el.onload = () => res();
    el.onerror = () => rej(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}
export function loadRapidPair(): Promise<void> {
  vendorLoad ??= (async () => {
    for (const s of VENDOR_SCRIPTS) await loadScript(s);
    if (!customElements.get("rapid-pair")) throw new Error("RapidPair did not register");
  })().catch((e) => { vendorLoad = null; throw e; });
  return vendorLoad;
}

const SEND_FAIL_LIMIT = 3;
const WATCHDOG_MS = 3000;
const STALLED_RECONNECT_MS = 20000;

export class RapidPairLink implements PairLink {
  private el: any = null;
  private appended = false;
  private routed = new Set<string>();
  private listeners = new Map<string, Set<(p: any) => void>>();
  private statusSubs = new Set<(s: LinkStatus) => void>();
  private sendFailures = 0;
  private downSince: number | null = null;
  private disconnectTimer = 0;
  private connectSeq = 0;
  private wantRole: PairRole | null = null;
  status: LinkStatus = { connected: false, state: "idle", role: null, peerBackground: false };

  constructor() {
    window.setInterval(() => this.watchdog(), WATCHDOG_MS);
    document.addEventListener("visibilitychange", () => this.reportBackground(document.visibilityState === "hidden"));
    window.addEventListener("pagehide", () => this.reportBackground(true));
    this.on(MSG.bg, (p) => this.setStatus({ peerBackground: !!p?.bg }));
  }

  async open(role: PairRole): Promise<void> {
    await loadRapidPair();
    this.wantRole = role;
    if (this.status.connected && !this.channelReallyOpen()) this.hardReset("stale pairing state on open");
    if (!this.el) this.build();
    if (!this.appended) { document.body.appendChild(this.el); this.appended = true; }
    this.el.openAs(role === "clinician" ? "controller" : "responder");
  }

  isDialogOpen(): boolean {
    const w = this.el?._modalWrapper as HTMLElement | undefined;
    return !!w && w.isConnected && w.style.display !== "none";
  }
  closeDialog(): void { try { this.el?.close?.(); } catch { /* ignore */ } }

  send(type: string, payload: unknown): boolean {
    if (!this.el || !this.status.connected) return false;
    let ok = this.channelReallyOpen();
    if (ok) { try { this.el.send(type, payload); } catch { ok = false; } }
    if (ok) { this.sendFailures = 0; return true; }
    if (++this.sendFailures >= SEND_FAIL_LIMIT) this.markDisconnected();
    return false;
  }

  on(type: string, cb: (p: any) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    this.route(type);
    return () => this.listeners.get(type)?.delete(cb);
  }

  onStatus(cb: (s: LinkStatus) => void): () => void { this.statusSubs.add(cb); cb(this.status); return () => this.statusSubs.delete(cb); }

  disconnect(): void {
    this.wantRole = null;
    try { this.el?.disconnect?.(); } catch { /* ignore */ }
    this.hardReset("disconnected by user");
    this.setStatus({ connected: false, state: "idle", role: null, peerBackground: false });
  }

  // ---- internals ----
  private route(type: string) {
    if (!this.el || this.routed.has(type)) return;
    this.routed.add(type);
    this.el.on(type, (p: any) => { for (const cb of this.listeners.get(type) ?? []) { try { cb(p); } catch (e) { console.error(e); } } });
  }

  private build() {
    const el = document.createElement("rapid-pair") as any;
    el.setAttribute("controller-label", "Clinician");
    el.setAttribute("responder-label", "Patient device");
    el.setAttribute("auto-close", "true");
    el.addEventListener("secure", (e: CustomEvent) => this.onConnected(e.detail?.role));
    el.addEventListener("reconnected", (e: CustomEvent) => this.onConnected(e.detail?.role));
    el.addEventListener("disconnected", () => this.onDisconnectedEvent());
    el.addEventListener("linkquality", (e: CustomEvent) => this.setStatus({ state: e.detail?.state ?? "idle", rttMs: e.detail?.rtt ?? undefined }));
    el.addEventListener("linkrecovered", () => this.setStatus({ peerBackground: false }));
    this.el = el;
    this.routed.clear();
    for (const type of this.listeners.keys()) this.route(type);
  }

  private onConnected(rpRole?: string) {
    this.connectSeq++;
    this.sendFailures = 0; this.downSince = null;
    const role: PairRole = rpRole === "controller" ? "clinician" : "patient";
    this.setStatus({ connected: true, state: "live", role, peerBackground: false });
  }

  private onDisconnectedEvent() {
    // RapidPair can fire this in bursts during ICE failure; debounce, and ignore if a new connection arrived.
    const seq = this.connectSeq;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = window.setTimeout(() => { if (this.connectSeq === seq) this.markDisconnected(); }, 500);
    // On the patient device RapidPair re-opens its dialog by itself. Over a black
    // test screen that would be a white box in the client's face: hide it. The
    // clinician re-pairs from the patient device when convenient.
    if (this.status.role === "patient" || this.wantRole === "patient") setTimeout(() => this.closeDialog(), 0);
  }

  private markDisconnected() {
    if (!this.status.connected && this.downSince) return;
    this.downSince ??= Date.now();
    this.sendFailures = 0;
    this.setStatus({ connected: false, state: "idle", peerBackground: false });
  }

  private channelReallyOpen(): boolean {
    if (!this.el) return false;
    if (typeof this.el.isSecure === "function" && !this.el.isSecure()) return false;
    const dc = this.el._dc;
    return !(dc && dc.readyState && dc.readyState !== "open");
  }

  private watchdog() {
    if (!this.el) return;
    if (this.status.connected && !this.channelReallyOpen()) { this.markDisconnected(); return; }
    // RapidPair's controller reconnect can die quietly; if nothing is retrying, rebuild and show a fresh code.
    if (!this.status.connected && this.status.role === "clinician" && this.wantRole === "clinician" && this.downSince
        && Date.now() - this.downSince > STALLED_RECONNECT_MS && !this.el._reconnectTimer && !this.el._reconnecting) {
      this.downSince = null;
      this.hardReset("stalled reconnect");
      void this.open("clinician");
    }
  }

  private hardReset(reason: string) {
    console.warn("[pairing] hard reset:", reason);
    const wrapper: HTMLElement | undefined = this.el?._modalWrapper;
    try { this.el?._cleanup?.(); } catch { /* ignore */ }
    try { this.el?.remove?.(); } catch { /* ignore */ }
    // RapidPair appends its dialog to <body> separately from the element (no class name).
    try { wrapper?.remove(); } catch { /* ignore */ }
    this.el = null; this.appended = false; this.routed.clear();
  }

  private reportBackground(bg: boolean) { if (this.status.connected) this.send(MSG.bg, { bg }); }

  private setStatus(p: Partial<LinkStatus>) {
    this.status = { ...this.status, ...p };
    for (const cb of this.statusSubs) { try { cb(this.status); } catch (e) { console.error(e); } }
  }
}
