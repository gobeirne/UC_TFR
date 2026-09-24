import { DEFAULTS, type Settings } from "./defaults";

const KEY = "tfr.settings.v1";

/** Only preferences are persisted. Never calibration, logs or anything derived from video. */
export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) (s as any)[k] = saved[k];
      }
      if (!["fixed", "adaptive", "eye", "cautious"].includes(s.detectionMode)) s.detectionMode = DEFAULTS.detectionMode;
    }
  } catch { /* storage unavailable: use defaults */ }
  return s;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Resets detection/tracking tunables but keeps modes and camera choice. */
export function resetTunables(s: Settings): void {
  const keep: (keyof Settings)[] = ["detectionMode", "developerMode", "researchLogging", "logFeatures", "participantCode", "cameraDeviceId", "devBeep"];
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (!keep.includes(k)) (s as any)[k] = DEFAULTS[k];
  }
  saveSettings(s);
}
