import { describe, expect, it } from "vitest";
import { BENCHMARK, GPU_CATALOG } from "../src/benchmark/catalog";
import { toCsv, toJson, toYaml } from "../src/benchmark/exporter";
import { SYSTEM_FIELDS, completeSystem, emptySystem, NEW_RUN_SYSTEM } from "../src/benchmark/fields";
import type { BenchResult, DeviceContext } from "../src/benchmark/types";
import { validateSubmission } from "../src/benchmark/validate";
import { withSystem } from "../src/app/store";
import { csvCells } from "./csv";

const GPU = GPU_CATALOG[0].id;
const DESK: DeviceContext = { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" };
const PHONE: DeviceContext = { browser: "safari", browserMajor: 26, os: "ios", deviceType: "phone", webkitEngine: true, gpuLabel: "Apple GPU" };
const TABLET: DeviceContext = { ...PHONE, deviceType: "tablet" };

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "t1", gameId: BENCHMARK.gameId, benchmarkVersion: "2.2.0", timing: "gpu-timer", date: "2026-10-19", time: "12:30",
    resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "Ultra", durationS: 60, graphicsApi: "WebGL2",
    avgFps: 143.21, p1Low: 101.04, p5Low: 118.5, worstMs: 14.2, frameCount: 8592, loopBusy: 0.97, valid: true, invalidReason: "",
    device: DESK, mobile: false, system: emptySystem(), ...over,
  };
}
const ready = (sys: Partial<BenchResult["system"]> = {}, over: Partial<BenchResult> = {}) =>
  result({ ...over, system: { ...emptySystem(), gpuId: GPU, os: "windows", ...sys } });
const csvRow = (r: BenchResult) => {
  const [head, row] = toCsv([r]).trim().split("\n").map(csvCells);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
};

describe("field registry", () => {
  it("covers every SystemInfo key exactly once", () => {
    const keys = SYSTEM_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(emptySystem()).sort()).toEqual([...keys].sort());
  });

  it("system: fields follow upstream order (memory_gb, memory_type, memory_channels)", () => {
    const y = SYSTEM_FIELDS.filter((f) => f.section === "system").map((f) => f.yaml);
    expect(y.slice(0, 7)).toEqual(["os", "os_detail", "cpu", "memory_gb", "memory_type", "memory_channels", "driver"]);
  });
});

