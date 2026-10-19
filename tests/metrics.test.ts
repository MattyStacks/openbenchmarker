import { describe, expect, it } from "vitest";
import { computeStats, liveFps } from "../src/benchmark/metrics";

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
    expect(liveFps([])).toBe(0);
  });

  it("liveFps uses the most recent window", () => {
    const times = [...new Array(100).fill(100), ...new Array(100).fill(5)];
    expect(liveFps(times, 500)).toBeCloseTo(200, 6);
  });
});
