/**
 * Target wall-clock length of one render batch. The browser only puts the canvas on screen between
 * tasks, so only a batch's last frame is ever shown: short batches let most frames reach the
 * screen (28 ms batches showed ~35 updates a second at any FPS, so fast runs looked choppy).
 */
export const BATCH_MS = 8;

/** Phones and tablets, including iPadOS Safari, which reports a desktop Mac user agent. */
function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
export const MOBILE = isMobileDevice();
