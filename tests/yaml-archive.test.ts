import { describe, expect, it } from "vitest";
import { BENCHMARK, NOT_LISTED } from "../src/benchmark/catalog";
import { toDraftYaml, toYaml } from "../src/benchmark/exporter";
import { emptySystem, type BenchResult, type SystemInfo } from "../src/benchmark/types";
import { archiveEntries, yamlArchive } from "../src/benchmark/yaml-archive";
import { crc32, zip } from "../src/benchmark/zip";

const GPU = "rtx_5080_16gb_fe";
let n = 0;
function result(sys: Partial<SystemInfo> = {}, over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: `r${++n}`,
    gameId: BENCHMARK.gameId,
    benchmarkVersion: "4.0.0",
    timing: "gpu-timer",
    date: "2026-11-09",
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
    device: { browser: "chrome", browserMajor: 141, os: "linux", deviceType: "desktop", webkitEngine: false, gpuLabel: null },
    system: { ...emptySystem(), ...sys },
    ...over,
  };
}
const ready = (over: Partial<BenchResult> = {}) => result({ gpuId: GPU, os: "linux", cpu: "AMD Custom CPU 1772" }, over);

/** Reads back a stored zip: each local header's name and data, checking its CRC. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out: Record<string, string> = {};
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const crc = v.getUint32(at + 14, true);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(crc32(data), name).toBe(crc);
    out[name] = dec.decode(data);
    at += 30 + nameLen + size;
  }
  // The central directory follows, then the end record with the file count.
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  expect(v.getUint16(end + 10, true)).toBe(Object.keys(out).length);
  expect(v.getUint32(end + 16, true)).toBe(at);
  return out;
}

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores files that read back intact, with UTF-8 names", () => {
    const files = unzip(zip([{ path: "a/b.yaml", data: "gpu_id: x\n" }, { path: "ü.txt", data: "→ ok" }]));
    expect(files).toEqual({ "a/b.yaml": "gpu_id: x\n", "ü.txt": "→ ok" });
  });
});

describe("download all as YAML", () => {
  it("puts ready results in the upstream layout, numbering repeats, oldest first", () => {
    const e = archiveEntries([ready({ time: "13:00" }), ready({ time: "12:00" }), ready({ date: "2026-11-08" })]);
    const name = `result_20261109_${BENCHMARK.gameId}`;
    expect(e.map((x) => x.path)).toEqual([
      `data/community/${GPU}/result_20261108_${BENCHMARK.gameId}.yaml`,
      `data/community/${GPU}/${name}.yaml`,
      `data/community/${GPU}/${name}_2.yaml`,
    ]);
    expect(e[1].result.time).toBe("12:00");
    expect(e[0].yaml).toBe(toYaml(e[0].result));
    expect(e.every((x) => x.status === "ready")).toBe(true);
  });

  it("keeps results that aren't ready, in not-ready/, saying what they need; leaves out invalid runs", () => {
    const e = archiveEntries([
      result({ os: "linux" }),
      ready({ stressTest: "extreme" }),
      result({ gpuId: NOT_LISTED, gpuName: "Radeon RX 9070 XT", gpuIdRequested: "rx_9070_xt_16gb", os: "windows" }),
      result({}, { device: { browser: "safari", browserMajor: 26, os: "ios", deviceType: "phone", webkitEngine: true, gpuLabel: null } }),
      ready({ valid: false, invalidReason: "tab hidden" }),
    ]);
    expect(e.map((x) => [x.path.split("/").slice(0, 2).join("/"), x.status])).toEqual([
      ["not-ready/no-gpu-chosen", "not-ready"],
      [`not-ready/${GPU}`, "not-ready"],
      ["not-ready/rx_9070_xt_16gb", "gpu-not-in-catalog"],
      ["not-ready/no-gpu-chosen", "not-ready"],
    ]);
    expect(e[0].note).toMatch(/^still needs GPU/);
    expect(e[0].yaml).toMatch(/^# Not ready to submit: it still needs GPU/m);
    expect(e[0].yaml).toMatch(/^gpu_id: ""$/m);
    expect(e[0].yaml).toMatch(/^ {2}os: linux$/m);
    // An unlisted GPU's file is a full submission, once the GPU is in the catalog.
    expect(e[2].yaml).toMatch(/^gpu_id: rx_9070_xt_16gb$/m);
    expect(e[3].note).toMatch(/phone/);
  });

  it("can keep only the ready ones", () => {
    const e = archiveEntries([ready(), result({ os: "linux" })], { readyOnly: true });
    expect(e.map((x) => x.status)).toEqual(["ready"]);
  });

  it("zips them with a README listing every file", () => {
    const a = yamlArchive([ready(), result({ os: "linux" }), ready({ valid: false })], { now: new Date(2026, 10, 9, 15, 4) });
    expect(a.fileName).toBe("openbenchmarker_results_20261109.zip");
    const files = unzip(a.bytes);
    expect(Object.keys(files)).toEqual([...a.entries.map((e) => e.path), "README.txt"]);
    expect(files["README.txt"]).toContain("2 files, 1 ready to submit. 1 invalid run was left out.");
    expect(files["README.txt"]).toContain(`data/community/${GPU}/`);
    expect(files[a.entries[0].path]).toBe(a.entries[0].yaml);
  });
});

describe("the YAML draft", () => {
  it("is the submission itself when the result is ready", () => {
    expect(toDraftYaml(ready())).toBe(toYaml(ready({ id: "same" })));
  });

  it("says why an invalid run can't be submitted", () => {
    expect(toDraftYaml(ready({ valid: false, invalidReason: "tab hidden" }))).toMatch(/^# Not ready to submit: the run was invalid \(tab hidden\)\./m);
  });
});
