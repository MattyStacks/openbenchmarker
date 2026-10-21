import { describe, expect, it } from "vitest";
import { BENCHMARK } from "../src/benchmark/catalog";
import { browserName, diagnose, isIntegratedRenderer, isMaskedRenderer, isSoftwareRenderer, liveVerdict, parseBackend } from "../src/benchmark/diagnose";
import { emptySystem, type BenchResult, type RunDiagnostics } from "../src/benchmark/types";

const NV = "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)";

function diag(over: Partial<RunDiagnostics> = {}): RunDiagnostics {
  return {
    gpuBusy: 0.97,
    gpuMs: 9.7,
    cpuMs: 2,
    updateMs: 0.5,
    syncMs: 7,
    frameMs: 10,
    stalls: 0,
    stallMs: 0,
    hitches: 0,
    frameStdMs: 0.8,
    heapGrowthMb: 4,
    renderer: NV,
    vendor: "Google Inc. (NVIDIA)",
    backend: "D3D11",
    maxTextureSize: 16384,
    cpuThreads: 16,
    onBattery: false,
    browser: "Chrome 141",
    features: { bloom: true, msaa: 8, shadowMap: 4096, reflections: 1, fallbackReason: "" },
    ...over,
  };
}

function result(d: Partial<RunDiagnostics> = {}, over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "d1",
    gameId: BENCHMARK.gameId,
    benchmarkVersion: "2.0.0",
    date: "2026-10-21",
    time: "12:00",
    resolutionId: "4K",
    resolution: "4K",
    width: 3840,
    height: 2160,
    preset: "Extreme",
    durationS: 60,
    graphicsApi: "WebGL2",
    avgFps: 100,
    p1Low: 85,
    p5Low: 90,
    worstMs: 14,
    frameCount: 6000,
    loopBusy: 0.98,
    timing: "gpu-timer",
    valid: true,
    invalidReason: "",
    diag: diag(d),
    system: emptySystem(),
    ...over,
  };
}

const titles = (r: BenchResult) => diagnose(r).findings.map((f) => f.title);

