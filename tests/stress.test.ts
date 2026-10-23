import { describe, expect, it } from "vitest";
import { BENCHMARK, GPU_CATALOG } from "../src/benchmark/catalog";
import { toCsv, toJson, toRunYaml, toYaml } from "../src/benchmark/exporter";
import { emptySystem, type BenchResult } from "../src/benchmark/types";
import { validateSubmission } from "../src/benchmark/validate";
import { submissionStatus, tableStatus } from "../src/app/result-display";
import { changeText, completedStress, lapChartSvg, lapTableHtml, pctText, stressReading } from "../src/app/stress-view";
import { csvCells } from "./csv";

const LAPS = [152.1, 151.8, 150.2, 148.9, 147.5, 146.7];

function stressResult(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "s1", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", date: "2026-10-23", time: "19:00", resolutionId: "4K", resolution: "4K",
    width: 3840, height: 2160, preset: "Extreme", durationS: 576, graphicsApi: "WebGL2", avgFps: 149.5, p1Low: 120.3, p5Low: 131, worstMs: 11.2,
    frameCount: 86112, loopBusy: 0.98, timing: "gpu-timer", valid: true, invalidReason: "", stressTest: "extreme",
    laps: LAPS.map((avgFps) => ({ avgFps, p1Low: avgFps * 0.8 })),
    system: { ...emptySystem(), gpuId: GPU_CATALOG[0].id, os: "windows" }, ...over,
  };
}

describe("stress results", () => {
  it("count as complete only when valid, locked and every lap finished", () => {
    expect(completedStress(stressResult())?.id).toBe("extreme");
    expect(completedStress(stressResult({ valid: false, invalidReason: "Aborted by user" }))).toBeUndefined();
    expect(completedStress(stressResult({ laps: stressResult().laps!.slice(0, 2), durationS: 192 }))).toBeUndefined();
    expect(completedStress(stressResult({ preset: "Ultra" }))).toBeUndefined();
    expect(completedStress(stressResult({ stressTest: undefined }))).toBeUndefined();
  });

  it("are never submitted, even with every system field filled", () => {
    const errs = validateSubmission(stressResult());
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^Run: stress tests/);
    expect(() => toYaml(stressResult())).toThrow(/Not submittable/);
    expect(submissionStatus(stressResult()).kind).toBe("stress");
    expect(tableStatus(stressResult())).toEqual({ cls: "muted", text: "Share only" });
  });

  it("export stability and every lap in the run report, JSON and CSV", () => {
    const y = toRunYaml(stressResult());
    expect(y).toMatch(/Not a submission/);
    expect(y).toMatch(/^ {4}stress_test: extreme$/m);
    expect(y).toMatch(/^ {4}stability_pct: 96\.4$/m);
    expect(y).toMatch(/^ {6}- \{ lap: 6, avg_fps: 146\.7, p1_low: 117\.4 \}$/m);
    expect(y).toMatch(/^graphics_api: WebGL2$/m);
    expect(JSON.parse(toJson(stressResult())).stabilityPct).toBe(96.4);
    const [head, row] = toCsv([stressResult()]).trim().split("\n").map(csvCells);
    const col = (k: string) => row[head.indexOf(k)];
    expect(col("stress_test")).toBe("extreme");
    expect(col("stability_pct")).toBe("96.4");
    expect(col("lap_avg_fps")).toBe(LAPS.join(" "));
  });
});

describe("stress reading", () => {
  it("bands by stability and says the browser can't see heat directly", () => {
    expect(stressReading([150, 149.5, 150.4, 149.8])!.band).toBe("steady");
    const slowed = stressReading(LAPS)!;
    expect(slowed.band).toBe("slowed");
    expect(slowed.body).toMatch(/3\.6% below the fastest/);
    expect(slowed.body).toMatch(/The last lap was −3\.6% against the first/);
    const throttled = stressReading([300, 260, 240, 230, 225, 222], true)!;
    expect(throttled.band).toBe("throttled");
    expect(throttled.body).toMatch(/thermal throttling/);
    expect(throttled.body).toMatch(/CPU or browser/);
    expect(stressReading([])).toBeNull();
  });

  it("formats percentages and changes", () => {
    expect(pctText(0.9644)).toBe("96.4%");
    expect(changeText(-0.0355)).toBe("−3.5%");
    expect(changeText(0.012)).toBe("+1.2%");
  });
});

describe("lap chart and table", () => {
  it("draws one marker and label per lap, with a value tooltip and an accessible summary", () => {
    const svg = lapChartSvg(LAPS);
    expect(svg.match(/class="lc-dot"/g)).toHaveLength(6);
    expect(svg).toMatch(/<title>Lap 6: 146\.7 FPS<\/title>/);
    expect(svg).toMatch(/aria-label="Average FPS per lap: lap 1 152\.1, .*Stability 96\.4%\."/);
    expect(svg).not.toMatch(/NaN|Infinity/);
    // Identical laps (a perfectly steady run) and a single lap still draw cleanly.
    expect(lapChartSvg([200, 200, 200])).not.toMatch(/NaN|Infinity/);
    expect(lapChartSvg([200])).not.toMatch(/NaN|Infinity/);
    expect(lapChartSvg([])).toBe("");
  });

  it("table shows each lap against lap 1, and 1% lows when known", () => {
    const t = lapTableHtml(LAPS, LAPS.map((x) => x * 0.8));
    expect(t.match(/<tr>/g)).toHaveLength(7);
    expect(t).toMatch(/<td>Lap 6<\/td><td class="num">146\.7<\/td><td class="num">−3\.6%<\/td><td class="num">117\.4<\/td>/);
    expect(lapTableHtml(LAPS)).not.toMatch(/1% low/);
  });
});
