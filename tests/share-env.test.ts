import { afterEach, describe, expect, it, vi } from "vitest";
import { BENCHMARK, GPU_CATALOG } from "../src/benchmark/catalog";
import { toJson, toYaml } from "../src/benchmark/exporter";
import { emptySystem, type BenchResult } from "../src/benchmark/types";
import { detectDeviceContextAsync, deviceContextFrom, normalizeGpuLabel, parseBrowser, parseDeviceType, parseOs } from "../src/app/share-env";
import { migrateDevice } from "../src/app/store";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/141.0.0.0`;
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/141.0.0.0 Mobile Safari/537.36";
const OPERA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/115.0.0.0";
const VIVALDI_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Vivaldi/7.0.3495.14";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";
const EDGE_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0";
const EDGE_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/141.0.0.0 Mobile/15E148 Safari/605.1.15";
const FIREFOX_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15";
const CROS = "Mozilla/5.0 (X11; CrOS x86_64 15699.58.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("parseBrowser", () => {
  it("detects desktop browsers from UA", () => {
    expect(parseBrowser(CHROME_WIN)).toEqual({ browser: "chrome", browserMajor: 141 });
    expect(parseBrowser(EDGE_WIN)).toEqual({ browser: "edge", browserMajor: 141 });
    expect(parseBrowser(FIREFOX_LINUX)).toEqual({ browser: "firefox", browserMajor: 132 });
    expect(parseBrowser(SAFARI_MAC)).toEqual({ browser: "safari", browserMajor: 17 });
    expect(parseBrowser(OPERA_WIN)).toEqual({ browser: "opera", browserMajor: 115 });
    expect(parseBrowser(VIVALDI_WIN).browser).toBe("vivaldi");
    expect(parseBrowser(SAMSUNG)).toEqual({ browser: "samsung", browserMajor: 26 });
  });

  it("Brave says Chrome in UA, so the flag and brands win", () => {
    expect(parseBrowser(CHROME_WIN, null, true)).toEqual({ browser: "brave", browserMajor: 141 });
    expect(parseBrowser(CHROME_WIN, [{ brand: "Brave", version: "141" }, { brand: "Chromium", version: "141" }])).toEqual({ browser: "brave", browserMajor: 141 });
    expect(parseBrowser(CHROME_WIN, [{ brand: "Microsoft Edge", version: "141" }])).toEqual({ browser: "edge", browserMajor: 141 });
    expect(parseBrowser(CHROME_WIN, [{ brand: "Google Chrome", version: "141" }, { brand: "Chromium", version: "141" }]).browser).toBe("chrome");
  });

  it("iOS browsers keep their name and are flagged WebKit by deviceContextFrom", () => {
    expect(parseBrowser(IPHONE_CHROME)).toEqual({ browser: "chrome", browserMajor: 141 });
    expect(parseBrowser(IPHONE_SAFARI)).toEqual({ browser: "safari", browserMajor: 17 });
    expect(deviceContextFrom({ ua: IPHONE_CHROME }).webkitEngine).toBe(true);
    expect(deviceContextFrom({ ua: CHROME_WIN }).webkitEngine).toBe(false);
  });

  it("mobile Firefox and Edge, including the iOS (WebKit) builds", () => {
    expect(deviceContextFrom({ ua: FIREFOX_ANDROID })).toMatchObject({ browser: "firefox", browserMajor: 132, os: "android", deviceType: "phone", webkitEngine: false });
    expect(deviceContextFrom({ ua: EDGE_ANDROID })).toMatchObject({ browser: "edge", browserMajor: 141, os: "android", deviceType: "phone" });
    expect(deviceContextFrom({ ua: EDGE_IOS })).toMatchObject({ browser: "edge", browserMajor: 141, os: "ios", deviceType: "phone", webkitEngine: true });
    expect(deviceContextFrom({ ua: FIREFOX_IOS })).toMatchObject({ browser: "firefox", browserMajor: 132, os: "ios", webkitEngine: true });
  });

  it("Opera from brands", () => {
    expect(parseBrowser(CHROME_WIN, [{ brand: "Opera", version: "115" }, { brand: "Chromium", version: "131" }])).toEqual({ browser: "opera", browserMajor: 115 });
  });

  it("unknown UA is other/null, never a guess", () => {
    expect(parseBrowser("SomeBot/1.0")).toEqual({ browser: "other", browserMajor: null });
  });
});

describe("parseOs / parseDeviceType", () => {
  it("detects OS", () => {
    expect(parseOs(CHROME_WIN)).toBe("windows");
    expect(parseOs(SAFARI_MAC)).toBe("macos");
    expect(parseOs(FIREFOX_LINUX)).toBe("linux");
    expect(parseOs(CROS)).toBe("chromeos");
    expect(parseOs(ANDROID_PHONE)).toBe("android");
    expect(parseOs(IPHONE_SAFARI)).toBe("ios");
  });

  it("iPadOS desktop UA + touch is ios/tablet; same UA without touch is macos/desktop", () => {
    expect(parseOs(IPAD_DESKTOP_UA, "MacIntel", 5)).toBe("ios");
    expect(parseDeviceType(IPAD_DESKTOP_UA, "ios", 5)).toBe("tablet");
    expect(parseOs(IPAD_DESKTOP_UA, "MacIntel", 0)).toBe("macos");
    expect(parseDeviceType(IPAD_DESKTOP_UA, "macos", 0)).toBe("desktop");
  });

  it("device type: phone vs tablet vs desktop", () => {
    expect(parseDeviceType(ANDROID_PHONE, "android")).toBe("phone");
    expect(parseDeviceType(ANDROID_TABLET, "android")).toBe("tablet");
    expect(parseDeviceType(IPHONE_SAFARI, "ios")).toBe("phone");
    expect(parseDeviceType(CHROME_WIN, "windows")).toBe("desktop");
    // Touch laptops stay desktop: touch alone does not make a tablet off iOS.
    expect(parseDeviceType(CHROME_WIN, "windows", 10)).toBe("desktop");
  });
});

describe("normalizeGpuLabel (reported by browser)", () => {
  it("strips ANGLE wrapper, hex id, backend and shader suffixes", () => {
    expect(normalizeGpuLabel("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)")).toBe("NVIDIA GeForce RTX 5080");
    expect(normalizeGpuLabel("ANGLE (Intel, Intel(R) UHD Graphics 630 (0x3E9B), OpenGL 4.1)", "Google Inc. (Intel)")).toBe("Intel(R) UHD Graphics 630");
    expect(normalizeGpuLabel("ANGLE (Apple, Apple M2 Pro, Metal)", "Apple")).toBe("Apple M2 Pro");
  });

  it("handles commas inside nested parentheses (software renderers)", () => {
    expect(normalizeGpuLabel("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "Google Inc. (Google)")).toBe("SwiftShader Device (Subzero)");
  });

  it("keeps plain and generic labels, caps at ~40 chars", () => {
    expect(normalizeGpuLabel("Apple GPU")).toBe("Apple GPU");
    expect(normalizeGpuLabel("Mali-G710 MC10")).toBe("Mali-G710 MC10");
    expect(normalizeGpuLabel("Adreno (TM) 740")).toBe("Adreno (TM) 740");
    const long = normalizeGpuLabel("ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Laptop GPU Extreme Edition (0x1234), Vulkan)");
    expect(long!.length).toBeLessThanOrEqual(40);
  });

  it("keeps Firefox's generic family names readable", () => {
    expect(normalizeGpuLabel("Radeon R9 200 Series, or similar")).toBe("Radeon R9 200 Series, or similar");
    expect(normalizeGpuLabel("Intel(R) HD Graphics, or similar")).toBe("Intel(R) HD Graphics, or similar");
  });

  it("masked or unusable renderers give null", () => {
    for (const r of ["", "unavailable", "Brave", "WebKit WebGL", "Mozilla"]) expect(normalizeGpuLabel(r)).toBeNull();
    expect(normalizeGpuLabel(null)).toBeNull();
    expect(normalizeGpuLabel(undefined)).toBeNull();
  });
});

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "t1", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", date: "2026-10-19", time: "12:30",
    resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "Ultra", durationS: 60,
    graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 10, frameCount: 6000, loopBusy: 0.97,
    valid: true, invalidReason: "", system: { ...emptySystem(), gpuId: GPU_CATALOG[0].id, os: "windows" }, ...over,
  };
}

describe("saved-result device field", () => {
  it("migration infers only safe fields, otherwise unknown", () => {
    const old = result({ diag: undefined });
    delete (old as Partial<BenchResult>).device;
    expect(migrateDevice(old)).toEqual({ browser: "other", browserMajor: null, os: "windows", deviceType: "unknown", webkitEngine: false, gpuLabel: null });
  });

  it("migration uses recorded diag browser/renderer, never system GPU", () => {
    const old = result({
      diag: {
        gpuBusy: null, gpuMs: null, cpuMs: 1, updateMs: 1, syncMs: 0, frameMs: 10, stalls: 0, stallMs: 0, hitches: 0,
        frameStdMs: 1, heapGrowthMb: null, renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        vendor: "Google Inc. (NVIDIA)", backend: "D3D11", maxTextureSize: 16384, cpuThreads: 16, onBattery: false,
        browser: "Chrome 141", features: { bloom: true, msaa: 4, shadowMap: 2048, reflections: 0, fallbackReason: "" },
      },
    });
    const d = migrateDevice(old);
    // "Chrome N" is ambiguous (Samsung Internet, Vivaldi record the same), so it stays unknown.
    expect(d.browser).toBe("other");
    expect(d.browserMajor).toBeNull();
    expect(d.gpuLabel).toBe("NVIDIA GeForce RTX 5080");
    const edge = migrateDevice({ ...old, diag: { ...old.diag!, browser: "Edge 141" } });
    expect(edge.browser).toBe("edge");
    expect(edge.browserMajor).toBe(141);
  });

  it("device never lands in submission YAML, but is in local JSON", () => {
    const r = result({ device: { browser: "chrome", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" } });
    const y = toYaml(r);
    expect(y).not.toMatch(/device:|gpuLabel|browserMajor|deviceType/);
    expect(JSON.parse(toJson(r)).device.gpuLabel).toBe("NVIDIA GeForce RTX 5080");
    // And it never fills system fields.
    expect(r.system.gpuId).toBe(GPU_CATALOG[0].id);
  });
});

describe("detectDeviceContextAsync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("navigator.brave.isBrave() wins over the Chrome UA", async () => {
    vi.stubGlobal("navigator", { userAgent: CHROME_WIN, platform: "Win32", maxTouchPoints: 0, brave: { isBrave: async () => true } });
    expect(await detectDeviceContextAsync()).toMatchObject({ browser: "brave", browserMajor: 141, os: "windows", deviceType: "desktop" });
  });

  it("a failing getHighEntropyValues falls back to low-entropy brands", async () => {
    vi.stubGlobal("navigator", {
      userAgent: EDGE_WIN, platform: "Win32", maxTouchPoints: 0,
      userAgentData: { brands: [{ brand: "Microsoft Edge", version: "141" }], platform: "Windows", getHighEntropyValues: async () => { throw new Error("denied"); } },
    });
    const d = await detectDeviceContextAsync("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)", "Google Inc. (NVIDIA)");
    expect(d).toMatchObject({ browser: "edge", browserMajor: 141, os: "windows", gpuLabel: "NVIDIA GeForce RTX 5080" });
  });
});
