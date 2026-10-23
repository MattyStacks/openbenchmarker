import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BENCHMARK } from "../src/benchmark/catalog";
import type { SharedRun, SharePayload } from "../src/benchmark/share-codec";
import { payloadUrl, sharePayload, shareRun } from "../src/app/share";

// Every Share button in the site goes through sharePayload. These tests make sure a share always
// carries the LINK, and never attaches a file (attached images made apps drop the link).

const run = (avgFps = 143.21): SharedRun => ({
  gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", resolution: "720p", width: 1280, height: 720, preset: "Low", durationS: 30,
  avgFps, p1Low: 110, p5Low: 120, worstMs: 14, frameCount: Math.round(avgFps * 30), timing: "gpu-timer", graphicsApi: "WebGL2", date: "2026-10-22",
  device: { browser: "brave", browserMajor: null, os: "ios", deviceType: "tablet", webkitEngine: true, gpuLabel: "Apple GPU" },
});
const PAYLOADS: SharePayload[] = [
  { type: "result", runs: [run()] },
  { type: "challenge", runs: [run()] },
  { type: "comparison", runs: [run(), run(4716.3)] },
];

let shared: ShareData[] = [];
let copied: string[] = [];
function stubBrowser(opts: { share?: "ok" | "abort" | "fail" | "none" } = {}) {
  shared = [];
  copied = [];
  vi.stubGlobal("location", { origin: "https://share-results.opengpubenchmarker.com" });
  vi.stubGlobal("navigator", {
    canShare: () => true,
    clipboard: { writeText: async (t: string) => void copied.push(t) },
    ...(opts.share === "none"
      ? {}
      : {
          share: async (d: ShareData) => {
            shared.push(d);
            if (opts.share === "abort") throw Object.assign(new Error("cancel"), { name: "AbortError" });
            if (opts.share === "fail") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
          },
        }),
  });
}
beforeEach(() => stubBrowser());
afterEach(() => vi.unstubAllGlobals());

describe("every share keeps the link", () => {
  it("result, invite and comparison shares all pass the link as url, with no file attached", async () => {
    for (const p of PAYLOADS) {
      stubBrowser();
      const { url, done } = sharePayload(p);
      expect(await done).toBe("shared");
      expect(shared).toHaveLength(1);
      expect(shared[0].url).toBe(url);
      expect(url).toBe(payloadUrl(p));
      expect(url).toMatch(/^https:\/\/share-results\.opengpubenchmarker\.com\/#\/r\/[A-Za-z0-9_-]+$/);
      expect(shared[0].files).toBeUndefined();
      expect(shared[0].text).toBeTruthy();
    }
  });

  it("shareRun (My Results cards and table rows) keeps the link too", async () => {
    const { url, done } = shareRun(run());
    await done;
    expect(shared[0].url).toBe(url);
    expect(shared[0].files).toBeUndefined();
  });

  it("no share sheet, or a share that fails: text and link go to the clipboard", async () => {
    for (const mode of ["none", "fail"] as const) {
      stubBrowser({ share: mode });
      const { url, done } = sharePayload(PAYLOADS[0]);
      expect(await done).toBe("copied");
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain(url);
    }
  });

  it("cancelling the share sheet copies nothing and says nothing", async () => {
    stubBrowser({ share: "abort" });
    expect(await sharePayload(PAYLOADS[0]).done).toBe("cancelled");
    expect(copied).toHaveLength(0);
  });
});

describe("source guard: only sharePayload talks to the share sheet", () => {
  // Every source file's text, bundled by Vite at test time (no Node file APIs needed).
  const src = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("navigator.share is called in exactly one place, src/app/share.ts", () => {
    const callers = Object.entries(src).filter(([, text]) => /navigator\.share\s*\(/.test(text)).map(([f]) => f);
    expect(callers).toEqual(["../src/app/share.ts"]);
    const shareTs = src["../src/app/share.ts"];
    expect(shareTs.match(/navigator\.share\s*\(/g)).toHaveLength(1);
    expect(shareTs).toMatch(/navigator\.share\(\{ title, text, url \}\)/);
  });

  it("no share passes files (an attached image drops the link in some apps)", () => {
    expect(Object.keys(src).length).toBeGreaterThan(20);
    for (const text of Object.values(src)) expect(text).not.toMatch(/share\(\{[^}]*files/);
  });
});
