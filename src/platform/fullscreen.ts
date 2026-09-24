/** Fullscreen where the browser allows it (Android, desktop, iPad). iPhone Safari ignores this; the page still fills the screen. */
export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement as any;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch { /* not allowed: fine */ }
}
export async function exitFullscreen(): Promise<void> {
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
}
