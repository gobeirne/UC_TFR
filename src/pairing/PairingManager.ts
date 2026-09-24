import type { App } from "../ui/app";
import type { LinkStatus, PairLink, PairRole } from "./PairLink";
import { RapidPairLink } from "./RapidPairLink";
import { LoopbackLink } from "./LoopbackLink";
import { MSG, PROTOCOL_VERSION, type AckMsg, type CmdMsg, type Command, type RecMsg, type RespMsg, type StatusMsg } from "./protocol";
import { PairedResponseOutput } from "../outputs/PairedOutput";
import { gradeForMode, gradeOk } from "../calibration/CalibrationQuality";
import { MODE_INFO, type DetectionMode } from "../config/defaults";
import { INVALID_REASON_TEXT } from "../tracking/TrackingSample";

/** A status older than this means the remote no longer knows the client's state. */
export const STATUS_STALE_MS = 1500;

/** What the clinician remote knows about the patient device. */
export class ClinicianView {
  status?: StatusMsg;
  statusAt = 0;
  active = false;          // from immediate response events, corrected by status
  responses = 0;           // counted on the remote
  lastRec?: RecMsg;
  recording?: RecMsg;
  lastAck?: AckMsg;
  fresh(): boolean { return !!this.status && performance.now() - this.statusAt < STATUS_STALE_MS; }
}

export class PairingManager {
  link?: PairLink;
  role: PairRole | null = null;
  readonly clinician = new ClinicianView();
  private subs = new Set<() => void>();
  private cmdId = 0;
  private patientCleanup?: () => void;
  private statusTimer = 0;
  private statusSeq = 0;
  private dialogPoll = 0;

  constructor(private app: App) {}

  get status(): LinkStatus { return this.link?.status ?? { connected: false, state: "idle", role: null, peerBackground: false }; }
  get connected(): boolean { return this.status.connected; }

