import { describe, expect, it } from "vitest";
import { encode as qr } from "uqr";
import { BENCHMARK } from "../src/benchmark/catalog";
import {
  crc8,
  decodeShare,
  encodeShare,
  extractShareCode,
  fromBase64Url,
  plausible,
  shareBlocker,
  sharedRunFrom,
  toBase64Url,
  type SharePayload,
  type SharedRun,
} from "../src/benchmark/share-codec";
import { emptySystem, type BenchResult } from "../src/benchmark/types";

const TODAY = new Date("2026-10-22T12:00:00Z");
const SITE = "https://opengpubenchmarker.com/#/r/";

function run(over: Partial<SharedRun> = {}): SharedRun {
  return {
    gameId: BENCHMARK.gameId,
    benchmarkVersion: "2.2.0",
    resolution: "4K",
    width: 3840,
    height: 2160,
    preset: "Extreme",
    durationS: 60,
    scoreTest: "extreme",
    score: 14321,
    avgFps: 143.21,
    p1Low: 118.4,
    p5Low: 126,
    worstMs: 11.37,
    frameCount: 8600,
    timing: "gpu-timer",
    graphicsApi: "WebGL2",
    date: "2026-10-22",
    device: { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" },
    ...over,
  };
}

const roundTrip = (r: SharedRun) => {
  const d = decodeShare(encodeShare({ type: "result", runs: [r] }), TODAY);
  if (!d.ok) throw new Error(`decode failed: ${d.reason}`);
  return d.payload.runs[0];
};

describe("share codec v1 round-trip", () => {
  it("carries every field exactly", () => {
    expect(roundTrip(run())).toEqual(run());
  });

  it("keeps optional fields absent and handles unknown device/GPU", () => {
    const r = run({ scoreTest: undefined, score: undefined, timing: undefined, device: { browser: "other", browserMajor: null, os: "other", deviceType: "unknown", webkitEngine: false, gpuLabel: null } });
    delete r.scoreTest;
    delete r.score;
    delete r.timing;
    expect(roundTrip(r)).toEqual(r);
  });

  it("phone run with WebKit flag, Unicode GPU label and 720p Low", () => {
    const r = run({
      resolution: "720p", width: 1280, height: 720, preset: "Low", durationS: 30, scoreTest: undefined, score: undefined,
      avgFps: 58.27, p1Low: 41.2, p5Low: 47.9, worstMs: 31.25, frameCount: 1749, timing: "batch-avg", graphicsApi: "WebGL1",
      device: { browser: "chrome", browserMajor: 141, os: "ios", deviceType: "phone", webkitEngine: true, gpuLabel: "Apple GPU ✓ ü" },
    });
    delete r.scoreTest;
    delete r.score;
    expect(roundTrip(r)).toEqual(r);
  });

  it("rounds to the link's precision (0.01 FPS avg, 0.1 FPS lows, 0.01 ms worst)", () => {
    const back = roundTrip(run({ avgFps: 143.2149, p1Low: 118.44, p5Low: 126.04, worstMs: 11.374, score: 14321, frameCount: 8593 }));
    expect(back).toMatchObject({ avgFps: 143.21, p1Low: 118.4, p5Low: 126, worstMs: 11.37 });
  });

  it("caps a long GPU label at 63 UTF-8 bytes without splitting a character", () => {
    const back = roundTrip(run({ device: { ...run().device, gpuLabel: "é".repeat(40) } }));
    expect(back.device.gpuLabel).toBe("é".repeat(31));
  });

  it("comparison links carry two runs; challenge one", () => {
    const a = run();
    const b = run({ avgFps: 99.5, p1Low: 80, p5Low: 90, worstMs: 13, frameCount: 5980, score: 9950 });
    const c = decodeShare(encodeShare({ type: "comparison", runs: [a, b] }), TODAY);
    expect(c.ok && c.payload).toEqual({ type: "comparison", runs: [a, b] });
    const ch = decodeShare(encodeShare({ type: "challenge", runs: [a] }), TODAY);
    expect(ch.ok && ch.payload.type).toBe("challenge");
    expect(() => encodeShare({ type: "comparison", runs: [a] })).toThrow();
  });

  it("maps a saved BenchResult without system, diag or id", () => {
    const br: BenchResult = {
      id: "secret-id", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", date: "2026-10-22", time: "12:30", resolutionId: "4K", resolution: "4K",
      width: 3840, height: 2160, preset: "Extreme", durationS: 60, graphicsApi: "WebGL2", avgFps: 143.21, p1Low: 118.4, p5Low: 126, worstMs: 11.37,
      frameCount: 8600, loopBusy: 0.97, timing: "gpu-timer", valid: true, invalidReason: "", scoreTest: "extreme", score: 14321,
      device: run().device, system: { ...emptySystem(), cpu: "my private CPU", gpuId: "nvidia-rtx-5080" },
    };
    const s = sharedRunFrom(br);
    expect(JSON.stringify(s)).not.toMatch(/secret-id|private CPU|nvidia-rtx-5080|loopBusy|12:30/);
    const { valid, ...rest } = s;
    expect(valid).toBe(true);
    expect(roundTrip(rest)).toEqual(run());
  });
});

describe("only shareable runs encode", () => {
  it("blocks invalid, non-standard and unknown runs", () => {
    expect(shareBlocker({ ...run(), valid: false })).toMatch(/valid/);
    expect(shareBlocker(run({ width: 2560, height: 1080 }))).toMatch(/720p/);
    expect(shareBlocker(run({ durationS: 45 }))).toMatch(/length/);
    expect(shareBlocker(run({ benchmarkVersion: "2.2" }))).toMatch(/version/);
    expect(shareBlocker(run({ gameId: "other" }))).toMatch(/benchmark/);
    expect(shareBlocker(run())).toBeNull();
    expect(() => encodeShare({ type: "result", runs: [run({ durationS: 45 })] })).toThrow();
  });
});

describe("damaged links", () => {
  const good = encodeShare({ type: "result", runs: [run()] });

  it("rejects garbage", () => {
    for (const s of ["", "!!!", "a", "####", "AAAA", "x".repeat(200), "%E2%9C%93"]) expect(decodeShare(s, TODAY).ok).toBe(false);
  });

  it("rejects every truncation", () => {
    for (let n = 0; n < good.length; n++) expect(decodeShare(good.slice(0, n), TODAY).ok).toBe(false);
  });

  it("rejects every single-character edit (CRC-8 catches all of them)", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let caught = 0, total = 0;
    for (let i = 0; i < good.length; i++)
      for (const ch of "AZaz09-_") {
        if (good[i] === ch) continue;
        total++;
        const edited = good.slice(0, i) + ch + good.slice(i + 1);
        if (!decodeShare(edited, TODAY).ok) caught++;
        expect(alphabet.includes(ch)).toBe(true);
      }
    // A single base64 character covers 6 bits within one or two bytes: CRC-8 detects every error
    // burst of 8 bits or less, and the canonical check rejects edits to the last character's spare bits.
    expect(caught).toBe(total);
  });

  it("the score is derived from the average, never stored, so it can't be edited separately", () => {
    const back = decodeShare(encodeShare({ type: "result", runs: [run({ score: 99999 })] }), TODAY);
    expect(back.ok && back.payload.runs[0].score).toBe(14321);
  });

  it("reports links from a newer schema separately", () => {
    const bytes = Array.from(fromBase64Url(good)!);
    bytes[0] = 2;
    bytes[bytes.length - 1] = crc8(bytes.slice(0, -1));
    expect(decodeShare(toBase64Url(bytes), TODAY)).toEqual({ ok: false, reason: "newer-version" });
    bytes[0] = 0;
    bytes[bytes.length - 1] = crc8(bytes.slice(0, -1));
    expect(decodeShare(toBase64Url(bytes), TODAY)).toEqual({ ok: false, reason: "damaged" });
  });

  it("an edit with a recomputed CRC still fails the plausibility checks", () => {
    const edit = (r: SharedRun) => decodeShare(encodeShare({ type: "result", runs: [r] }), TODAY).ok;
    // encodeShare doesn't check plausibility, so these model someone re-encoding edited numbers.
    expect(edit(run({ p1Low: 150 }))).toBe(false); // 1% low above average
    expect(edit(run({ p5Low: 110 }))).toBe(false); // 5% low below 1% low
    expect(edit(run({ worstMs: 5 }))).toBe(false); // worst frame faster than the 1% low
    expect(edit(run({ frameCount: 20000 }))).toBe(false); // too many frames for 60 s at 143 FPS
    expect(edit(run({ frameCount: 8000 }))).toBe(false); // too few
    expect(edit(run({ date: "2027-01-01" }))).toBe(false); // in the future
    expect(edit(run({ date: "2023-06-01" }))).toBe(false); // before the site existed
  });
});

