import type { Settings } from "../config/defaults";

interface Pt { t: number; s: number; valid: boolean; gated: boolean; extra?: { fixed?: number; adaptive?: number; eye?: number } }

/** Faint comparison lines for the modes not currently selected. */
export const SERIES_COLOURS = { fixed: "#8a8a8a", adaptive: "#6cc4ff", eye: "#ff8ad8" } as const;

/** Scrolling score-vs-time graph with threshold lines and ON/OFF markers. Developer mode only. */
export class ScoreGraph {
  readonly el: HTMLCanvasElement;
  private pts: Pt[] = [];
  private marks: { t: number; on: boolean }[] = [];
  private raf = 0;
  constructor(private settings: Settings, private windowMs = 10000) {
    this.el = document.createElement("canvas");
    this.el.className = "graph";
    const loop = () => { this.raf = requestAnimationFrame(loop); this.draw(); };
    loop();
  }
  push(t: number, s: number, valid: boolean, gated: boolean, extra?: Pt["extra"]) { this.pts.push({ t, s, valid, gated, extra }); this.trim(t); }
  mark(t: number, on: boolean) { this.marks.push({ t, on }); }
  private trim(now: number) {
    while (this.pts.length && now - this.pts[0].t > this.windowMs) this.pts.shift();
    while (this.marks.length && now - this.marks[0].t > this.windowMs) this.marks.shift();
  }
  dispose() { cancelAnimationFrame(this.raf); }

  private draw() {
    const c = this.el, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = hgt * dpr; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const now = performance.now();
    const yMin = -0.5, yMax = 1.5;
    const X = (t: number) => w - ((now - t) / this.windowMs) * w;
    const Y = (s: number) => hgt - ((Math.max(yMin, Math.min(yMax, s)) - yMin) / (yMax - yMin)) * hgt;
    g.lineWidth = 1;
    const hline = (v: number, col: string, dash: number[] = []) => { g.strokeStyle = col; g.setLineDash(dash); g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke(); };
    hline(0, "#333"); hline(1, "#333");
    hline(this.settings.activationThreshold, "#00ff3c", [6, 4]);
    hline(this.settings.releaseThreshold, "#ffb020", [6, 4]);
    g.setLineDash([]);
    for (const m of this.marks) { g.strokeStyle = m.on ? "#00ff3c" : "#888"; g.beginPath(); g.moveTo(X(m.t), 0); g.lineTo(X(m.t), hgt); g.stroke(); }
    // Comparison lines first, underneath.
    g.lineWidth = 1.25;
    for (const key of ["fixed", "adaptive", "eye"] as const) {
      g.strokeStyle = SERIES_COLOURS[key]; g.globalAlpha = 0.55; g.beginPath();
      let pen = false;
      for (const p of this.pts) {
        const v = p.extra?.[key];
        if (v === undefined) { pen = false; continue; }
        if (!pen) { g.moveTo(X(p.t), Y(v)); pen = true; } else g.lineTo(X(p.t), Y(v));
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 2;
    let prev: Pt | undefined;
    for (const p of this.pts) {
      if (p.valid) {
        g.fillStyle = p.gated ? "#ff5ad1" : "#fff";
        if (prev?.valid) { g.strokeStyle = "#fff"; g.beginPath(); g.moveTo(X(prev.t), Y(prev.s)); g.lineTo(X(p.t), Y(p.s)); g.stroke(); }
        if (p.gated) g.fillRect(X(p.t) - 2, Y(p.s) - 2, 4, 4);
      } else { g.fillStyle = "#ff6b6b"; g.fillRect(X(p.t) - 1, hgt - 6, 3, 6); }
      prev = p;
    }
    g.fillStyle = "#777"; g.font = "11px system-ui, sans-serif";
    g.fillText("1", 4, Y(1) - 3); g.fillText("0", 4, Y(0) - 3);
  }
}
