import { describe, expect, it } from "vitest";
import { BENCHMARK } from "../src/benchmark/catalog";
import { sharedRunFrom, type SharedRun } from "../src/benchmark/share-codec";
import { emptySystem, type BenchResult, type DeviceContext } from "../src/benchmark/types";
import { apartLabel, compareRuns, comparisonText, inviteText, matchLocal, otherRunsFor } from "../src/app/compare";

const EDGE: DeviceContext = { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" };
const CHROME = { ...EDGE, browser: "chrome" as const };
const EDGE_4070 = { ...EDGE, gpuLabel: "NVIDIA GeForce RTX 4070" };

function br(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "r", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", date: "2026-10-22", time: "12:00", resolutionId: "1440p", resolution: "1440p",
    width: 2560, height: 1440, preset: "Ultra", durationS: 60, graphicsApi: "WebGL2", avgFps: 142.3, p1Low: 118.4, p5Low: 126, worstMs: 14, frameCount: 8540,
    loopBusy: 0.95, timing: "gpu-timer", valid: true, invalidReason: "", device: EDGE, mobile: false, system: emptySystem(), ...over,
  };
}
const run = (over: Partial<BenchResult> = {}): SharedRun => {
  const { valid, ...rest } = sharedRunFrom(br(over));
  void valid;
  return rest;
};

describe("compareRuns: neutral wording", () => {
  it("faster, slower and about the same", () => {
    expect(compareRuns(run(), run({ avgFps: 155 })).verdict).toBe("Your run was 8.9% faster than the shared run.");
    expect(compareRuns(run(), run({ avgFps: 130 })).verdict).toBe("Your run was 8.6% slower than the shared run.");
    expect(compareRuns(run(), run({ avgFps: 142.9 })).verdict).toBe("About the same: within 0.5% of each other.");
    expect(compareRuns(run(), run({ avgFps: 155 })).pct).toBeCloseTo(8.92, 1);
    const all = [compareRuns(run(), run({ avgFps: 155 })), compareRuns(run(), run({ avgFps: 100 }))].map((c) => c.verdict + c.notes.join(" ")).join(" ");
    expect(all).not.toMatch(/beat|win|lose|friend|challenge/i);
  });

  it("notes when settings or versions differ; hides % across major versions", () => {
    const diff = compareRuns(run(), run({ resolutionId: "4K", resolution: "4K", width: 3840, height: 2160 }));
    expect(diff.likeForLike).toBe(false);
    expect(diff.notes[0]).toBe("Not like-for-like: the shared run used 1440p · Ultra · 60 s, your run used 4K · Ultra · 60 s.");
    expect(compareRuns(run(), run({ benchmarkVersion: "2.1.0" })).notes).toContain("Benchmark versions differ (2.2.0 vs 2.1.0); numbers may differ slightly.");
    const major = compareRuns(run(), run({ benchmarkVersion: "1.1.0" }));
    expect(major.pct).toBeNull();
    expect(major.verdict).toBe("");
    expect(major.notes).toContain("Different benchmark versions (2.x vs 1.x), so the FPS can't be compared.");
    expect(apartLabel(major)).toBe("");
  });

  it("recognises a browser comparison and a GPU comparison", () => {
    expect(compareRuns(run(), run({ device: CHROME })).notes).toContain("Same GPU and OS, different browser (Edge 141 vs Chrome 141): this compares browsers.");
    expect(compareRuns(run(), run({ device: EDGE_4070 })).notes).toContain("Same browser, different GPU (NVIDIA GeForce RTX 5080 vs NVIDIA GeForce RTX 4070).");
    expect(compareRuns(run(), run()).notes).toEqual([]);
  });

  it("labels can name both sides for a third party", () => {
    expect(compareRuns(run(), run({ avgFps: 155 }), { a: "the shared run", b: "The compared run" }).verdict).toBe("The compared run was 8.9% faster than the shared run.");
  });
});

describe("share texts", () => {
  it("invite and comparison read neutrally", () => {
    expect(inviteText(run())).toBe(
      "142.3 FPS avg at 1440p · Ultra · 60 s in the Neon Flythrough browser GPU benchmark (NVIDIA GeForce RTX 5080 · Edge 141). Run the same test on your device or browser and compare:",
    );
    expect(comparisonText(run(), run({ avgFps: 155, device: CHROME }))).toBe(
      "Neon Flythrough at 1440p · Ultra · 60 s: 155.0 vs 142.3 FPS avg (8.9% apart). NVIDIA GeForce RTX 5080 · Chrome 141 vs NVIDIA GeForce RTX 5080 · Edge 141. Compare your own:",
    );
    expect(inviteText(run()) + comparisonText(run(), run())).not.toMatch(/beat|friend|win/i);
  });
});

describe("matching local runs", () => {
  const list = [
    br({ id: "same-60-old", date: "2026-10-01" }),
    br({ id: "same-30-new", durationS: 30, frameCount: 4270, date: "2026-10-21" }),
    br({ id: "same-60-new", date: "2026-10-20" }),
    br({ id: "other-preset", preset: "High" }),
    br({ id: "invalid", valid: false, invalidReason: "Aborted by user" }),
    br({ id: "v1", benchmarkVersion: "1.1.0" }),
  ];
  it("Compare with mine: same major, resolution and preset; same duration first, then newest", () => {
    expect(matchLocal(list, run()).map((r) => r.id)).toEqual(["same-60-new", "same-60-old", "same-30-new"]);
  });
  it("Compare with another of my runs: same settings first, then the rest", () => {
    const mine = list[2];
    const others = otherRunsFor(list, mine).map((o) => `${o.run.id}:${o.sameSettings}`);
    expect(others.slice(0, 1)).toEqual(["same-60-old:true"]);
    expect(others).not.toContain("invalid:false");
    expect(others).toContain("same-30-new:false");
    expect(others).toContain("v1:false");
  });
});

describe("the compared-with run stays local", () => {
  it("is stripped from JSON export", async () => {
    const { toJson } = await import("../src/benchmark/exporter");
    const j = JSON.parse(toJson(br({ challenge: "AQEC-someone-elses-run" })));
    expect(j.challenge).toBeUndefined();
    expect(j.avgFps).toBe(142.3);
  });
});
