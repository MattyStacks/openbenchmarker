import { describe, expect, it } from "vitest";
import { encode as qr } from "uqr";
import { BENCHMARK, GPU_CATALOG, NOT_LISTED } from "../src/benchmark/catalog";
import { GPU_TAG, crc8, decodeShare, encodeShare, fromBase64Url, sharedRunFrom, toBase64Url, type SharePayload, type SharedRun } from "../src/benchmark/share-codec";
import { emptySystem, type BenchResult, type SystemInfo } from "../src/benchmark/types";
import { compareRuns } from "../src/app/compare";
import { chosenGpuName, overclockLabel, shareText, sharerGpuRows } from "../src/app/share";

// Share links carry the sharer's catalog GPU and overclock details (extension tag 2), and nothing
// else typed into the results form.

const TODAY = new Date("2026-10-22T12:00:00Z");
const GPU = GPU_CATALOG[0];

function run(over: Partial<SharedRun> = {}): SharedRun {
  return {
    gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", resolution: "4K", width: 3840, height: 2160, preset: "Extreme", durationS: 60,
    scoreTest: "extreme", score: 14321, avgFps: 143.21, p1Low: 118.4, p5Low: 126, worstMs: 11.37, frameCount: 8600, timing: "gpu-timer",
    graphicsApi: "WebGL2", date: "2026-10-22",
    device: { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" },
    ...over,
  };
}

function result(system: Partial<SystemInfo> = {}): BenchResult {
  return {
    id: "t1", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", timing: "gpu-timer", date: "2026-10-22", time: "12:30",
    resolutionId: "4K", resolution: "4K", width: 3840, height: 2160, preset: "Extreme", durationS: 60, graphicsApi: "WebGL2",
    scoreTest: "extreme", score: 14321, avgFps: 143.21, p1Low: 118.4, p5Low: 126, worstMs: 11.37, frameCount: 8600, loopBusy: 0.97,
    valid: true, invalidReason: "", device: run().device, mobile: false,
    system: { ...emptySystem(), ...system },
  };
}

const OC = { overclocked: true, coreMhz: 150, memoryMhz: -500, powerPct: 110 };
const dec = (code: string) => decodeShare(code, TODAY);
const roundTrip = (p: SharePayload) => {
  const d = dec(encodeShare(p));
  if (!d.ok) throw new Error(`decode failed: ${d.reason}`);
  return d.payload;
};

describe("what a saved result puts in a link", () => {
  it("the catalog GPU and every overclock detail, when filled in", () => {
    const r = sharedRunFrom(result({ gpuId: GPU.id, overclocked: "yes", ocCoreMhz: "+150", ocMemoryMhz: "-500", ocPowerPct: "110" }));
    expect(r.gpuId).toBe(GPU.id);
    expect(r.overclock).toEqual(OC);
  });

  it("nothing else from the form: no CPU, memory, driver or OS details", () => {
    const r = sharedRunFrom(
      result({ gpuId: GPU.id, os: "linux", osDetail: "Fedora 41", cpu: "Ryzen 7", memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2", driver: "Mesa 24.2.5", distro: "Fedora", kernel: "6.11", mesa: "24.2.5" }),
    );
    const text = JSON.stringify(r);
    for (const v of ["Fedora", "Ryzen", "DDR5", "Mesa", "6.11"]) expect(text).not.toContain(v);
    expect(Object.keys(r).sort()).toEqual(Object.keys(sharedRunFrom(result())).concat("gpuId").sort());
  });

  it("left out when blank, not listed, not in the catalog, or not said", () => {
    for (const gpuId of ["", NOT_LISTED, "made_up_gpu"]) {
      const r = sharedRunFrom(result({ gpuId }));
      expect(r.gpuId).toBeUndefined();
      expect(r.overclock).toBeUndefined();
    }
  });

  it("overclock details only with overclocked yes; invalid values are dropped", () => {
    expect(sharedRunFrom(result({ overclocked: "no", ocCoreMhz: "150" })).overclock).toEqual({ overclocked: false });
    expect(sharedRunFrom(result({ overclocked: "", ocCoreMhz: "150" })).overclock).toBeUndefined();
    expect(sharedRunFrom(result({ overclocked: "yes", ocCoreMhz: "fast", ocMemoryMhz: "99999", ocPowerPct: "110" })).overclock).toEqual({ overclocked: true, powerPct: 110 });
  });

  it("a saved result's link round-trips them", () => {
    const r = sharedRunFrom(result({ gpuId: GPU.id, overclocked: "yes", ocCoreMhz: "150", ocMemoryMhz: "-500", ocPowerPct: "110" }));
    const back = roundTrip({ type: "result", runs: [r] }).runs[0];
    expect(back.gpuId).toBe(GPU.id);
    expect(back.overclock).toEqual(OC);
  });
});

describe("GPU entry (extension tag 2)", () => {
  it("round-trips every combination", () => {
    for (const extra of [
      { gpuId: GPU.id },
      { overclock: { overclocked: false } },
      { overclock: { overclocked: true } },
      { overclock: { overclocked: true, powerPct: 300 } },
      { gpuId: "rx_9070_xt_16gb", overclock: { overclocked: true, coreMhz: -3000, memoryMhz: 10000 } },
      { gpuId: GPU.id, overclock: OC },
    ]) {
      expect(roundTrip({ type: "result", runs: [run(extra)] }).runs[0]).toEqual(run(extra));
    }
  });

  it("works for invites, both runs of a comparison, and stress runs", () => {
    expect(roundTrip({ type: "challenge", runs: [run({ gpuId: GPU.id, overclock: OC })] }).runs[0]).toEqual(run({ gpuId: GPU.id, overclock: OC }));
    const b = run({ avgFps: 100, score: 10000, frameCount: 6000, p1Low: 80, p5Low: 90, worstMs: 12.6, overclock: { overclocked: false } });
    expect(roundTrip({ type: "comparison", runs: [run({ gpuId: GPU.id, overclock: OC }), b] }).runs).toEqual([run({ gpuId: GPU.id, overclock: OC }), b]);
    const laps = [152.1, 151.8, 150.2, 148.9, 147.5, 146.7];
    const stress = run({ durationS: 576, avgFps: 149.53, frameCount: 86129, stress: { test: "extreme", laps }, gpuId: GPU.id, overclock: OC });
    delete stress.scoreTest;
    delete stress.score;
    expect(roundTrip({ type: "result", runs: [stress] }).runs[0]).toEqual(stress);
  });

  it("is only added on top: a link without it is the same bytes, so older readers skip it", () => {
    const plain = Array.from(fromBase64Url(encodeShare({ type: "result", runs: [run()] }))!);
    const withGpu = Array.from(fromBase64Url(encodeShare({ type: "result", runs: [run({ gpuId: GPU.id, overclock: OC })] }))!);
    const body = plain.slice(0, -1);
    expect(withGpu.slice(0, body.length)).toEqual(body);
    expect(withGpu[body.length]).toBe(GPU_TAG);
    expect(withGpu[body.length + 1]).toBe(withGpu.length - body.length - 3);
    // An old reader keeps the entry as an unknown tag; re-encoding it gives the same link.
    const asUnknown = { type: "result" as const, runs: [run()], ext: [{ tag: 99, value: Uint8Array.from(withGpu.slice(body.length + 2, -1)) }] };
    expect(dec(encodeShare(asUnknown)).ok).toBe(true);
  });

  it("links without it decode with no GPU or overclock", () => {
    const d = dec(encodeShare({ type: "result", runs: [run()] }));
    expect(d.ok && d.payload.runs[0].gpuId).toBeUndefined();
    expect(d.ok && d.payload.runs[0].overclock).toBeUndefined();
  });

  it("a malformed entry reads as damaged", () => {
    const base = Array.from(fromBase64Url(encodeShare({ type: "result", runs: [run()] }))!).slice(0, -1);
    const link = (...entries: number[][]) => {
      const body = base.concat(...entries.map((v) => [GPU_TAG, v.length, ...v]));
      return toBase64Url([...body, crc8(body)]);
    };
    // The packed id, as the encoder writes it after the head byte.
    const id = Array.from(fromBase64Url(encodeShare({ type: "result", runs: [run({ gpuId: GPU.id })] }))!).slice(base.length + 3, -1);
    for (const bad of [
      [], // nothing in it
      [0x00], // no GPU and nothing said
      [0x03, ...id], // overclocked state 3
      [0x20, ...id], // reserved bit
      [0x05, 0, 150, ...id], // details with overclocked no
      [0x06, 0], // offset cut short
      [0x80, ...id], // run 1 in a one-run link
      [0x00, 0xa3], // a 6-bit code past the id alphabet
      [0x00, ...id, 0xff], // padding that isn't the end
      [0x00, 0x00, 0x00], // padding bits that aren't 1s (4 × "a")
    ])
      expect(dec(link(bad))).toEqual({ ok: false, reason: "damaged" });
    expect(dec(link([0x00, ...id])).ok).toBe(true);
    expect(dec(link([0x00, ...id], [0x01]))).toEqual({ ok: false, reason: "damaged" }); // twice for one run
  });

  it("packs ids of every length canonically", () => {
    for (let n = 1; n <= 63; n++) {
      const gpuId = "a1_.-z9".repeat(10).slice(0, n).replace(/^[_.-]/, "x");
      expect(roundTrip({ type: "result", runs: [run({ gpuId })] }).runs[0].gpuId).toBe(gpuId);
    }
  });

  it("the encoder won't take tag 2 as a raw entry", () => {
    expect(() => encodeShare({ type: "result", runs: [run()], ext: [{ tag: GPU_TAG, value: Uint8Array.from([1]) }] })).toThrow();
  });

  it("keeps a result link at a small QR code", () => {
    const url = (o: Partial<SharedRun>) => `https://opengpubenchmarker.com/#/r/${encodeShare({ type: "result", runs: [run(o)] })}`;
    const v = (u: string) => qr(u, { ecc: "M", border: 4 }).version;
    const cases = {
      plain: url({}),
      gpu: url({ gpuId: GPU.id, overclock: { overclocked: false } }),
      gpuOc: url({ gpuId: GPU.id, overclock: OC }),
      longest: url({ device: { ...run().device, gpuLabel: "NVIDIA GeForce RTX 5090 Laptop GPU" }, gpuId: "rtx_5090_laptop_24gb_oem", overclock: OC }),
      comparison: `https://opengpubenchmarker.com/#/r/${encodeShare({ type: "comparison", runs: [run({ gpuId: GPU.id, overclock: OC }), run({ avgFps: 99.5, p1Low: 80, p5Low: 90, worstMs: 13, frameCount: 5980, score: 9950, gpuId: GPU.id, overclock: OC })] })}`,
    };
    console.log("link length / QR version with GPU entry (ECC M):", JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, u]) => [k, [u.length, v(u)]]))));
    expect(v(cases.gpu)).toBeLessThanOrEqual(7);
    expect(v(cases.gpuOc)).toBeLessThanOrEqual(8);
    expect(v(cases.longest)).toBeLessThanOrEqual(8);
    expect(v(cases.comparison)).toBeLessThanOrEqual(11);
  });
});