describe("plausibility tolerances", () => {
  it("accepts the run-loop overshoot: up to three queued frames plus slack", () => {
    // A slow phone at 5 FPS for 30 s: wall-clock can end ~4 frames (0.8 s) past 30 s.
    expect(plausible(run({ durationS: 30, avgFps: 5, p1Low: 3.1, p5Low: 3.9, worstMs: 330, frameCount: 154, score: undefined, scoreTest: undefined }), TODAY)).toBe(true);
    expect(plausible(run({ frameCount: 8593 }), TODAY)).toBe(true); // exactly 60 s
    expect(plausible(run({ frameCount: 8900 }), TODAY)).toBe(true); // 62.1 s
    expect(plausible(run({ frameCount: 9300 }), TODAY)).toBe(false); // 64.9 s
  });

  it("allows tomorrow (local vs UTC date) but not later", () => {
    expect(plausible(run({ date: "2026-10-23" }), TODAY)).toBe(true);
    expect(plausible(run({ date: "2026-10-24" }), TODAY)).toBe(false);
  });
});

describe("link length and QR size", () => {
  it("stays small enough for a low QR version", () => {
    const withGpu = SITE + encodeShare({ type: "result", runs: [run()] });
    const noGpu = SITE + encodeShare({ type: "result", runs: [run({ device: { ...run().device, gpuLabel: null } })] });
    const longGpu = SITE + encodeShare({ type: "result", runs: [run({ device: { ...run().device, gpuLabel: "NVIDIA GeForce RTX 5090 Laptop GPU" } })] });
    const cmp = SITE + encodeShare({ type: "comparison", runs: [run(), run({ avgFps: 99.5, p1Low: 80, p5Low: 90, worstMs: 13, frameCount: 5980, score: 9950 })] });
    const v = (u: string) => qr(u, { ecc: "M", border: 4 }).version;
    const report = { noGpu: [noGpu.length, v(noGpu)], withGpu: [withGpu.length, v(withGpu)], longGpu: [longGpu.length, v(longGpu)], comparison: [cmp.length, v(cmp)] };
    console.log("link length / QR version (ECC M):", JSON.stringify(report));
    expect(noGpu.length).toBeLessThan(80);
    expect(v(withGpu)).toBeLessThanOrEqual(6);
    expect(v(cmp)).toBeLessThanOrEqual(10);
  });
});

