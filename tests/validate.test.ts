import { describe, expect, it } from "vitest";
import { BENCHMARK, GPU_CATALOG, NOT_LISTED } from "../src/benchmark/catalog";
import { toCsv, toJson, toYaml, suggestedFileName } from "../src/benchmark/exporter";
import { emptySystem, type BenchResult } from "../src/benchmark/types";
import { missingLabels, validateSubmission } from "../src/benchmark/validate";

const GPU = GPU_CATALOG[0].id;

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "t1",
    gameId: BENCHMARK.gameId,
    benchmarkVersion: "1.1.0",
    timing: "gpu-timer",
    date: "2026-10-19",
    time: "12:30",
    resolutionId: "1080p",
    resolution: "1080p",
    width: 1920,
    height: 1080,
    preset: "Ultra",
    durationS: 60,
    graphicsApi: "WebGL2",
    avgFps: 143.21,
    p1Low: 101.04,
    p5Low: 118.5,
    worstMs: 14.2,
    frameCount: 8592,
    loopBusy: 0.97,
    valid: true,
    invalidReason: "",
    system: emptySystem(),
    ...over,
  };
}
const withSys = (sys: Partial<BenchResult["system"]>, over: Partial<BenchResult> = {}) =>
  result({ ...over, system: { ...emptySystem(), ...sys } });

describe("validateSubmission", () => {
  it("blank form fails on GPU and OS", () => {
    const errs = validateSubmission(result());
    expect(missingLabels(errs)).toEqual(["GPU", "OS"]);
  });

  it("catalog GPU + OS passes", () => {
    expect(validateSubmission(withSys({ gpuId: GPU, os: "windows" }))).toEqual([]);
    expect(validateSubmission(withSys({ gpuId: GPU, os: "linux", distro: "Fedora", mesa: "24.2.5" }))).toEqual([]);
  });

  it("only the four standard resolutions can be submitted", () => {
    for (const [resolution, width, height] of [["720p", 1280, 720], ["1440p", 2560, 1440], ["4K", 3840, 2160]] as const)
      expect(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { resolutionId: resolution, resolution, width, height }))).toEqual([]);
    // An old Native result at a non-standard size stays local only.
    const errs = validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { resolution: "3440x1440", width: 3440, height: 1440 }));
    expect(missingLabels(errs)).toEqual(["Resolution"]);
    expect(errs[0]).toMatch(/720p, 1080p, 1440p, 4K/);
    // An old Native result that happened to be exactly 1920x1080 is a real 1080p run.
    expect(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { resolution: "1080p", width: 1920, height: 1080 }))).toEqual([]);
    // A name that doesn't match the pixel size is rejected.
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { resolution: "1080p", width: 2560, height: 1440 })))).toEqual(["Resolution"]);
  });

  it("mobile runs are blocked even when otherwise complete", () => {
    const errs = validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { mobile: true }));
    expect(missingLabels(errs)).toEqual(["Device"]);
  });

  it("NOT_LISTED is blocked and points upstream", () => {
    const errs = validateSubmission(withSys({ gpuId: NOT_LISTED, os: "windows" }));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/not in the catalog/);
    expect(errs[0]).toMatch(/github\.com\/MattyStacks\/open-gpu-benchmarks\/issues/);
  });

  it("free-text GPU names are rejected", () => {
    for (const gpuId of ["RTX 5080", "rtx_5080", "GeForce RTX 5080 Founders Edition", "rtx_5080_16gb"]) {
      expect(validateSubmission(withSys({ gpuId, os: "windows" }))[0]).toMatch(/^GPU:/);
    }
  });

  it("OS must be exactly windows or linux", () => {
    for (const os of ["Windows", "Windows 11", "macos", " "]) {
      expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os })))).toEqual(["OS"]);
    }
  });

  it("Linux-only fields on a windows run fail", () => {
    const errs = validateSubmission(withSys({ gpuId: GPU, os: "windows", kernel: "6.11" }));
    expect(errs.join()).toMatch(/kernel is Linux-only/);
  });

  it("memory_gb is digits only", () => {
    expect(validateSubmission(withSys({ gpuId: GPU, os: "windows", memoryGb: "32 GB" }))[0]).toMatch(/^Memory:/);
    expect(validateSubmission(withSys({ gpuId: GPU, os: "windows", memoryGb: "32" }))).toEqual([]);
  });

  it("invalid runs and missing measurements are never submittable", () => {
    expect(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { valid: false, invalidReason: "Aborted by user" }))[0]).toMatch(/^Run: invalid/);
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { p1Low: 0 })))).toEqual(["1% Low"]);
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { p1Low: 200 })))).toEqual(["1% Low"]);
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { avgFps: NaN })))).toContain("Avg FPS");
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { date: "" })))).toEqual(["Date"]);
    expect(missingLabels(validateSubmission(withSys({ gpuId: GPU, os: "windows" }, { gameId: "cyberpunk_2077" })))).toEqual(["Benchmark"]);
    expect(validateSubmission(null)).not.toEqual([]);
  });
});

