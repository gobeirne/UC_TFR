import type { Transition } from "../detection/ResponseStateMachine";
import { FEATURE_KEYS, type TrackingSample } from "../tracking/TrackingSample";
import type { Classification } from "../detection/ResponseClassifier";
import { toCsv } from "./CsvExporter";

/**
 * Optional research log, in memory only. Never contains images.
 * Discarded at session end unless the clinician exports it.
 */
export class SessionLogger {
  private events: (string | number | boolean | undefined)[][] = [];
  private samples: (string | number | boolean | undefined)[][] = [];
  constructor(private t0: number, public logFeatures: boolean) {}

  logTransition(tr: Transition, frameTimeMs: number) {
    this.events.push([tr.timestampMs - this.t0, tr.name, tr.score, tr.valid, frameTimeMs - this.t0, tr.from, tr.to]);
  }
  logNote(t: number, note: string) { this.events.push([t - this.t0, note, undefined, undefined, undefined, undefined, undefined]); }

  logSample(s: TrackingSample, c: Classification) {
    if (!this.logFeatures) return;
    this.samples.push([s.frameTimeMs - this.t0, s.timestampMs - this.t0, s.valid, s.invalidReason ?? "", c.score, c.offAxis,
      ...FEATURE_KEYS.map((k) => s.features[k])]);
  }

  get eventCount() { return this.events.length; }
  get sampleCount() { return this.samples.length; }

  eventsCsv(): string {
    return toCsv(["sessionTimeMs", "event", "responseScore", "trackingValid", "frameTimeMs", "fromState", "toState"], this.events);
  }
  samplesCsv(): string {
    return toCsv(["frameTimeMs", "classifiedTimeMs", "trackingValid", "invalidReason", "responseScore", "offAxis", ...FEATURE_KEYS], this.samples);
  }
  clear() { this.events = []; this.samples = []; }
}
