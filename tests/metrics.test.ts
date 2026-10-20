import { describe, expect, it } from "vitest";
import { computeRunStats, computeStats, liveBatchFps, nextBatchFrames, runFrameTimes } from "../src/benchmark/metrics";

describe("computeStats", () => {
  it("uniform 60 FPS gives 60 avg and 60 lows", () => {
    const s = computeStats(new Array(600).fill(1000 / 60));
    expect(s.avgFps).toBeCloseTo(60, 6);
    expect(s.p1Low).toBeCloseTo(60, 6);
    expect(s.p5Low).toBeCloseTo(60, 6);
    expect(s.frames).toBe(600);
    expect(s.worstMs).toBeCloseTo(16.667, 2);
  });

  it("a few spikes tank the 1% low but barely move the average", () => {
    const times = new Array(1000).fill(10); // 100 FPS
    for (let i = 0; i < 10; i++) times[i * 97] = 100; // 1% of frames at 10 FPS
    const s = computeStats(times);
    expect(s.avgFps).toBeGreaterThan(90);
    expect(s.p1Low).toBeCloseTo(10, 6);
    expect(s.worstMs).toBe(100);
    expect(s.p5Low).toBeLessThan(s.avgFps);
  });

  it("avg = frames / sum(frame times), not mean of per-frame FPS", () => {
    const s = computeStats([10, 30]); // 2 frames in 40 ms = 50 FPS (mean of 100 & 33.3 would be 66.7)
    expect(s.avgFps).toBeCloseTo(50, 6);
  });

  it("empty or junk input gives zeros, never NaN", () => {
    for (const input of [[], [NaN, -1, 0, Infinity]]) {
      const s = computeStats(input);
      expect(s).toEqual({ frames: 0, totalMs: 0, avgFps: 0, p1Low: 0, p5Low: 0, worstMs: 0 });
    }
  });
});

const batch = (frames: number, ms: number, busyMs = ms) => ({ frames, ms, busyMs });

describe("computeRunStats", () => {
  it("avg FPS is throughput: frames / wall-clock, including gaps between batches", () => {
    // 3 batches of 10 frames, 25 ms rendering + 5 ms yield each: 30 frames in 90 ms.
    const s = computeRunStats([batch(10, 30, 25), batch(10, 30, 25), batch(10, 30, 25)]);
    expect(s.frames).toBe(30);
    expect(s.wallMs).toBe(90);
    expect(s.avgFps).toBeCloseTo(1000 / 3, 6);
    expect(s.loopBusy).toBeCloseTo(25 / 30, 6);
  });

  it("without GPU times every frame gets its batch average (batch-avg)", () => {
    const s = computeRunStats([batch(10, 100), batch(2, 100)]);
    expect(s.timing).toBe("batch-avg");
    expect(runFrameTimes([batch(10, 100), batch(2, 100)])).toEqual([...new Array(10).fill(10), 50, 50]);
    expect(s.worstMs).toBe(50);
    expect(s.p1Low).toBeCloseTo(20, 6);
  });

  it("GPU times expose a spike hidden inside a batch average (gpu-timer)", () => {
    const gpu = [...new Array(99).fill(9), 60];
    const s = computeRunStats([batch(100, 1000)], gpu);
    expect(s.timing).toBe("gpu-timer");
    expect(s.worstMs).toBe(60);
    expect(s.p1Low).toBeCloseTo(1000 / 60, 6);
    expect(s.avgFps).toBeCloseTo(100, 6);
  });

  it("CPU-bound: GPU times below the batch average fall back to it, so lows never exceed avg", () => {
    const gpu = new Array(10).fill(2); // GPU busy 2 ms per frame, but frames take 10 ms
    const s = computeRunStats([batch(10, 100)], gpu);
    expect(s.p1Low).toBeCloseTo(100, 6);
    expect(s.p1Low).toBeLessThanOrEqual(s.avgFps + 1e-9);
  });

  it("missing GPU results (disjoint, not drained) use the batch average", () => {
    expect(runFrameTimes([batch(4, 40)], [NaN, 20, undefined as unknown as number, 5])).toEqual([10, 20, 10, 10]);
  });

  it("lows never exceed avg for arbitrary inputs", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 50; k++) {
      const bs = Array.from({ length: 20 }, () => batch(1 + Math.floor(rnd() * 30), 5 + rnd() * 40, 5));
      const n = bs.reduce((a, b) => a + b.frames, 0);
      const gpu = Array.from({ length: n }, () => (rnd() < 0.2 ? NaN : rnd() * 20));
      const s = computeRunStats(bs, gpu);
      expect(s.p5Low).toBeLessThanOrEqual(s.avgFps + 1e-9);
      expect(s.p1Low).toBeLessThanOrEqual(s.p5Low + 1e-9);
    }
  });

  it("empty input gives zeros, never NaN", () => {
    const s = computeRunStats([]);
    expect(s).toMatchObject({ frames: 0, avgFps: 0, p1Low: 0, p5Low: 0, worstMs: 0, wallMs: 0, loopBusy: 0, timing: "batch-avg" });
    expect(liveBatchFps([])).toBe(0);
  });
});

describe("scheduling helpers", () => {
  it("liveBatchFps uses the most recent window", () => {
    const bs = [...new Array(10).fill(batch(1, 100)), ...new Array(10).fill(batch(10, 50))];
    expect(liveBatchFps(bs, 500)).toBeCloseTo(200, 6);
  });

  it("nextBatchFrames targets the batch time and at most doubles", () => {
    expect(nextBatchFrames(1, 1, 28)).toBe(2);
    expect(nextBatchFrames(10, 56, 28)).toBe(5);
    expect(nextBatchFrames(10, 28, 28)).toBe(10);
    expect(nextBatchFrames(1, 500, 28)).toBe(1);
    expect(nextBatchFrames(0, 0, 28)).toBe(1);
  });
});
