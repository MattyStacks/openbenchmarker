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
  /** JS time spent inside the frame calls (scene update + three.js draw submission), ms. */
  cpuMs?: number;
  /** The scene-update part of cpuMs (animation, instance matrices), ms. */
  updateMs?: number;
  /** Time blocked in the end-of-batch readback waiting for the GPU to finish, ms. */
  syncMs?: number;
  /** Delay between yielding to the event loop and this batch starting, ms. */
  yieldMs?: number;
}

export interface RunStats extends FrameStats {
  /** Timed wall-clock, ms (sum of batch intervals). */
  wallMs: number;
  /** Fraction of timed wall-clock spent submitting and draining batches (not yielding). */
  loopBusy: number;
  timing: TimingMethod;
  /** Share of timed wall-clock the GPU spent on our frames (timer queries); null without timers. */
  gpuBusy: number | null;
  /** Mean measured GPU time per frame, ms; null without timers. */
  gpuMsPerFrame: number | null;
  /** Mean JS submit time per frame (cpuMs / frames), ms. */
  cpuMsPerFrame: number;
  /** Mean scene-update time per frame, ms. */
  updateMsPerFrame: number;
  /** Mean readback wait per frame, ms. */
  syncMsPerFrame: number;
  /** Yields where something else held the main thread longer than STALL_MS. */
  stalls: number;
  stallMs: number;
  /** Frames slower than HITCH_FACTOR x the median and at least HITCH_MIN_MS over it. */
  hitches: number;
  /** Hitches whose GPU timer alone was that slow (GPU-side); the rest came from frame pacing. */
  gpuHitches: number;
  /** Standard deviation of frame times, ms. */
  frameStdMs: number;
}

/** A yield longer than this means another task (other tabs, GC, the browser) held the main thread. */
export const STALL_MS = 20;
/** A frame this many times slower than the median counts as a hitch. */
export const HITCH_FACTOR = 2.5;
/** ...and at least this much slower (about one 240 Hz refresh), so timer jitter on sub-ms frames isn't a hitch. */
export const HITCH_MIN_MS = 4;

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

/** runFrameTimes into a reusable buffer (grown when too small); returns the buffer and the count. */
export function runFrameTimesInto(
  batches: readonly TimedBatch[],
  gpuMs: ArrayLike<number> | undefined,
  out: Float64Array,
): { out: Float64Array; n: number } {
  let n = 0;
  for (const b of batches) {
    if (!(b.frames > 0 && b.ms > 0)) continue;
    if (n + b.frames > out.length) {
      const grown = new Float64Array(Math.max(out.length * 2, n + b.frames, 1024));
      grown.set(out.subarray(0, n));
      out = grown;
    }
    const avg = b.ms / b.frames;
    for (let k = 0; k < b.frames; k++, n++) {
      const g = gpuMs ? gpuMs[n] : NaN;
      out[n] = Number.isFinite(g) && g > avg ? g : avg;
    }
  }
  return { out, n };
}

/**
 * Mean FPS of the slowest `fraction` of times[0..n), like computeStats' lows but in O(n) with no
 * sort or allocation (quickselect), so the live HUD stays cheap on runs with 100k+ frames.
 * Reorders times[0..n).
 */
export function lowFpsSelect(times: Float64Array, n: number, fraction: number): number {
  if (n <= 0) return 0;
  const k = Math.max(1, Math.ceil(n * fraction));
  let lo = 0, hi = n - 1;
  // Partition descending until the k largest values occupy times[0..k).
  while (lo < hi) {
    const pivot = times[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (times[i] > pivot) i++;
      while (times[j] < pivot) j--;
      if (i <= j) {
        const x = times[i];
        times[i] = times[j];
        times[j] = x;
        i++;
        j--;
      }
    }
    if (k - 1 <= j) hi = j;
    else if (k - 1 >= i) lo = i;
    else break;
  }
  let sum = 0;
  for (let i = 0; i < k; i++) sum += times[i];
  return sum > 0 ? (k * 1000) / sum : 0;
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
  let cpuMs = 0, updateMs = 0, syncMs = 0, stalls = 0, stallMs = 0;
  for (const b of batches) {
    if (!(b.frames > 0 && b.ms > 0)) continue;
    wallMs += b.ms;
    busyMs += Math.min(b.busyMs, b.ms);
    frames += b.frames;
    cpuMs += b.cpuMs ?? 0;
    updateMs += b.updateMs ?? 0;
    syncMs += b.syncMs ?? 0;
    if ((b.yieldMs ?? 0) > STALL_MS) {
      stalls++;
      stallMs += b.yieldMs!;
    }
  }
  let gpuCount = 0;
  let gpuSum = 0;
  if (gpuMs)
    for (let i = 0; i < Math.min(gpuMs.length, frames); i++)
      if (Number.isFinite(gpuMs[i]) && gpuMs[i] > 0) {
        gpuCount++;
        gpuSum += gpuMs[i];
      }
  const times = runFrameTimes(batches, gpuMs);
  const st = computeStats(times);
  const gpuMsPerFrame = gpuCount > 0 ? gpuSum / gpuCount : null;
  return {
    ...st,
    avgFps: wallMs > 0 ? (frames * 1000) / wallMs : 0,
    wallMs,
    loopBusy: wallMs > 0 ? busyMs / wallMs : 0,
    timing: gpuCount > 0 ? "gpu-timer" : "batch-avg",
    // Frames whose timer result never arrived count at the measured mean.
    gpuBusy: gpuMsPerFrame !== null && wallMs > 0 ? Math.min(1, (gpuMsPerFrame * frames) / wallMs) : null,
    gpuMsPerFrame,
    cpuMsPerFrame: frames > 0 ? cpuMs / frames : 0,
    updateMsPerFrame: frames > 0 ? updateMs / frames : 0,
    syncMsPerFrame: frames > 0 ? syncMs / frames : 0,
    stalls,
    stallMs,
    ...hitchStats(times, gpuMs),
  };
}

