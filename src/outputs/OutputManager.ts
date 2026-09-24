import type { ResponseEvent, ResponseOutput } from "./ResponseOutput";

/** Fans response events out to every enabled output. One failing output never affects others or the detector. */
export class OutputManager {
  private outputs = new Map<string, { out: ResponseOutput; enabled: boolean }>();
  readonly errors: { output: string; error: unknown }[] = [];

  add(out: ResponseOutput, enabled = true): void { this.outputs.set(out.name, { out, enabled }); }
  remove(name: string): void { this.outputs.get(name)?.out.dispose?.(); this.outputs.delete(name); }
  setEnabled(name: string, enabled: boolean): void { const o = this.outputs.get(name); if (o) o.enabled = enabled; }
  list(): string[] { return [...this.outputs.keys()]; }

  dispatch(e: ResponseEvent): void {
    for (const [name, { out, enabled }] of this.outputs) {
      if (!enabled) continue;
      try {
        if (e.type === "response-on") out.onResponseStart(e);
        else out.onResponseEnd(e);
      } catch (error) {
        this.errors.push({ output: name, error });
        console.error(`Output "${name}" failed`, error);
      }
    }
  }

  disposeAll(): void { for (const name of [...this.outputs.keys()]) this.remove(name); }
}
