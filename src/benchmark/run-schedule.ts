/**
 * How the run loop keeps the GPU queue fed (src/app/run.ts). Pure, so tests/run-schedule.test.ts
 * can check it against simulated GPUs and timer behaviour, including worst-case late timers.
 */

/**
 * Display refreshes per canvas update. Drawing the canvas on every refresh stalled the browser's
 * GPU pipeline until the next refresh in Edge 157 on Windows: RTX 5080 High/4K ran at 80 FPS
 * (52% GPU busy) with a refresh-locked 60.0 FPS at one batch queued. Every other refresh it ran
 * at 153 FPS (99%); Brave 156 barely stalled either way. The preview stays evenly paced at half
 * the refresh rate (30/s at 60 Hz, 72/s at 144 Hz); the measured frames are unchanged.
 */
export const PRESENT_EVERY = 2;

/**
 * Batches queued on the GPU at once (WebGL2). Batches are short (BATCH_MS), so three keep at
 * least ~24 ms of work queued against main-thread hiccups (GC, other tabs) and late timers.
 */
export const QUEUE_DEPTH = 3;

/**
 * While the queue is full, the loop sleeps until about SPIN_MS before the oldest batch is due,
 * then polls every task. Another batch is still queued behind it, so the GPU stays fed either
 * way; sleeping just avoids pinning a CPU core (which costs laptops GPU power budget).
 * Browsers round chained short timeouts up to ~4 ms, so the loop only sleeps when the batch is
 * due well after that; otherwise it noticed finished batches late (fake frame-time spikes).
 */
export const SPIN_MS = 5;
export const MAX_SLEEP_MS = 10;

/** Timer delay (ms) to sleep with the queue full and the oldest batch due in `etaMs`; 0 = poll on the next task. */
export function queueSleepMs(etaMs: number): number {
  return etaMs > SPIN_MS + 2 ? Math.min(MAX_SLEEP_MS, Math.floor(etaMs - SPIN_MS)) : 0;
}
