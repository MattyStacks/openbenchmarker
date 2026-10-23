import { describe, expect, it } from "vitest";
import { BENCHMARK, GPU_CATALOG } from "../src/benchmark/catalog";
import { emptySystem, type BenchResult, type DeviceContext } from "../src/benchmark/types";
import {
  canShare,
  deviceLine,
  facetValues,
  filterRuns,
  isHandheld,
  mixesMajors,
  runClass,
  sortRuns,
  submissionStatus,
} from "../src/app/result-display";

const dev = (over: Partial<DeviceContext>): DeviceContext => ({ browser: "other", browserMajor: null, os: "other", deviceType: "unknown", webkitEngine: false, gpuLabel: null, ...over });
const IPHONE = dev({ browser: "safari", browserMajor: 27, os: "ios", deviceType: "phone", webkitEngine: true, gpuLabel: "Apple GPU" });
const IPAD = dev({ browser: "safari", browserMajor: 18, os: "ios", deviceType: "tablet", webkitEngine: true, gpuLabel: "Apple GPU" });
const PIXEL = dev({ browser: "chrome", browserMajor: 141, os: "android", deviceType: "phone", gpuLabel: "Adreno (TM) 740" });
const DESK = dev({ browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", gpuLabel: "NVIDIA GeForce RTX 5080" });

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "r", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", date: "2026-10-22", time: "12:00", resolutionId: "1080p", resolution: "1080p",
    width: 1920, height: 1080, preset: "High", durationS: 60, graphicsApi: "WebGL2", avgFps: 100, p1Low: 80, p5Low: 90, worstMs: 14, frameCount: 6000,
    loopBusy: 0.95, timing: "gpu-timer", valid: true, invalidReason: "", system: emptySystem(), ...over,
  };
}
const READY_SYS = { ...emptySystem(), gpuId: GPU_CATALOG[0].id, os: "windows" };

describe("runClass: the device that ran it", () => {
  it("uses the saved device type first, then the mobile flag", () => {
    expect(runClass(result({ device: IPHONE }))).toBe("phone");
    expect(runClass(result({ device: IPAD, mobile: true }))).toBe("tablet");
    expect(runClass(result({ mobile: true }))).toBe("mobile");
    expect(runClass(result({ device: dev({}), mobile: true }))).toBe("mobile");
    expect(runClass(result({ device: DESK, mobile: false }))).toBe("desktop");
    expect(runClass(result({ mobile: false }))).toBe("desktop");
    expect(runClass(result({ device: dev({}) }))).toBe("unknown");
    expect(runClass(result())).toBe("unknown");
    expect(["phone", "tablet", "mobile"].every((c) => isHandheld(c as never))).toBe(true);
  });
});

describe("display rules table", () => {
  it("phone/tablet runs: never a submission status, Share when valid", () => {
    for (const r of [result({ device: IPHONE, mobile: true }), result({ device: IPAD, mobile: true }), result({ mobile: true }), result({ device: PIXEL, mobile: true, system: READY_SYS })]) {
      const s = submissionStatus(r);
      expect(s.kind).toBe("handheld");
      expect(JSON.stringify(s)).not.toMatch(/missing|incomplete|GPU|submit/i);
      expect(canShare(r)).toBe(true);
    }
  });

  it("desktop runs: ready, or a next step (never an error)", () => {
    expect(submissionStatus(result({ device: DESK, mobile: false, system: READY_SYS }))).toEqual({ kind: "ready", text: "Ready to submit" });
    const s = submissionStatus(result({ device: DESK, mobile: false }));
    expect(s.kind).toBe("next-step");
    expect(s.text).toBe("Add your system details to submit");
    expect(s.kind === "next-step" && s.missing).toEqual(["GPU", "OS"]);
  });

  it("unknown (old) runs: same calm wording as desktop", () => {
    expect(submissionStatus(result()).text).toBe("Add your system details to submit");
  });

  it("invalid runs: badge with the reason, no Share, any device", () => {
    for (const d of [IPHONE, DESK, undefined]) {
      const r = result({ device: d, valid: false, invalidReason: "Tab hidden during run" });
      expect(submissionStatus(r)).toEqual({ kind: "invalid", text: "Invalid: Tab hidden during run" });
      expect(canShare(r)).toBe(false);
    }
  });

  it("device line by the device that ran it", () => {
    expect(deviceLine(result({ device: IPHONE, mobile: true }))).toBe("📱 iPhone · Safari 27");
    expect(deviceLine(result({ device: IPAD, mobile: true }))).toBe("📱 iPad · Safari 18");
    expect(deviceLine(result({ device: PIXEL, mobile: true }))).toBe("📱 Android phone · Chrome 141");
    expect(deviceLine(result({ device: dev({ browser: "chrome", browserMajor: 141, os: "ios", deviceType: "phone", webkitEngine: true }) }))).toBe("📱 iPhone · Chrome 141 (WebKit)");
    expect(deviceLine(result({ mobile: true }))).toBe("📱 Phone");
    expect(deviceLine(result({ device: DESK, mobile: false }))).toBe("🖥 Edge 141 · Windows");
    expect(deviceLine(result({ device: dev({ browser: "firefox", browserMajor: 132 }) }))).toBe("Firefox 132");
    expect(deviceLine(result({ device: dev({}) }))).toBe("");
  });
});

describe("My Results filters and sort", () => {
  const list = [
    result({ id: "a", date: "2026-10-20", time: "09:00", avgFps: 50, resolutionId: "4K", resolution: "4K", preset: "Ultra", device: DESK, mobile: false }),
    result({ id: "b", date: "2026-10-22", time: "08:00", avgFps: 300, resolutionId: "720p", resolution: "720p", preset: "Low", device: IPHONE, mobile: true }),
    result({ id: "c", date: "2026-10-22", time: "21:00", avgFps: 120, device: IPAD, mobile: true }),
    result({ id: "d", date: "2026-03-01", time: "10:00", avgFps: 999, benchmarkVersion: "1.1.0" }),
  ];

  it("facets list only the values present, in a natural order", () => {
    expect(facetValues(list, "resolution")).toEqual(["720p", "1080p", "4K"]);
    expect(facetValues(list, "preset")).toEqual(["Low", "High", "Ultra"]);
    expect(facetValues(list, "version")).toEqual(["2.x", "1.x"]);
    expect(facetValues(list, "device")).toEqual(["Phone", "Tablet", "Desktop", "Unknown"]);
  });

  it("filters combine; sort by newest or highest FPS", () => {
    expect(filterRuns(list, { device: "Phone" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(list, { version: "2.x", resolution: "1080p" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterRuns(list, {}).length).toBe(4);
    expect(sortRuns(list, "newest").map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(sortRuns(list, "fps").map((r) => r.id)).toEqual(["d", "b", "c", "a"]);
    expect(mixesMajors(list)).toBe(true);
    expect(mixesMajors(filterRuns(list, { version: "2.x" }))).toBe(false);
  });

  it("stays fast with hundreds of results", () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      result({ id: `m${i}`, avgFps: (i * 37) % 500, date: `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`, device: i % 3 ? DESK : IPHONE }),
    );
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) sortRuns(filterRuns(many, { device: "Desktop" }), k % 2 ? "fps" : "newest");
    facetValues(many, "device");
    expect((performance.now() - t0) / 10).toBeLessThan(50);
  });
});