/**
 * Hitch count and frame-time spread from per-frame times. With `gpuMs` (aligned with `times`),
 * also counts the hitches whose GPU time alone crossed the threshold: GPU-side spikes, as opposed
 * to gaps where the GPU wasn't fed (frame pacing).
 */
export function hitchStats(times: readonly number[], gpuMs?: ArrayLike<number>): { hitches: number; gpuHitches: number; frameStdMs: number } {
  const t = times.filter((x) => Number.isFinite(x) && x > 0);
  if (t.length === 0) return { hitches: 0, gpuHitches: 0, frameStdMs: 0 };
  const sorted = [...t].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let mean = 0;
  for (const x of t) mean += x;
  mean /= t.length;
  let v = 0;
  let hitches = 0;
  const isHitch = (x: number) => x > median * HITCH_FACTOR && x - median >= HITCH_MIN_MS;
  for (const x of t) {
    v += (x - mean) ** 2;
    if (isHitch(x)) hitches++;
  }
  let gpuHitches = 0;
  if (gpuMs) for (let i = 0; i < Math.min(gpuMs.length, times.length); i++) if (Number.isFinite(gpuMs[i]) && isHitch(gpuMs[i])) gpuHitches++;
  return { hitches, gpuHitches, frameStdMs: Math.sqrt(v / t.length) };
}

/** Points per average FPS. Linear, so any FPS gain (an overclock included) raises the score. */
export const SCORE_PER_FPS = 100;

export function scoreFor(avgFps: number): number {
  return Number.isFinite(avgFps) && avgFps > 0 ? Math.round(avgFps * SCORE_PER_FPS) : 0;
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

/**
 * Frame-time graph points, oldest first: average frame time over windows of at least `binMs`,
 * built from the newest batches back (at most `points`). Batches are only a few ms long, so
 * plotting each one would mostly show when the loop noticed a batch finishing.
 */
export function graphPoints(batches: readonly TimedBatch[], binMs = 25, points = 240): number[] {
  const out: number[] = [];
  let ms = 0, n = 0;
  for (let i = batches.length - 1; i >= 0 && out.length < points; i--) {
    ms += batches[i].ms;
    n += batches[i].frames;
    if (ms >= binMs && n > 0) {
      out.push(ms / n);
      ms = 0;
      n = 0;
    }
  }
  return out.reverse();
}

/**
 * Live HUD breakdown over the most recent `windowMs` of batches: wall time per frame, JS submit
 * time per frame, and how busy the GPU was given the mean of recently resolved GPU timer results.
 */
export function liveBreakdown(
  batches: readonly TimedBatch[],
  recentGpuMs: number | null,
  windowMs = 1000,
): { frameMs: number; cpuMs: number; gpuBusy: number | null } {
  let ms = 0, n = 0, cpu = 0;
  for (let i = batches.length - 1; i >= 0 && ms < windowMs; i--) {
    ms += batches[i].ms;
    n += batches[i].frames;
    cpu += batches[i].cpuMs ?? 0;
  }
  if (n === 0) return { frameMs: 0, cpuMs: 0, gpuBusy: null };
  const frameMs = ms / n;
  return { frameMs, cpuMs: cpu / n, gpuBusy: recentGpuMs !== null && frameMs > 0 ? Math.min(1, recentGpuMs / frameMs) : null };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