  onChange(fn: () => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private changed() { for (const f of this.subs) { try { f(); } catch (e) { console.error(e); } } }

  private ensureLink(): PairLink {
    if (this.link) return this.link;
    const loopback = import.meta.env.DEV && new URLSearchParams(location.search).has("loopback");
    const link: PairLink = loopback ? new LoopbackLink() : new RapidPairLink();
    link.onStatus((s) => {
      if (s.connected && s.role) this.onConnected(s.role);
      this.changed();
    });
    // Clinician-side listeners
    link.on(MSG.status, (p: StatusMsg) => {
      if (this.role !== "clinician") return;
      const v = this.clinician;
      v.status = p; v.statusAt = performance.now(); v.active = p.active;
      v.recording = p.recording ? { kind: p.recording.kind, phase: "start" } : undefined;
      this.changed();
    });
    link.on(MSG.resp, (p: RespMsg) => {
      if (this.role !== "clinician") return;
      this.clinician.active = p.on;
      if (p.on) this.clinician.responses++;
      this.changed();
    });
    link.on(MSG.rec, (p: RecMsg) => {
      if (this.role !== "clinician") return;
      if (p.phase === "done") { this.clinician.lastRec = p; this.clinician.recording = undefined; }
      else this.clinician.recording = p;
      this.changed();
    });
    link.on(MSG.ack, (p: AckMsg) => { if (this.role === "clinician") { this.clinician.lastAck = p; this.changed(); } });
    // Patient-side listener
    link.on(MSG.cmd, (p: CmdMsg) => { if (this.role === "patient") void this.handleCommand(p); });
    this.link = link;
    return link;
  }

  /** This device becomes the clinician remote. */
  async openAsClinician(): Promise<void> {
    this.role = "clinician";
    await this.ensureLink().open("clinician");
    this.changed();
  }

  /** This device (running the camera) pairs with a clinician remote. */
  async openAsPatient(): Promise<void> {
    this.role = "patient";
    const link = this.ensureLink();
    // Pairing may use the camera to scan a QR code; iPhones can't share it, so release ours meanwhile.
    const engine = this.app.engine;
    const paused = engine.pauseForPairing();
    engine.holdPaused = () => link.isDialogOpen() && !link.status.connected;
    await link.open("patient");
    clearInterval(this.dialogPoll);
    this.dialogPoll = window.setInterval(() => {
      if (link.isDialogOpen() && !link.status.connected) return;
      clearInterval(this.dialogPoll);
      engine.holdPaused = undefined;
      if (paused) void engine.resumeAfterPairing();
    }, 500);
    this.changed();
  }

  disconnect(): void {
    this.link?.disconnect();
    this.stopPatient();
    this.role = null;
    this.clinician.status = undefined;
    this.changed();
  }

  // ---------------- clinician ----------------
  command(cmd: Command, extra: Partial<CmdMsg> = {}): boolean {
    return !!this.link?.send(MSG.cmd, { id: ++this.cmdId, cmd, ...extra } satisfies CmdMsg);
  }

  // ---------------- patient ----------------
  private onConnected(role: PairRole) {
    this.role = role;
    this.link!.send(MSG.hello, { app: "tfr", v: PROTOCOL_VERSION, role, version: __APP_VERSION__ });
    if (role === "patient") this.startPatient();
    else if (this.app.screen !== "remote") this.app.go("remote");
  }

  private startPatient() {
    if (this.patientCleanup) return;
    const app = this.app;
    const send = (t: string, p: unknown) => this.link?.send(t, p) ?? false;
    // Plug the remote in as a response output on every pipeline (present and future).
    app.outputFactories.set("paired", () => new PairedResponseOutput(send));
    if (app.activePipeline && !app.activePipeline.outputs.list().includes("paired")) app.activePipeline.outputs.add(new PairedResponseOutput(send));
    const unsubCal = app.calibration.on((e) => {
      if (e.type === "recording" && e.progress === 0) send(MSG.rec, { kind: e.kind, phase: "start" } satisfies RecMsg);
      if (e.type === "recorded") {
        const o = e.outcome;
        const m = o.model;
        const gradesByMode: RecMsg["gradesByMode"] = {};
        if (m) for (const mode of Object.keys(MODE_INFO) as DetectionMode[]) gradesByMode[mode] = gradeForMode(m, mode).grade;
        send(MSG.rec, { kind: o.kind, phase: "done", ok: o.ok, message: o.message ?? (o.grade?.problem), needsResponse: o.needsResponse,
          grade: o.grade?.grade, gradesByMode, applied: false, responseRecordings: m?.responseRecordings } satisfies RecMsg);
      }
    });
    this.statusTimer = window.setInterval(() => this.sendStatus(), 250);
    this.patientCleanup = () => {
      unsubCal(); clearInterval(this.statusTimer);
      app.outputFactories.delete("paired");
      app.activePipeline?.outputs.remove("paired");
    };
  }
  private stopPatient() { this.patientCleanup?.(); this.patientCleanup = undefined; }

  private sendStatus() {
    if (!this.link?.status.connected) return;
    const app = this.app, s = app.session, p = app.activePipeline, tick = p?.lastTick;
    const last = app.engine.last;
    const warnings: string[] = [];
    if (p?.drift.warning && (app.settings.detectionMode === "adaptive" || app.settings.detectionMode === "cautious")) warnings.push(p.drift.warning);
    if (p?.movement.moved) warnings.push(`Device may have moved — consider recalibrating (${p.movement.reason}).`);
    if (s?.deviceMovedNote) warnings.push(`Device may have moved — ${s.deviceMovedNote}.`);
    if (document.visibilityState === "hidden") warnings.push("The patient device app is in the background.");
    const reason = tick && !tick.c.valid ? (tick.sample.invalidReason ? INVALID_REASON_TEXT[tick.sample.invalidReason] : "too few usable features")
      : last && !last.valid && last.invalidReason ? INVALID_REASON_TEXT[last.invalidReason] : undefined;
    const msg: StatusMsg = {
      seq: ++this.statusSeq,
      screen: app.screen,
      session: !!s,
      calibrated: !!s?.calibration,
      hasForward: !!s?.forwardSamples,
      tracking: tick ? tick.c.valid : !!last?.valid,
      reason,
      recovering: app.engine.isRecovering,
      mode: app.settings.detectionMode,
      modeFallback: p?.modeFallback || undefined,
      state: p?.machine.state,
      active: !!p?.machine.active,
      score: tick?.c.valid ? tick.c.score : undefined,
      responses: p?.responses ?? 0,
      grade: s?.calibration ? gradeForMode(s.calibration, app.settings.detectionMode).grade : undefined,
      pendingGrade: s?.pendingCalibration ? gradeForMode(s.pendingCalibration, app.settings.detectionMode).grade : undefined,
      warnings,
      recording: app.calibration.recording ? { kind: app.calibration.recording, progress: app.calibration.progress } : undefined,
      testing: app.screen === "test",
    };
    this.link.send(MSG.status, msg);
  }

  private async handleCommand(c: CmdMsg) {
    const app = this.app;
    const ack = (ok: boolean, message?: string) => this.link?.send(MSG.ack, { id: c.id, ok, message } satisfies AckMsg);
    const needSession = () => { if (!app.session || !app.engine.ready) { ack(false, "The patient device isn't running a session. Tap Start new session on it."); return false; } return true; };
    const afterApply = () => { if (["position", "calibrate-forward", "calibrate-response", "calibrate-add-response", "result"].includes(app.screen)) app.go("validation"); };
    switch (c.cmd) {
      case "record-forward": case "record-response": case "add-response": {
        if (!needSession()) return;
        ack(true);
        const kind = c.cmd === "record-forward" ? "forward" : c.cmd === "record-response" ? "response" : "add-response";
        const o = await app.calibration.record(kind);
        // Accept automatically only if good enough for the selected mode; otherwise keep the old one.
        if (o.ok && o.model && o.grade && gradeOk(o.grade.grade)) {
          app.calibration.apply(o.model);
          this.link?.send(MSG.rec, { kind: o.kind, phase: "done", ok: true, applied: true, grade: o.grade.grade } satisfies RecMsg);
          afterApply();
        }
        return;
      }
      case "apply-pending":
        if (!needSession()) return;
        if (app.calibration.apply()) { ack(true, "Calibration applied."); afterApply(); }
        else ack(false, "There is no new calibration to apply.");
        return;
      case "start-test":
        if (!needSession()) return;
        if (!app.session!.calibration) { ack(false, "Calibrate first."); return; }
        app.go("test"); ack(true);
        return;
      case "pause-test":
        if (app.screen === "test") app.go("validation");
        ack(true);
        return;
      case "set-mode":
        if (c.mode && c.mode in MODE_INFO) { app.settings.detectionMode = c.mode; app.saveSettings(); ack(true); }
        else ack(false, "Unknown mode.");
        return;
      case "restart-tracking":
        if (!needSession()) return;
        ack(true); await app.engine.restart();
        return;
    }
  }
}