describe("showing them", () => {
  it("names the catalog GPU, or its id when this catalog doesn't list it", () => {
    expect(chosenGpuName(run({ gpuId: GPU.id }))).toBe(GPU.name);
    expect(chosenGpuName(run({ gpuId: "rx_9070_xt_16gb" }))).toBe("rx_9070_xt_16gb");
    expect(chosenGpuName(run())).toBe("");
  });

  it("describes the overclock", () => {
    expect(overclockLabel(undefined)).toBe("");
    expect(overclockLabel({ overclocked: false })).toBe("No, stock clocks");
    expect(overclockLabel({ overclocked: true })).toBe("Yes");
    expect(overclockLabel(OC)).toBe("Yes: core +150 MHz, memory -500 MHz, power limit 110%");
  });

  it("adds rows to the shared view and compare columns, escaped", () => {
    expect(sharerGpuRows(run())).toBe("");
    const rows = sharerGpuRows(run({ gpuId: "x<y", overclock: OC }));
    expect(rows).toContain("x&lt;y");
    expect(rows).toContain("Overclocked</dt><dd>Yes: core +150 MHz");
  });

  it("the share text names the GPU and says when it was overclocked", () => {
    expect(shareText(run({ gpuId: GPU.id, overclock: OC }))).toContain(`on ${GPU.name} (overclocked).`);
    expect(shareText(run({ overclock: { overclocked: false } }))).toContain("on NVIDIA GeForce RTX 5080. Measured");
  });

  it("a comparison notes a different overclock, only when both runs said", () => {
    const a = run({ overclock: OC });
    expect(compareRuns(a, run({ overclock: { overclocked: false } })).notes).toContain("Overclock differs. Your run: No, stock clocks. The shared run: Yes: core +150 MHz, memory -500 MHz, power limit 110%.");
    expect(compareRuns(a, run()).notes.some((n) => n.startsWith("Overclock"))).toBe(false);
    expect(compareRuns(a, run({ overclock: OC })).notes.some((n) => n.startsWith("Overclock"))).toBe(false);
  });
});