describe("diagnose verdict", () => {
  it("GPU busy near 100% is GPU-limited with no warnings", () => {
    const dx = diagnose(result());
    expect(dx.verdict).toBe("gpu");
    expect(dx.estimated).toBe(false);
    expect(dx.findings).toEqual([]);
  });

  it("low GPU busy with busy JavaScript is CPU-limited and says why", () => {
    const dx = diagnose(result({ gpuBusy: 0.35, gpuMs: 1.2, cpuMs: 2.8, updateMs: 1.9, syncMs: 0.1, frameMs: 3.4 }, { preset: "Low" }));
    expect(dx.verdict).toBe("cpu");
    expect(dx.detail).toMatch(/scene update 1\.90 ms/);
    expect(dx.detail).toMatch(/16-thread CPU, one maxed thread is only about 6%/);
    expect(titles(result({ gpuBusy: 0.35, cpuMs: 2.8, frameMs: 3.4 }))).toContain("This result is limited by the CPU side");
  });

  it("a CPU-limited score run still has its score and is labelled", () => {
    const r = result({ gpuBusy: 0.4, cpuMs: 3, frameMs: 4 }, { scoreTest: "entry", score: 25000 });
    expect(titles(r)).toContain("This score is limited by the CPU side");
  });

  it("idle GPU, idle JS but long waits points at the driver / browser GPU process", () => {
    expect(diagnose(result({ gpuBusy: 0.4, cpuMs: 1, syncMs: 6, frameMs: 10 })).verdict).toBe("driver");
  });

  it("75-90% GPU busy is mixed", () => {
    expect(diagnose(result({ gpuBusy: 0.82 })).verdict).toBe("mixed");
  });

  it("without timers, the readback wait and JS time are used as an estimate", () => {
    const gpuish = diagnose(result({ gpuBusy: null, gpuMs: null, cpuMs: 1, syncMs: 8, frameMs: 10 }));
    expect([gpuish.verdict, gpuish.estimated]).toEqual(["gpu", true]);
    expect(diagnose(result({ gpuBusy: null, gpuMs: null, cpuMs: 7, syncMs: 1, frameMs: 10 })).verdict).toBe("cpu");
    expect(diagnose(result({ gpuBusy: null, gpuMs: null, cpuMs: 2, syncMs: 2, frameMs: 10 })).verdict).toBe("unknown");
    expect(titles(result({ gpuBusy: null, gpuMs: null }))).toContain("No GPU timers in this browser");
  });

  it("software rendering overrides everything", () => {
    const r = result({ renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" });
    expect(diagnose(r).verdict).toBe("software");
    expect(diagnose(r).findings[0].severity).toBe("bad");
  });

  it("results without diagnostics are unknown, not an error", () => {
    expect(diagnose(result({}, { diag: undefined })).verdict).toBe("unknown");
  });
});

describe("diagnose findings", () => {
  it("flags integrated GPUs, battery, stalls, stutter and fallbacks only when present", () => {
    expect(titles(result({ renderer: "ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)" }))).toContain(
      "The browser may be using an integrated GPU",
    );
    expect(titles(result({ onBattery: true }))).toContain("Running on battery");
    expect(titles(result({ stalls: 5, stallMs: 150 }))).toContain("Other work interrupted the run");
    expect(titles(result({ stalls: 1, stallMs: 21 }))).not.toContain("Other work interrupted the run");
    expect(titles(result({ hitches: 80 }))).toContain("Uneven frame pacing");
    expect(titles(result({}, { p1Low: 30 }))).toContain("Uneven frame pacing");
    expect(titles(result({ features: { bloom: false, msaa: 0, shadowMap: 4096, reflections: 1, fallbackReason: "Bloom composer failed" } }))).toContain(
      "Part of the preset couldn't run",
    );
    expect(titles(result({ heapGrowthMb: 400 }))).toContain("Memory grew during the run");
  });
});

describe("renderer and browser parsing", () => {
  it("detects software and integrated renderers", () => {
    expect(isSoftwareRenderer("llvmpipe (LLVM 17.0.6, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true);
    expect(isSoftwareRenderer(NV)).toBe(false);
    expect(isIntegratedRenderer("ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true);
    expect(isIntegratedRenderer("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isIntegratedRenderer(NV)).toBe(false);
  });

  it("parses the ANGLE backend", () => {
    expect(parseBackend(NV)).toBe("D3D11");
    expect(parseBackend("ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL 4.5.0)")).toBe("OpenGL");
    expect(parseBackend("ANGLE (AMD, Vulkan 1.3.260 (AMD Radeon RX 7900 XTX (0x0000744C)), AMD proprietary driver)")).toBe("Vulkan");
    expect(parseBackend("ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)")).toBe("Metal");
    expect(parseBackend("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Vulkan, Vulkan)")).toBe("Vulkan");
    expect(parseBackend("Mesa Intel(R) Graphics")).toBe("");
  });

  it("names the browser", () => {
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe("Chrome 141");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0")).toBe("Edge 141");
    expect(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox 132");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15")).toBe("Safari 18");
  });

  it("live verdict thresholds", () => {
    expect([liveVerdict(0.95), liveVerdict(0.8), liveVerdict(0.5), liveVerdict(null)]).toEqual(["gpu", "mixed", "cpu", null]);
  });

  it("flags a renderer string hidden by the browser (Brave)", () => {
    expect(isMaskedRenderer("Brave")).toBe(true);
    expect(isMaskedRenderer("unavailable")).toBe(true);
    expect(isMaskedRenderer(NV)).toBe(false);
    const t = titles(result({ renderer: "Brave", vendor: "Brave", backend: "", cpuThreads: null, browser: "Brave 155" }));
    expect(t).toContain("The browser hid the GPU name");
    expect(titles(result())).not.toContain("The browser hid the GPU name");
  });
});
