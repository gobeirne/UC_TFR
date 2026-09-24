import type { ResponseEvent, ResponseOutput } from "./ResponseOutput";

export const RESPONSE_GREEN = "#00ff3c";
export const IDLE_BLACK = "#000000";

/** RESPONSE_ON → green, RESPONSE_OFF → black. Instant, no transition. */
export class VisualResponseOutput implements ResponseOutput {
  readonly name = "visual";
  constructor(private el: HTMLElement) { this.el.style.transition = "none"; this.set(false); }
  private set(on: boolean) { this.el.style.backgroundColor = on ? RESPONSE_GREEN : IDLE_BLACK; }
  onResponseStart(_e: ResponseEvent) { this.set(true); }
  onResponseEnd(_e: ResponseEvent) { this.set(false); }
  dispose() { this.set(false); }
}
