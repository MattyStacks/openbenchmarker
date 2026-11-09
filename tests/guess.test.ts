import { describe, expect, it } from "vitest";
import { NOT_LISTED } from "../src/benchmark/catalog";
import { applyGuesses, guessSystem, mesaVersion, referenceFormFactor, rendererGpuName, windowsVersion } from "../src/benchmark/guess";
import { emptySystem, type BenchResult, type DeviceContext, type RunDiagnostics, type SystemProbe } from "../src/benchmark/types";

// Real renderer strings. The first two are from Chromium on a Steam Machine (SteamOS 3.9, Mesa 26.1).
const STEAM_MACHINE_GL = "ANGLE (AMD, AMD Steam Machine (radeonsi navi33 ACO), OpenGL ES 3.2)";
const STEAM_MACHINE_VK = "ANGLE (AMD, Vulkan 1.4.350 (AMD Steam Machine (RADV NAVI33) (0x00007481)), radv)";
const STEAM_DECK = "ANGLE (AMD, AMD Custom GPU 0405 (radeonsi vangogh LLVM 15.0.7 DRM 3.49 6.1.52-valve16-1-neptune-61), OpenGL 4.6)";
const RTX_5080_D3D = "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)";
const RTX_5060TI = "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)";
const LAPTOP_4070 = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)";
const FIREFOX = "NVIDIA GeForce GTX 980, or similar";
const MESA_FF = "AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 19.1.7, DRM 3.61, 6.14.4) Mesa 25.0.4";

const probe = (over: Partial<SystemProbe> = {}): SystemProbe => ({
  platformVersion: null, model: null, formFactors: null, deviceMemoryGb: null, screen: null, battery: null, webgpu: null, ...over,
});
function run(renderer: string, os: DeviceContext["os"], p?: SystemProbe): BenchResult {
  return {
    id: "g", gameId: "x", benchmarkVersion: "4.0.0", date: "2026-11-09", time: "12:00", resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080,
    preset: "High", durationS: 60, graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 15, frameCount: 6000, loopBusy: 1, valid: true, invalidReason: "",
    diag: { renderer, vendor: "" } as RunDiagnostics,
    device: { browser: "chrome", browserMajor: 153, os, deviceType: "desktop", webkitEngine: false, gpuLabel: null },
    ...(p ? { probe: p } : {}),
    system: emptySystem(),
  };
}

describe("reading the renderer", () => {
  it("takes the GPU's name out of ANGLE strings", () => {
    expect(rendererGpuName(STEAM_MACHINE_GL)).toBe("AMD Steam Machine");
    expect(rendererGpuName(STEAM_MACHINE_VK)).toBe("AMD Steam Machine");
    expect(rendererGpuName(RTX_5080_D3D)).toBe("NVIDIA GeForce RTX 5080");
    expect(rendererGpuName(STEAM_DECK)).toBe("AMD Custom GPU 0405");
    expect(rendererGpuName(MESA_FF)).toBe("AMD Radeon RX 7800 XT");
    expect(rendererGpuName("")).toBe("");
    expect(rendererGpuName("WebKit WebGL")).toBe("");
  });

  it("finds Mesa's version where the browser shows it", () => {
    expect(mesaVersion(MESA_FF)).toBe("25.0.4");
    expect(mesaVersion(STEAM_MACHINE_GL)).toBe("");
  });

  it("tells Windows 11 from 10 by UA Client Hints", () => {
    expect(windowsVersion("15.0.0")).toBe("Windows 11");
    expect(windowsVersion("10.0.0")).toBe("Windows 10");
    expect(windowsVersion("")).toBe("");
    expect(windowsVersion(null)).toBe("");
  });

  it("knows a laptop chip from its reference id", () => {
    for (const id of ["rtx_4070_laptop_8gb", "rx_7600m_xt_8gb", "rx_6800s_8gb", "r9_m290x_4gb", "arc_a370m_4gb"]) expect(referenceFormFactor({ id }), id).toBe("laptop");
    for (const id of ["rtx_5080_16gb", "rx_9070_xt_16gb", "arc_b580_12gb", "r9_290x_4gb"]) expect(referenceFormFactor({ id }), id).toBe("desktop");
    expect(referenceFormFactor({ id: "arc_140v", memoryShared: true })).toBe("laptop");
  });
});

