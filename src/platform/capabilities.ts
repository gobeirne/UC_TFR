export interface Capability { name: string; ok: boolean; required: boolean; note?: string }

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function detectCapabilities(): Capability[] {
  const n = navigator as any;
  const wasm = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  const v = document.createElement("video") as any;
  return [
    { name: "Secure context (HTTPS)", ok: window.isSecureContext, required: true },
    { name: "Camera API", ok: !!navigator.mediaDevices?.getUserMedia, required: true },
    { name: "WebAssembly (MediaPipe)", ok: wasm, required: true },
    { name: "WebGL (GPU tracking)", ok: (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })(), required: false, note: "CPU is used otherwise" },
    { name: "Video frame callbacks", ok: typeof v.requestVideoFrameCallback === "function", required: false, note: "animation-frame fallback" },
    { name: "Screen Wake Lock", ok: "wakeLock" in navigator, required: false },
    { name: "Fullscreen", ok: !!document.documentElement.requestFullscreen, required: false },
    { name: "Offline cache (service worker)", ok: "serviceWorker" in navigator, required: false },
    { name: "Running as installed app", ok: isStandalone(), required: false },
    { name: "Web Bluetooth", ok: !!n.bluetooth, required: false, note: "future outputs" },
    { name: "Web Serial", ok: !!n.serial, required: false, note: "future outputs" },
    { name: "WebUSB", ok: !!n.usb, required: false, note: "future outputs" },
  ];
}
