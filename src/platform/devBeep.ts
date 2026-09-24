/** Developer demonstration only — not a calibrated audiometric stimulus. Never used in test mode. */
let ctx: AudioContext | undefined;
export function devBeep(freq = 1000, ms = 400): void {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq; g.gain.value = 0;
  o.connect(g).connect(ctx.destination);
  const t = ctx.currentTime;
  g.gain.linearRampToValueAtTime(0.2, t + 0.02);
  g.gain.setValueAtTime(0.2, t + ms / 1000 - 0.02);
  g.gain.linearRampToValueAtTime(0, t + ms / 1000);
  o.start(t); o.stop(t + ms / 1000 + 0.05);
}
