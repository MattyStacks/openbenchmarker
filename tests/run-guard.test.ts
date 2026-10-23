import { describe, expect, it } from "vitest";
import {
  IN_PROGRESS_KEY,
  UNFINISHED_KEY,
  beginRun,
  didNotFinish,
  endRun,
  leftoverMessage,
  markFinished,
  needsHighResWarning,
  saferResolution,
  setRunLaps,
  setRunPhase,
  takeLeftoverRun,
  unfinishedCombos,
} from "../src/app/run-guard";

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const T0 = new Date("2026-10-22T12:00:00Z");

describe("run-in-progress record", () => {
  it("a run that ends normally leaves nothing behind", () => {
    const s = memStore();
    beginRun({ resolution: "1440p", preset: "Ultra", duration: 60 }, T0, s);
    setRunPhase("warmup", s);
    setRunPhase("timed", s);
    endRun(s);
    expect(s.m.has(IN_PROGRESS_KEY)).toBe(false);
    expect(takeLeftoverRun(s)).toBeNull();
    expect(unfinishedCombos(s)).toEqual([]);
  });

  it("a killed run is found on the next load, recorded once, and marked on the combo", () => {
    const s = memStore();
    beginRun({ resolution: "4K", preset: "Extreme", duration: 60, scoreTest: "extreme" }, T0, s);
    setRunPhase("warmup", s);
    const r = takeLeftoverRun(s);
    expect(r).toMatchObject({ resolution: "4K", preset: "Extreme", duration: 60, scoreTest: "extreme", phase: "warmup", startedAt: T0.toISOString() });
    expect(s.m.has(IN_PROGRESS_KEY)).toBe(false);
    expect(takeLeftoverRun(s)).toBeNull(); // only reported once
    expect(didNotFinish("4K", "Extreme", s)).toMatchObject({ count: 1, lastPhase: "warmup" });
    expect(didNotFinish("4K", "Low", s)).toBeUndefined();

    beginRun({ resolution: "4K", preset: "Extreme", duration: 60 }, T0, s);
    takeLeftoverRun(s);
    expect(didNotFinish("4K", "Extreme", s)?.count).toBe(2);
    expect(unfinishedCombos(s)).toHaveLength(1);
  });

  it("finishing the combo later clears its hint", () => {
    const s = memStore();
    beginRun({ resolution: "1440p", preset: "High", duration: 30 }, T0, s);
    takeLeftoverRun(s);
    markFinished("1440p", "High", s);
    expect(didNotFinish("1440p", "High", s)).toBeUndefined();
    expect(s.m.has(UNFINISHED_KEY)).toBe(false);
  });

  it("broken or missing storage never throws", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => beginRun({ resolution: "4K", preset: "Low", duration: 60 }, T0, throwing)).not.toThrow();
    expect(() => endRun(throwing)).not.toThrow();
    expect(takeLeftoverRun(throwing)).toBeNull();
    expect(takeLeftoverRun(null)).toBeNull();
    const junk = memStore();
    junk.setItem(IN_PROGRESS_KEY, "{not json");
    junk.setItem(UNFINISHED_KEY, JSON.stringify([{ resolution: "8K", preset: "Low" }]));
    expect(takeLeftoverRun(junk)).toBeNull();
    expect(unfinishedCombos(junk)).toEqual([]);
  });
});

describe("suggestions and warnings", () => {
  it("suggests the next safer resolution", () => {
    expect(saferResolution("4K")).toBe("1080p");
    expect(saferResolution("1440p")).toBe("1080p");
    expect(saferResolution("1080p")).toBe("720p");
    expect(saferResolution("720p")).toBeNull();
  });

  it("message names the run, the phase and the fix", () => {
    const m = leftoverMessage({ resolution: "1440p", preset: "Ultra", duration: 60, startedAt: T0.toISOString(), phase: "timed" });
    expect(m.title).toBe("Your last run (1440p · Ultra) didn't finish.");
    expect(m.body).toBe("Your browser may have closed it because it ran out of memory. This happens on some phones at higher resolutions. Try 1080p or 720p.");
    expect(m.suggest).toBe("1080p");
    expect(leftoverMessage({ resolution: "720p", preset: "Extreme", duration: 60, startedAt: "", phase: "building" })).toMatchObject({
      title: "Your last run (720p · Extreme) didn't finish while the city was loading.",
      suggest: null,
    });
  });

  it("phones get a confirmation for memory-heavy combos only, desktops never", () => {
    expect(needsHighResWarning("4K", "Extreme", true, [])).toBe(true);
    expect(needsHighResWarning("4K", "Medium", true, [])).toBe(true);
    expect(needsHighResWarning("4K", "Low", true, [])).toBe(false);
    expect(needsHighResWarning("1440p", "Ultra", true, [])).toBe(true);
    expect(needsHighResWarning("1440p", "Extreme", true, [])).toBe(true);
    expect(needsHighResWarning("1440p", "High", true, [])).toBe(false);
    expect(needsHighResWarning("1440p", "Low", true, [])).toBe(false);
    expect(needsHighResWarning("1080p", "Extreme", true, [])).toBe(false);
    expect(needsHighResWarning("4K", "Extreme", false, [])).toBe(false);
    // Already finished at this combo in this browser: no need to ask again.
    expect(needsHighResWarning("4K", "Extreme", true, [{ resolution: "4K", preset: "Extreme" }])).toBe(false);
    expect(needsHighResWarning("4K", "Extreme", true, [{ resolution: "4K", preset: "High" }])).toBe(true);
  });
});

describe("stress test leftovers", () => {
  it("say which lap they reached, suggest no other resolution, and don't flag the combo", () => {
    const s = memStore();
    beginRun({ resolution: "720p", preset: "Low", duration: 576, stressTest: "entry" }, T0, s);
    setRunPhase("timed", s);
    setRunLaps(1, s);
    setRunLaps(4, s);
    const r = takeLeftoverRun(s)!;
    expect(r).toMatchObject({ stressTest: "entry", lapsDone: 4, phase: "timed" });
    expect(didNotFinish("720p", "Low", s)).toBeUndefined();
    const msg = leftoverMessage(r);
    expect(msg.title).toBe("Your last stress test (Stress: Entry) stopped after lap 4 of 6.");
    expect(msg.body).toMatch(/overheat/);
    expect(msg.suggest).toBeNull();
  });

  it("before the first lap ends, or before timing, says so", () => {
    const base = { resolution: "4K", preset: "Extreme", duration: 576, stressTest: "extreme", startedAt: T0.toISOString() } as const;
    expect(leftoverMessage({ ...base, phase: "timed" }).title).toMatch(/stopped during lap 1 of 6\.$/);
    expect(leftoverMessage({ ...base, phase: "building" }).title).toMatch(/while the city was loading/);
  });
});
