import { nativeSize } from "../benchmark/presets";

/** Target wall-clock length of one render batch (one GPU sync per batch). */
export const BATCH_MS = 28;

/** Phones and tablets, including iPadOS Safari, which reports a desktop Mac user agent. */
function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
export const MOBILE = isMobileDevice();

export const native = nativeSize(screen.width, screen.height, window.devicePixelRatio || 1);