describe("share codes (just the end of the link)", () => {
  const code = encodeShare({ type: "result", runs: [run()] });

  it("finds the code in anything someone might paste", () => {
    for (const pasted of [
      code,
      `  ${code}\n`,
      `${code.slice(0, 20)}\n${code.slice(20)}`, // chat app wrapped it
      `#/r/${code}`,
      `https://opengpubenchmarker.com/#/r/${code}`,
      `https://share-results.opengpubenchmarker.com/#/r/${code}.`,
      `http://192.168.1.20:5173/#/r/${code}`,
      `<https://opengpubenchmarker.com/#/r/${code}>`,
      `"${code}"`,
    ])
      expect(extractShareCode(pasted)).toBe(code);
    expect(decodeShare(extractShareCode(`  ${code.slice(0, 20)}\n${code.slice(20)} `), TODAY).ok).toBe(true);
  });

  it("junk gives nothing usable", () => {
    expect(extractShareCode("")).toBe("");
    expect(extractShareCode("   ")).toBe("");
    expect(decodeShare(extractShareCode("hello there"), TODAY).ok).toBe(false);
    expect(decodeShare(extractShareCode("https://example.com/page"), TODAY).ok).toBe(false);
  });
});

describe("invite and comparison links", () => {
  const long = (g: string) => run({ device: { ...run().device, gpuLabel: g } });
  it("keep their order and stay scannable with long GPU names", () => {
    const a = long("NVIDIA GeForce RTX 5090 Laptop GPU Extr");
    const b = { ...long("AMD Radeon RX 9070 XT"), avgFps: 99.5, p1Low: 80, p5Low: 90, worstMs: 13, frameCount: 5980, score: 9950 };
    const cmp = encodeShare({ type: "comparison", runs: [a, b] });
    const d = decodeShare(cmp, TODAY);
    expect(d.ok && d.payload.runs.map((r) => r.device.gpuLabel)).toEqual([a.device.gpuLabel, b.device.gpuLabel]);
    const inviteUrl = SITE + encodeShare({ type: "challenge", runs: [a] });
    const cmpUrl = SITE + cmp;
    const v = (u: string) => qr(u, { ecc: "M", border: 4 }).version;
    console.log("invite / comparison link length, QR version (ECC M):", JSON.stringify({ invite: [inviteUrl.length, v(inviteUrl)], comparison: [cmpUrl.length, v(cmpUrl)] }));
    expect(v(cmpUrl)).toBeLessThanOrEqual(10);
  });
});