describe("exports", () => {
  it("YAML refuses to render an unsubmittable result", () => {
    expect(() => toYaml(result())).toThrow(/Not submittable/);
  });

  it("YAML has measured fields, no invented hardware, blank optionals omitted, graphics_api emitted", () => {
    const y = toYaml(withSys({ gpuId: GPU, os: "windows" }));
    expect(y).toMatch(/^gpu_id: rtx_5080_16gb_fe$/m);
    expect(y).toMatch(/^game_id: openbenchmarker_neon_flythrough$/m);
    expect(y).toMatch(/^date: "2026-10-19"$/m);
    expect(y).toMatch(/^ {2}- resolution: "1080p"$/m);
    expect(y).toMatch(/^ {4}graphics_preset: "Ultra"$/m);
    expect(y).toMatch(/^ {4}avg_fps: 143.2$/m);
    expect(y).toMatch(/^ {4}p1_low: 101$/m);
    expect(y).toMatch(/^ {4}p5_low: 118.5$/m);
    expect(y).toMatch(/^ {2}os: windows$/m);
    expect(y).toMatch(/^ {2}graphics_api: WebGL2\b/m);
    expect(y).toMatch(/^proof:\n {2}method: other\b/m);
    expect(y).toMatch(/^frame_generation: false$/m);
    for (const k of ["cpu", "driver", "memory_gb", "memory_type", "os_detail", "distro", "kernel", "mesa", "proton"])
      expect(y).not.toMatch(new RegExp(`^\\s*${k}:`, "m"));
    // Block style only (upstream rule): no inline maps/lists in YAML values.
    expect(y.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n")).not.toMatch(/: [[{]/);
  });

  it("YAML includes what the user provided, quoted as text", () => {
    const y = toYaml(withSys({ gpuId: GPU, os: "linux", cpu: "AMD Ryzen 7 7800X3D", memoryGb: "32", driver: "Mesa 24.2.5", kernel: "6.11.4" }));
    expect(y).toMatch(/^ {2}cpu: "AMD Ryzen 7 7800X3D"$/m);
    expect(y).toMatch(/^ {2}memory_gb: 32$/m);
    expect(y).toMatch(/^ {2}driver: "Mesa 24.2.5"$/m);
    expect(y).toMatch(/^ {2}kernel: "6.11.4"$/m);
  });

  it("file name follows result_YYYYMMDD_<game_id>.yaml", () => {
    expect(suggestedFileName(result(), "yaml")).toBe("result_20261019_openbenchmarker_neon_flythrough.yaml");
  });

  it("JSON and CSV are always available and say when incomplete", () => {
    const r = result();
    expect(JSON.parse(toJson(r)).submittable).toBe(false);
    const csv = toCsv([r]).trim().split("\n");
    expect(csv).toHaveLength(2);
    expect(csv[1].startsWith("incomplete,")).toBe(true);
    expect(toCsv([result({ valid: false, invalidReason: "Tab hidden" })]).split("\n")[1]).toMatch(/^invalid,Tab hidden/);
  });

  it("timing method is in JSON and CSV but not an upstream YAML field", () => {
    const r = withSys({ gpuId: GPU, os: "windows" });
    expect(JSON.parse(toJson(r)).timing).toBe("gpu-timer");
    const [head, row] = toCsv([r]).trim().split("\n").map((l) => l.split(","));
    expect(row[head.indexOf("timing")]).toBe("gpu-timer");
    expect(toYaml(r)).not.toMatch(/^\s*timing:/m);
  });
});
