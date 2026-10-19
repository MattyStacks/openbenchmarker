export interface FrameStats {
  frames: number;
  /** Sum of measured frame times (submission to GPU completion), ms. */
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

/** FPS over the most recent `windowMs` of frame time (live HUD readout). */
export function liveFps(frameTimesMs: ArrayLike<number>, windowMs = 500): number {
  let sum = 0;
  let n = 0;
  for (let i = frameTimesMs.length - 1; i >= 0 && sum < windowMs; i--) {
    const t = frameTimesMs[i];
    if (!(Number.isFinite(t) && t > 0)) continue;
    sum += t;
    n++;
  }
  return sum > 0 ? (n * 1000) / sum : 0;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
