export interface FrameStats {
  frames: number;
  /** Sum of per-frame times, ms. */
  totalMs: number;
  avgFps: number;
  /** Mean FPS of the slowest 1% of frames (upstream field p1_low). */
  p1Low: number;
  /** Mean FPS of the slowest 5% of frames. */
  p5Low: number;
  worstMs: number;
}

const EMPTY: FrameStats = { frames: 0, totalMs: 0, avgFps: 0, p1Low: 0, p5Low: 0, worstMs: 0 };

function lowFps(sortedDesc: number[], fraction: number): number {
  const n = Math.max(1, Math.ceil(sortedDesc.length * fraction));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sortedDesc[i];
  return sum > 0 ? (n * 1000) / sum : 0;
}

/** Avg FPS = frames / sum(frame times); lows = mean FPS of the slowest N% of frame times. */
export function computeStats(frameTimesMs: ArrayLike<number>): FrameStats {
  const times: number[] = [];
  for (let i = 0; i < frameTimesMs.length; i++) {
    const t = frameTimesMs[i];
    if (Number.isFinite(t) && t > 0) times.push(t);
  }
  if (times.length === 0) return { ...EMPTY };
  let total = 0;
  for (const t of times) total += t;
  const sorted = times.sort((a, b) => b - a);
  return {
    frames: sorted.length,
    totalMs: total,
    avgFps: (sorted.length * 1000) / total,
    p1Low: lowFps(sorted, 0.01),
    p5Low: lowFps(sorted, 0.05),
    worstMs: sorted[0],
  };
}

export type TimingMethod = "gpu-timer" | "batch-avg";

/**
 * One timed batch. Consecutive batches partition the timed wall-clock: `ms` runs from the
 * previous batch's readback (or the start of timing) to this batch's readback, so it also
 * covers the HUD update and the yield before the batch. `busyMs` is the part spent rendering.
 */
export interface TimedBatch {
  frames: number;
  ms: number;
  busyMs: number;
}

export interface RunStats extends FrameStats {
  /** Timed wall-clock, ms (sum of batch intervals). */
  wallMs: number;
  /** Fraction of timed wall-clock spent submitting and draining batches (not yielding). */
  loopBusy: number;
  timing: TimingMethod;
}

/**
 * Per-frame times for the lows: max(GPU time, the frame's batch average). A GPU timer only
 * sees GPU work, so when the CPU is the bottleneck the batch average is the real frame
 * interval. Frames with no GPU result (no extension, disjoint, not drained) get the batch average.
 * `gpuMs[i]` belongs to the i-th timed frame, in submission order.
 */
export function runFrameTimes(batches: readonly TimedBatch[], gpuMs?: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (const b of batches) {
    if (!(b.frames > 0 && b.ms > 0)) continue;
    const avg = b.ms / b.frames;
    for (let k = 0; k < b.frames; k++) {
      const g = gpuMs ? gpuMs[out.length] : NaN;
      out.push(Number.isFinite(g) && g > avg ? g : avg);
    }
  }
  return out;
}

/**
 * Run stats: Avg FPS is throughput (frames / timed wall-clock); lows and worst frame come
 * from runFrameTimes. Each frame time is at least its share of the wall-clock, so the
 * lows can never exceed the average.
 */
export function computeRunStats(batches: readonly TimedBatch[], gpuMs?: ArrayLike<number>): RunStats {
  let wallMs = 0;
  let busyMs = 0;
  let frames = 0;
  for (const b of batches) {
    if (!(b.frames > 0 && b.ms > 0)) continue;
    wallMs += b.ms;
    busyMs += Math.min(b.busyMs, b.ms);
    frames += b.frames;
  }
  let gpuCount = 0;
  if (gpuMs) for (let i = 0; i < Math.min(gpuMs.length, frames); i++) if (Number.isFinite(gpuMs[i]) && gpuMs[i] > 0) gpuCount++;
  const st = computeStats(runFrameTimes(batches, gpuMs));
  return {
    ...st,
    avgFps: wallMs > 0 ? (frames * 1000) / wallMs : 0,
    wallMs,
    loopBusy: wallMs > 0 ? busyMs / wallMs : 0,
    timing: gpuCount > 0 ? "gpu-timer" : "batch-avg",
  };
}

/** Frames for the next batch so it takes about `targetMs` including GPU completion (at most doubling). */
export function nextBatchFrames(frames: number, busyMs: number, targetMs: number): number {
  if (!(frames > 0)) return 1;
  if (!(busyMs > 0)) return frames * 2;
  return Math.max(1, Math.min(frames * 2, Math.round((frames * targetMs) / busyMs)));
}

/** FPS over the most recent `windowMs` of batches (live HUD readout). */
export function liveBatchFps(batches: readonly TimedBatch[], windowMs = 500): number {
  let ms = 0;
  let n = 0;
  for (let i = batches.length - 1; i >= 0 && ms < windowMs; i--) {
    ms += batches[i].ms;
    n += batches[i].frames;
  }
  return ms > 0 ? (n * 1000) / ms : 0;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