describe("memory_channels", () => {
  it("accepts a whole number from 1 to 32, like upstream checks.py", () => {
    for (const v of ["1", "2", "4", "8", "32", ""]) expect(validateSubmission(ready({ memoryChannels: v }))).toEqual([]);
    for (const v of ["0", "33", "dual", "2.5", "-2"]) expect(validateSubmission(ready({ memoryChannels: v }))[0]).toMatch(/^Memory channels:/);
  });

  it("goes into the YAML unquoted, after memory_type; omitted when blank", () => {
    const y = toYaml(ready({ memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2" }));
    expect(y).toMatch(/^ {2}memory_gb: 32\n {2}memory_type: "DDR5-6000"\n {2}memory_channels: 2$/m);
    expect(toYaml(ready())).not.toMatch(/memory_channels/);
  });

  it("a suggested value is submitted, with a comment saying it's assumed", () => {
    const y = toYaml(ready({ memoryChannels: "4" }, { suggested: ["memoryChannels"] }));
    expect(y).toMatch(/^ {2}memory_channels: 4 # assumed, not confirmed$/m);
  });

  it("is a CSV column, with suggested_fields naming suggested values", () => {
    expect(csvRow(ready({ memoryChannels: "2" }))).toMatchObject({ memory_channels: "2", suggested_fields: "" });
    expect(csvRow(result({ system: { ...emptySystem(), memoryChannels: "4" }, suggested: ["memoryChannels"] }))).toMatchObject({ memory_channels: "4", suggested_fields: "memory_channels" });
  });

  it("JSON carries the value and the suggested mark", () => {
    const j = JSON.parse(toJson(result({ system: { ...emptySystem(), memoryChannels: "4" }, suggested: ["memoryChannels"] })));
    expect(j.system.memoryChannels).toBe("4");
    expect(j.suggested).toEqual(["memoryChannels"]);
  });
});

describe("overclocked default", () => {
  it("a new run starts at no, as a plain default on desktops and phones", () => {
    const d = withSystem(result(), NEW_RUN_SYSTEM);
    expect(d.system).toEqual({ ...emptySystem(), overclocked: "no" });
    expect(d.suggested).toBeUndefined();
    const p = withSystem(result({ device: PHONE, mobile: true }), NEW_RUN_SYSTEM);
    expect(p.system).toMatchObject({ overclocked: "no", memoryChannels: "4" });
    expect(p.suggested).toEqual(["memoryChannels"]);
  });

  it("goes into the YAML as false, with no comment", () => {
    const r = withSystem(result(), { ...NEW_RUN_SYSTEM, gpuId: GPU, os: "windows" });
    expect(toYaml(r)).toMatch(/^overclocked: false$/m);
  });
});

describe("suggestions and migration", () => {
  it("a new phone or tablet run gets 4 (marked); a desktop run stays blank", () => {
    for (const device of [PHONE, TABLET]) {
      const r = withSystem(result({ device, mobile: true }), {});
      expect(r.system.memoryChannels).toBe("4");
      expect(r.suggested).toEqual(["memoryChannels"]);
    }
    const d = withSystem(result(), {});
    expect(d.system.memoryChannels).toBe("");
    expect(d.suggested).toBeUndefined();
  });

  it("old phone results (no field) get the suggestion, including ones with only the mobile flag", () => {
    const { device: _d, ...noDevice } = result({ mobile: true });
    void _d;
    for (const old of [result({ device: PHONE, mobile: true }), noDevice as BenchResult]) {
      const raw = { gpuId: "", os: "", cpu: "Apple A18 Pro" }; // saved before memoryChannels existed
      const r = withSystem(old, raw);
      expect(r.system).toMatchObject({ cpu: "Apple A18 Pro", memoryChannels: "4" });
      expect(r.suggested).toEqual(["memoryChannels"]);
    }
  });

  it("old desktop results load blank and their YAML doesn't change", () => {
    const raw = { gpuId: GPU, os: "windows", osDetail: "", cpu: "", memoryGb: "32", memoryType: "", driver: "", distro: "", kernel: "", mesa: "", proton: "", overclocked: "" };
    const r = withSystem(result(), raw);
    expect(r.system.memoryChannels).toBe("");
    expect(r.suggested).toBeUndefined();
    expect(toYaml(r)).toBe(toYaml(ready({ memoryGb: "32" })));
    expect(csvRow(r).memory_channels).toBe("");
  });

  it("a value the user cleared stays cleared, and a confirmed one isn't re-marked", () => {
    expect(withSystem(result({ device: PHONE, mobile: true }), { memoryChannels: "" }).system.memoryChannels).toBe("");
    const confirmed = withSystem(result({ device: PHONE, mobile: true }), { memoryChannels: "2" });
    expect(confirmed.system.memoryChannels).toBe("2");
    expect(confirmed.suggested).toBeUndefined();
  });

  it("keeps unknown fields from newer versions and fills missing ones", () => {
    const { system } = completeSystem(result(), { gpuId: GPU, futureField: "x" });
    expect((system as unknown as Record<string, string>).futureField).toBe("x");
    expect(system.memoryType).toBe("");
  });

  it("mobile runs are still blocked from submission, whatever the suggestion", () => {
    const r = withSystem(result({ device: PHONE, mobile: true, system: { ...emptySystem(), gpuId: GPU, os: "windows" } }), { gpuId: GPU, os: "windows" });
    expect(validateSubmission(r)[0]).toMatch(/^Device: mobile/);
    expect(validateSubmission({ ...r, mobile: false, device: DESK })).toEqual([]);
  });
});
