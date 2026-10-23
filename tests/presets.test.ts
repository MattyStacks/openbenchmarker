import { describe, expect, it } from "vitest";
import { DURATIONS, PRESETS, RESOLUTIONS, SCORE_TESTS, STRESS_LAP_SECONDS, STRESS_TESTS, getPreset, getResolution, getScoreTest, getStressTest, matchesScoreTest, matchesStressTest, normalizeResolution, standardResolution, stressDuration } from "../src/benchmark/presets";
import { JOURNEY_SECONDS } from "../src/engine/world";

describe("resolutions", () => {
  it("offers exactly 720p, 1080p, 1440p and 4K, in that order (no Native)", () => {
    expect(RESOLUTIONS.map((r) => r.id)).toEqual(["720p", "1080p", "1440p", "4K"]);
    expect(getResolution("720p")).toMatchObject({ width: 1280, height: 720 });
    expect(getResolution("4K")).toMatchObject({ width: 3840, height: 2160 });
    expect(getResolution("2160p")).toBeUndefined();
    expect(getResolution("native")).toBeUndefined();
  });

  it("recognises a standard resolution only when name and pixel size match", () => {
    expect(standardResolution("1080p", 1920, 1080)?.id).toBe("1080p");
    expect(standardResolution("4K", 3840, 2160)?.id).toBe("4K");
    expect(standardResolution("2160p", 3840, 2160)?.id).toBe("4K");
    expect(standardResolution("3440x1440", 3440, 1440)).toBeUndefined();
    expect(standardResolution("1080p", 2560, 1440)).toBeUndefined();
  });

  it("maps old 2160p results to 4K", () => {
    expect(normalizeResolution("2160p")).toBe("4K");
    expect(normalizeResolution("1440p")).toBe("1440p");
  });
});

describe("score tests", () => {
  it("Entry is the lowest setting and Extreme the highest, both locked to one duration", () => {
    expect(SCORE_TESTS.map((t) => t.id)).toEqual(["entry", "extreme"]);
    const entry = getScoreTest("entry")!;
    const extreme = getScoreTest("extreme")!;
    expect([entry.preset, entry.resolution]).toEqual([PRESETS[0].id, RESOLUTIONS[0].id]);
    expect([extreme.preset, extreme.resolution]).toEqual([PRESETS[PRESETS.length - 1].id, RESOLUTIONS[RESOLUTIONS.length - 1].id]);
    for (const t of SCORE_TESTS) {
      expect(getPreset(t.preset)).toBeDefined();
      expect((DURATIONS as readonly number[]).includes(t.duration)).toBe(true);
    }
  });

  it("matches only the exact locked settings", () => {
    const t = getScoreTest("extreme")!;
    expect(matchesScoreTest(t, "Extreme", "4K", 3840, 2160, 60)).toBe(true);
    expect(matchesScoreTest(t, "Extreme", "4K", 3840, 2160, 30)).toBe(false);
    expect(matchesScoreTest(t, "Ultra", "4K", 3840, 2160, 60)).toBe(false);
    expect(matchesScoreTest(t, "Extreme", "1440p", 2560, 1440, 60)).toBe(false);
    expect(getScoreTest("nope")).toBeUndefined();
  });
});

describe("stress tests", () => {
  it("a lap is exactly one pass of the flight loop, so every lap is the same workload", () => {
    expect(STRESS_LAP_SECONDS).toBe(JOURNEY_SECONDS);
  });

  it("Entry and Extreme mirror the score runs and last 6 laps (576 s timed)", () => {
    expect(STRESS_TESTS.map((t) => t.id)).toEqual(["entry", "extreme"]);
    for (const t of STRESS_TESTS) {
      const score = getScoreTest(t.id)!;
      expect([t.preset, t.resolution]).toEqual([score.preset, score.resolution]);
      expect(t.laps).toBe(6);
      expect(stressDuration(t.laps)).toBe(576);
      // Longer than any custom run, so a stress result never matches custom settings.
      expect(Math.max(...DURATIONS)).toBeLessThan(stressDuration(t.laps));
    }
  });

  it("matches only the exact locked settings with every lap finished", () => {
    const t = getStressTest("extreme")!;
    expect(matchesStressTest(t, "Extreme", "4K", 3840, 2160, 576, 6)).toBe(true);
    expect(matchesStressTest(t, "Extreme", "4K", 3840, 2160, 192, 2)).toBe(false);
    expect(matchesStressTest(t, "Extreme", "4K", 3840, 2160, 576, 5)).toBe(false);
    expect(matchesStressTest(t, "Low", "720p", 1280, 720, 576, 6)).toBe(false);
    expect(getStressTest("nope")).toBeUndefined();
  });
});