// Codes made by the encoder before the extension section existed (Plan 7). They must keep
// decoding to exactly these runs and re-encode to the same string, forever.
describe("links made before the extension section", () => {
  const PHONE_RUN = run({
    resolution: "1080p", width: 1920, height: 1080, preset: "High", durationS: 30, avgFps: 41.37, p1Low: 30.2, p5Low: 33.9, worstMs: 40.12,
    frameCount: 1242, timing: "batch-avg", date: "2026-10-21",
    device: { browser: "safari", browserMajor: 26, os: "ios", deviceType: "phone", webkitEngine: true, gpuLabel: "Apple GPU" },
  });
  delete PHONE_RUN.scoreTest;
  delete PHONE_RUN.score;
  const BARE_RUN: SharedRun = { ...PHONE_RUN, device: { browser: "other", browserMajor: null, os: "other", deviceType: "unknown", webkitEngine: false, gpuLabel: null } };
  delete BARE_RUN.timing;
  const PINNED: [string, SharePayload][] = [
    ["AQACCAcaAG_iAJQACdgAjiAEMwlEMIjTl05WSURJQSBHZUZvcmNlIFJUWCA1MDgwCQ", { type: "result", runs: [run()] }],
    ["AUACCAKAACBSACXAAqYB9YAAm1FELUGsyUFwcGxlIEdQVbo", { type: "challenge", runs: [PHONE_RUN] }],
    ["AYACCAcaAG_iAJQACdgAjiAEMwlEMIjTl05WSURJQSBHZUZvcmNlIFJUWCA1MDgwAggCgAAgUgAlwAKmAfWAAJtRRC1BrMlBcHBsZSBHUFXP", { type: "comparison", runs: [run(), PHONE_RUN] }],
    ["AQACCAKAACBSACXAAqYB9YAAm0FELAAAAAg", { type: "result", runs: [BARE_RUN] }],
  ];

  it("decode identically and re-encode to the same code", () => {
    for (const [code, payload] of PINNED) {
      const d = decodeShare(code, TODAY);
      expect(d).toEqual({ ok: true, payload });
      expect(encodeShare(payload)).toBe(code);
    }
  });
});

describe("extension section", () => {
  const bytesOf = (code: string) => Array.from(fromBase64Url(code)!);
  /** A pinned code with extra entries spliced in before its CRC, CRC recomputed. */
  const withEntries = (code: string, extra: number[]) => {
    const body = bytesOf(code).slice(0, -1).concat(extra);
    return toBase64Url([...body, crc8(body)]);
  };
  const BASE = encodeShare({ type: "result", runs: [run()] });

  it("unknown entries are skipped by the reader and carried through", () => {
    const code = withEntries(BASE, [42, 3, 1, 2, 3, 7, 0]);
    const d = decodeShare(code, TODAY);
    expect(d.ok && d.payload.runs[0]).toEqual(run());
    expect(d.ok && d.payload.ext).toEqual([{ tag: 42, value: Uint8Array.from([1, 2, 3]) }, { tag: 7, value: new Uint8Array(0) }]);
    expect(d.ok && encodeShare(d.payload)).toBe(code);
  });

  it("works after a comparison's second run too", () => {
    const code = encodeShare({ type: "comparison", runs: [run(), run({ avgFps: 100, score: 10000, frameCount: 6000, p1Low: 80, p5Low: 90, worstMs: 12.6 })], ext: [{ tag: 9, value: Uint8Array.from([4]) }] });
    const d = decodeShare(code, TODAY);
    expect(d.ok && d.payload.runs.length).toBe(2);
    expect(d.ok && d.payload.ext?.[0].tag).toBe(9);
  });

  it("a truncated entry, tag 0 or a stray zero byte reads as damaged", () => {
    for (const extra of [[42], [42, 5, 1, 2], [0, 0], [0]]) expect(decodeShare(withEntries(BASE, extra), TODAY)).toEqual({ ok: false, reason: "damaged" });
  });

  it("the encoder refuses bad entries", () => {
    expect(() => encodeShare({ type: "result", runs: [run()], ext: [{ tag: 0, value: new Uint8Array(0) }] })).toThrow();
    expect(() => encodeShare({ type: "result", runs: [run()], ext: [{ tag: 1, value: new Uint8Array(256) }] })).toThrow();
  });
});
