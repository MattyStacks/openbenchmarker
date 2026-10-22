import { describe, expect, it } from "vitest";
import { STALL_MS, computeRunStats, computeStats, hitchStats, graphPoints, liveBatchFps, liveBreakdown, lowFpsSelect, nextBatchFrames, runFrameTimes, runFrameTimesInto, scoreFor } from "../src/benchmark/metrics";

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

describe("GPU-bound and CPU signals", () => {
  const b = (frames: number, ms: number, extra: Partial<import("../src/benchmark/metrics").TimedBatch> = {}) => ({ frames, ms, busyMs: ms, ...extra });

  it("GPU busy is the GPU time share of wall-clock", () => {
    const full = computeRunStats([b(10, 100)], new Array(10).fill(10));
    expect(full.gpuBusy).toBeCloseTo(1, 6);
    expect(full.gpuMsPerFrame).toBeCloseTo(10, 6);
    const half = computeRunStats([b(10, 100)], new Array(10).fill(5));
    expect(half.gpuBusy).toBeCloseTo(0.5, 6);
  });

  it("frames without a timer result count at the measured mean; no timers gives null", () => {
    const partial = computeRunStats([b(10, 100)], [5, 5, 5, 5, 5, NaN, NaN, NaN, NaN, NaN]);
    expect(partial.gpuBusy).toBeCloseTo(0.5, 6);
    const none = computeRunStats([b(10, 100)]);
    expect(none.gpuBusy).toBeNull();
    expect(none.gpuMsPerFrame).toBeNull();
  });

  it("GPU busy never exceeds 100%", () => {
    expect(computeRunStats([b(10, 100)], new Array(10).fill(30)).gpuBusy).toBe(1);
  });

  it("averages CPU, update and wait time per frame and counts stalls", () => {
    const s = computeRunStats([
      b(10, 100, { cpuMs: 40, updateMs: 10, syncMs: 50, yieldMs: 1 }),
      b(10, 100, { cpuMs: 60, updateMs: 30, syncMs: 30, yieldMs: STALL_MS + 5 }),
    ]);
    expect(s.cpuMsPerFrame).toBeCloseTo(5, 6);
    expect(s.updateMsPerFrame).toBeCloseTo(2, 6);
    expect(s.syncMsPerFrame).toBeCloseTo(4, 6);
    expect(s.stalls).toBe(1);
    expect(s.stallMs).toBeCloseTo(STALL_MS + 5, 6);
  });

  it("counts hitches against the median frame time", () => {
    const times = [...new Array(100).fill(10), 30, 40];
    const h = hitchStats(times);
    expect(h.hitches).toBe(2);
    expect(hitchStats(new Array(50).fill(10))).toEqual({ hitches: 0, gpuHitches: 0, frameStdMs: 0 });
    // The second hitch's GPU time was normal: the GPU wasn't fed (pacing), not a GPU spike.
    expect(hitchStats(times, [...new Array(100).fill(9), 30, 9]).gpuHitches).toBe(1);
  });

  it("ignores timer jitter on sub-millisecond frames as hitches", () => {
    // 0.14 ms frames with 0.5 ms blips: 2.5x the median, but nothing a display could show.
    expect(hitchStats([...new Array(1000).fill(0.14), ...new Array(50).fill(0.5)]).hitches).toBe(0);
    expect(hitchStats([...new Array(1000).fill(0.14), 6]).hitches).toBe(1);
  });

  it("live lows by quickselect match the sorted computation", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const batches = Array.from({ length: 300 }, () => b(1 + Math.floor(rnd() * 20), 5 + rnd() * 200, { busyMs: 0 }));
    const frames = batches.reduce((a, x) => a + x.frames, 0);
    const gpu = Array.from({ length: frames }, () => (rnd() < 0.9 ? rnd() * 30 : NaN));
    const { out, n } = runFrameTimesInto(batches, gpu, new Float64Array(4));
    expect(n).toBe(frames);
    expect(Array.from(out.subarray(0, n))).toEqual(runFrameTimes(batches, gpu));
    const want = computeStats(runFrameTimes(batches, gpu));
    expect(lowFpsSelect(out, n, 0.01)).toBeCloseTo(want.p1Low, 6);
    const again = runFrameTimesInto(batches, gpu, out);
    expect(lowFpsSelect(again.out, again.n, 0.05)).toBeCloseTo(want.p5Low, 6);
    expect(lowFpsSelect(new Float64Array(3).fill(10), 3, 0.01)).toBeCloseTo(100, 6);
    expect(lowFpsSelect(new Float64Array(0), 0, 0.01)).toBe(0);
  });

  it("graph points average batches into windows", () => {
    const pts = graphPoints([b(1, 10), b(1, 10), b(2, 10), b(1, 10), b(1, 30)], 25);
    // Newest back: [30 ms / 1] then [10+10+10 / 4]; the leftover 10 ms isn't a full window.
    expect(pts).toEqual([7.5, 30]);
    expect(graphPoints([b(1, 30), b(1, 30), b(1, 30)], 25, 2)).toEqual([30, 30]);
  });

  it("live breakdown uses the recent window", () => {
    const live = liveBreakdown([b(10, 100, { cpuMs: 20 })], 9);
    expect(live.frameMs).toBeCloseTo(10, 6);
    expect(live.cpuMs).toBeCloseTo(2, 6);
    expect(live.gpuBusy).toBeCloseTo(0.9, 6);
    expect(liveBreakdown([b(10, 100)], null).gpuBusy).toBeNull();
  });
});

describe("scoreFor", () => {
  it("rises strictly with average FPS, so an overclock always scores higher", () => {
    let last = -1;
    for (const fps of [10, 59.9, 60, 60.01, 65, 110, 1000]) {
      const sc = scoreFor(fps);
      expect(sc).toBeGreaterThan(last);
      last = sc;
    }
    expect(scoreFor(65.12)).toBe(6512);
    expect(scoreFor(0)).toBe(0);
    expect(scoreFor(NaN)).toBe(0);
  });
});