describe("guessing the system", () => {
  it("recognises a Steam Machine on SteamOS: the device, CPU and distro, and memory from the browser", () => {
    const g = guessSystem(run(STEAM_MACHINE_GL, "linux", probe({ deviceMemoryGb: 32 })));
    expect(g.device?.id).toBe("steam_machine_8gb_valve");
    expect(g.values).toEqual({
      os: "linux", gpuId: "steam_machine_8gb_valve", cpu: "AMD Custom CPU 1772", distro: "SteamOS", osDetail: "SteamOS", memoryGb: "32",
    });
    expect(g.why.cpu).toBe("Steam Machine spec");
    expect(g.why.memoryGb).toMatch(/rounds down/);
  });

  it("fills a Steam Deck's soldered memory from its catalog spec", () => {
    const g = guessSystem(run(STEAM_DECK, "linux", probe({ deviceMemoryGb: 16 })));
    expect(g.values).toMatchObject({ gpuId: "steam_deck_lcd_16gb", cpu: "AMD Custom APU 0405", memoryGb: "16", memoryType: "LPDDR5-5500", memoryChannels: "4" });
    expect(g.why.memoryGb).toBe("Steam Deck LCD spec");
  });

  it("picks the one listed product for a chip, and says to check the exact card", () => {
    const g = guessSystem(run(RTX_5080_D3D, "windows", probe({ platformVersion: "19.0.0" })));
    expect(g.values).toMatchObject({ os: "windows", osDetail: "Windows 11", gpuId: "rtx_5080_16gb_fe" });
    expect(g.why.gpuId).toMatch(/exact card/);
  });

  it("fills in a known chip that isn't listed yet, ready to submit when its memory size is known", () => {
    const g = guessSystem(run(LAPTOP_4070, "windows"));
    expect(g.values).toMatchObject({ gpuId: NOT_LISTED, gpuName: "GeForce RTX 4070 Laptop GPU 8 GB", gpuFormFactor: "laptop", gpuIdRequested: "rtx_4070_laptop_8gb_reference" });
    // Two memory sizes: the name is filled in and the user picks the size.
    const ti = guessSystem(run(RTX_5060TI, "windows"));
    expect(ti.values).toMatchObject({ gpuId: NOT_LISTED, gpuName: "NVIDIA GeForce RTX 5060 Ti", gpuFormFactor: "desktop" });
    expect(ti.values.gpuIdRequested).toBeUndefined();
  });

  it("takes Mesa from the renderer on Linux, and nothing from Firefox's approximate names", () => {
    expect(guessSystem(run(MESA_FF, "linux")).values).toMatchObject({ mesa: "25.0.4", driver: "Mesa 25.0.4", gpuId: NOT_LISTED });
    const ff = guessSystem(run(FIREFOX, "windows"));
    expect(ff.values.gpuId).toBeUndefined();
    expect(ff.values.os).toBe("windows");
  });
});

describe("applying the guesses", () => {
  it("fills blank fields once, marked with their reason, never over the user's values", () => {
    const r = run(STEAM_MACHINE_GL, "linux", probe({ deviceMemoryGb: 32 }));
    r.system.cpu = "My own CPU";
    const out = applyGuesses(r);
    expect(out.system.cpu).toBe("My own CPU");
    expect(out.system.gpuId).toBe("steam_machine_8gb_valve");
    expect(out.suggested).toEqual(expect.arrayContaining(["gpuId", "os", "distro", "memoryGb"]));
    expect(out.suggested).not.toContain("cpu");
    expect(out.suggestedWhy?.distro).toBe("Steam Machine spec");
    expect(out.guessed).toBe(true);
    // Cleared by the user afterwards: not filled in again.
    const cleared = { ...out, system: { ...out.system, memoryGb: "" } };
    expect(applyGuesses(cleared).system.memoryGb).toBe("");
  });

  it("leaves a GPU the user already chose alone", () => {
    const r = run(LAPTOP_4070, "windows");
    r.system.gpuId = "rtx_5080_16gb_fe";
    const out = applyGuesses(r);
    expect(out.system.gpuId).toBe("rtx_5080_16gb_fe");
    expect(out.system.gpuName).toBe("");
  });
});
