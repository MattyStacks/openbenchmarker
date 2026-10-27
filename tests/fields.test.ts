import { describe, expect, it } from "vitest";
import { BENCHMARK, GPU_CATALOG, NOT_LISTED } from "../src/benchmark/catalog";
import { toCsv, toJson, toYaml } from "../src/benchmark/exporter";
import { SYSTEM_FIELDS, carriedSystem, carrySource, completeSystem, emptySystem, NEW_RUN_SYSTEM } from "../src/benchmark/fields";
import type { BenchResult, DeviceContext } from "../src/benchmark/types";
import { missingLabels, submissionWarnings, validateSubmission } from "../src/benchmark/validate";
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

describe("overclock details", () => {
  const oc = { overclocked: "yes", ocCoreMhz: "+150", ocMemoryMhz: "-500", ocPowerPct: "110" };

  it("validate like the sliders: signed MHz offsets, power limit 1-300%", () => {
    for (const v of ["150", "+150", "-100", "0", "3000", "-3000", ""]) expect(validateSubmission(ready({ overclocked: "yes", ocCoreMhz: v }))).toEqual([]);
    for (const v of ["3001", "1.5", "+", "fast"]) expect(validateSubmission(ready({ overclocked: "yes", ocCoreMhz: v }))[0]).toMatch(/^Core clock offset:/);
    for (const v of ["10000", "-10000"]) expect(validateSubmission(ready({ overclocked: "yes", ocMemoryMhz: v }))).toEqual([]);
    expect(validateSubmission(ready({ overclocked: "yes", ocMemoryMhz: "10001" }))[0]).toMatch(/^Memory clock offset:/);
    for (const v of ["1", "100", "300"]) expect(validateSubmission(ready({ overclocked: "yes", ocPowerPct: v }))).toEqual([]);
    for (const v of ["0", "301", "-110"]) expect(validateSubmission(ready({ overclocked: "yes", ocPowerPct: v }))[0]).toMatch(/^Power limit:/);
  });

  it("are kept but ignored unless overclocked is yes", () => {
    for (const overclocked of ["no", ""]) {
      const r = ready({ ...oc, overclocked, ocCoreMhz: "nonsense" });
      expect(validateSubmission(r)).toEqual([]);
      expect(toYaml(r)).not.toMatch(/overclock:|clock_offset|power_limit/);
      expect(csvRow(r).core_clock_offset_mhz).toBe("");
      expect(r.system.ocCoreMhz).toBe("nonsense");
    }
  });

  it("go in an overclock: block right after overclocked: true, as bare numbers", () => {
    const y = toYaml(ready(oc));
    expect(y).toMatch(/^frame_generation: false\noverclocked: true\noverclock: # as set in the submitter's tuning tool\n {2}core_clock_offset_mhz: 150\n {2}memory_clock_offset_mhz: -500\n {2}power_limit_pct: 110\nresult:$/m);
    expect(toYaml(ready({ overclocked: "yes", ocPowerPct: "120" }))).toMatch(/^overclock: .*\n {2}power_limit_pct: 120\nresult:$/m);
    expect(toYaml(ready({ overclocked: "yes" }))).toMatch(/^overclocked: true\nresult:$/m);
  });

  it("are CSV columns when overclocked is yes", () => {
    const row = csvRow(ready(oc));
    expect([row.core_clock_offset_mhz, row.memory_clock_offset_mhz, row.power_limit_pct]).toEqual(["+150", "-500", "110"]);
  });

  it("older results load with them blank", () => {
    const r = withSystem(result(), { gpuId: GPU, os: "windows", overclocked: "yes" });
    expect([r.system.ocCoreMhz, r.system.ocMemoryMhz, r.system.ocPowerPct]).toEqual(["", "", ""]);
    expect(toYaml(r)).toMatch(/^overclocked: true\nresult:$/m);
  });
});

describe("carrying details to the next run", () => {
  const filled = { gpuId: GPU, os: "linux", osDetail: "Fedora 41", cpu: "Ryzen 7 7800X3D", memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2", driver: "Mesa 24.2.5", distro: "Fedora", kernel: "6.11.4", mesa: "24.2.5", proton: "x", overclocked: "yes", ocCoreMhz: "150", ocMemoryMhz: "1000", ocPowerPct: "110" };
  const saved = (sys: Partial<BenchResult["system"]>, over: Partial<BenchResult> = {}) => result({ ...over, system: { ...emptySystem(), ...sys } });

  it("copies what rarely changes, not kernel, Mesa or Proton", () => {
    const c = carriedSystem(saved(filled), result());
    expect(c).toEqual({ gpuId: GPU, gpuName: "", gpuIdRequested: "", gpuFormFactor: "", os: "linux", osDetail: "Fedora 41", cpu: "Ryzen 7 7800X3D", memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2", driver: "Mesa 24.2.5", distro: "Fedora", overclocked: "yes", ocCoreMhz: "150", ocMemoryMhz: "1000", ocPowerPct: "110" });
  });

  it("a new run gets them as plain values (not suggestions), and they go into the YAML", () => {
    const r = withSystem(result(), { ...NEW_RUN_SYSTEM, ...carriedSystem(saved({ gpuId: GPU, os: "windows", cpu: "Ryzen 7", overclocked: "no" }), result()) });
    expect(r.system).toMatchObject({ gpuId: GPU, os: "windows", cpu: "Ryzen 7", overclocked: "no", kernel: "" });
    expect(r.suggested).toBeUndefined();
    expect(toYaml(r)).toMatch(/^ {2}cpu: "Ryzen 7"$/m);
  });

  it("a field the user cleared stays blank, and overclocked can be carried as not saying", () => {
    const c = carriedSystem(saved({ gpuId: GPU, os: "windows", overclocked: "", driver: "" }), result());
    expect(withSystem(result(), { ...NEW_RUN_SYSTEM, ...c }).system).toMatchObject({ overclocked: "", driver: "" });
  });

  it("skips the GPU's own details when the browser reports a different GPU", () => {
    const other = { ...DESK, gpuLabel: "Intel(R) Arc(TM) Graphics" };
    const c = carriedSystem(saved(filled), result({ device: other }));
    expect(c).toMatchObject({ os: "linux", cpu: "Ryzen 7 7800X3D" });
    for (const k of ["gpuId", "driver", "overclocked", "ocCoreMhz", "ocMemoryMhz", "ocPowerPct"]) expect(c).not.toHaveProperty(k);
    expect(withSystem(result(), { ...NEW_RUN_SYSTEM, ...c }).system.overclocked).toBe("no");
    // A masked GPU name on either run can't tell, so everything is carried.
    expect(carriedSystem(saved(filled), result({ device: { ...DESK, gpuLabel: null } }))).toHaveProperty("gpuId", GPU);
  });

  it("the source is the newest desktop result with something filled in", () => {
    const blank = saved({ overclocked: "no" }, { id: "blank" });
    const phone = saved({ gpuId: GPU }, { id: "phone", device: PHONE, mobile: true });
    const mine = saved({ cpu: "Ryzen 7" }, { id: "mine" });
    const older = saved(filled, { id: "older" });
    expect(carrySource([blank, phone, mine, older])?.id).toBe("mine");
    expect(carrySource([blank, phone])).toBeUndefined();
    expect(carrySource([])).toBeUndefined();
    expect(carriedSystem(undefined, result())).toEqual({});
  });

  it("where they came from stays local: not in the JSON export", () => {
    const j = JSON.parse(toJson(ready({}, { carriedFrom: "2026-10-27 14:02" })));
    expect(j).not.toHaveProperty("carriedFrom");
    expect(toCsv([ready({}, { carriedFrom: "2026-10-27 14:02" })])).not.toContain("2026-10-27 14:02");
  });
});

describe("a GPU that isn't in the catalog yet", () => {
  const unlisted = (sys: Partial<BenchResult["system"]> = {}) => ready({ gpuId: NOT_LISTED, gpuName: "AMD Radeon RX 9070 XT 16 GB", gpuIdRequested: "rx_9070_xt_16gb", ...sys });

  it("needs its name and a well-formed requested gpu_id, then validates with a warning", () => {
    expect(validateSubmission(unlisted())).toEqual([]);
    expect(submissionWarnings(unlisted())[0]).toMatch(/rx_9070_xt_16gb\) isn't in the Open GPU Benchmarks catalog yet, so this submission will fail upstream checks/);
    expect(submissionWarnings(ready())).toEqual([]);
    expect(missingLabels(validateSubmission(unlisted({ gpuName: "", gpuIdRequested: "" })))).toEqual(["Your GPU", "Requested gpu_id"]);
    for (const id of ["RX 9070 XT", "Rx_9070_16gb", "_rx_16gb", "rx 9070", "rx_9070_xt", "rx__9070_16gb", "rx-9070-16gb"]) expect(validateSubmission(unlisted({ gpuIdRequested: id }))[0]).toMatch(/^Requested gpu_id: '.*' must be/);
    expect(validateSubmission(unlisted({ gpuFormFactor: "tower" }))[0]).toMatch(/^GPU type:/);
    expect(validateSubmission(unlisted({ gpuFormFactor: "laptop" }))).toEqual([]);
    expect(validateSubmission(unlisted({ gpuIdRequested: GPU }))[0]).toMatch(/already in the catalog; choose it from the GPU list/);
  });

  it("the YAML uses the requested id and says the GPU has to be added", () => {
    const y = toYaml(unlisted());
    expect(y).toMatch(/^# This GPU isn't in the catalog yet: add data\/gpus entry rx_9070_xt_16gb for "AMD Radeon RX 9070 XT 16 GB" first or in the same PR, or the checks fail\.\ngpu_id: rx_9070_xt_16gb$/m);
    expect(y).toMatch(/^# Save as data\/community\/rx_9070_xt_16gb\//m);
    expect(y).not.toMatch(/__not_listed__|gpu_name|gpu_id_requested/);
  });

  it("name and requested id are CSV columns only while the GPU is not listed", () => {
    expect(csvRow(unlisted())).toMatchObject({ gpu_id: NOT_LISTED, gpu_name: "AMD Radeon RX 9070 XT 16 GB", gpu_id_requested: "rx_9070_xt_16gb" });
    const picked = ready({ gpuName: "old", gpuIdRequested: "old_id" });
    expect(csvRow(picked)).toMatchObject({ gpu_name: "", gpu_id_requested: "" });
    expect(validateSubmission(ready({ gpuIdRequested: "NOT VALID" }))).toEqual([]);
  });

  it("are carried to the next run with the GPU", () => {
    const c = carriedSystem(unlisted(), result());
    expect(c).toMatchObject({ gpuId: NOT_LISTED, gpuName: "AMD Radeon RX 9070 XT 16 GB", gpuIdRequested: "rx_9070_xt_16gb" });
    expect(carriedSystem(unlisted(), result({ device: { ...DESK, gpuLabel: "Intel(R) Arc(TM) Graphics" } }))).not.toHaveProperty("gpuName");
  });
});
