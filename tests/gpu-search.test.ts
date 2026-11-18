import { describe, expect, it } from "vitest";
import { referenceLabel, searchGpus, searchWords } from "../src/benchmark/gpu-search";
import { GPU_REFERENCES } from "../src/benchmark/catalog";

const ids = (q: string, n = 5) => searchGpus(q, n).map((o) => o.id);

describe("searching the GPU list", () => {
  it("splits what's typed into words the way GPU names are written", () => {
    expect(searchWords("RTX5080")).toEqual(["rtx", "5080"]);
    expect(searchWords("rx_9070_xt_16gb")).toEqual(["rx", "9070", "xt", "16", "gb"]);
    expect(searchWords("Radeon RX 7600M XT")).toEqual(["radeon", "rx", "7600m", "xt"]);
  });

  it("finds the listed product first, then the known chips", () => {
    expect(ids("5080")[0]).toBe("rtx_5080_16gb_fe");
    expect(ids("5080")).toContain("rtx_5080_16gb");
    expect(ids("rtx5080")[0]).toBe("rtx_5080_16gb_fe");
  });

  it("finds handhelds and Valve's machines by name", () => {
    expect(ids("steam deck")[0]).toBe("steam_deck_lcd_16gb");
    expect(ids("steam machine")[0]).toBe("steam_machine_8gb_valve");
    expect(ids("legion go")).toEqual(expect.arrayContaining(["legion_go_s_z1_extreme_16gb", "legion_go_s_z1_extreme_32gb"]));
    expect(ids("valve")).toEqual(expect.arrayContaining(["steam_deck_lcd_16gb"]));
  });

  it("finds a GPU that isn't in the dataset yet, every memory size", () => {
    const found = searchGpus("5060 ti");
    expect(found.map((o) => o.id)).toEqual(expect.arrayContaining(["rtx_5060_ti_8gb", "rtx_5060_ti_16gb"]));
    expect(found.every((o) => o.kind === "reference")).toBe(true);
    expect(ids("rx 9070 xt")[0]).toBe("rx_9070_xt_16gb");
    expect(searchGpus("4070 laptop")[0]).toMatchObject({ id: "rtx_4070_laptop_8gb", formFactor: "laptop" });
  });

  it("finds nothing for nonsense, and lists the catalog for an empty search", () => {
    expect(searchGpus("zzzz")).toEqual([]);
    expect(searchGpus("").every((o) => o.kind === "product")).toBe(true);
  });

  it("labels reference chips with their maker and memory", () => {
    expect(referenceLabel(GPU_REFERENCES.find((r) => r.id === "rtx_5080_16gb")!)).toBe("NVIDIA GeForce RTX 5080 16 GB");
    expect(referenceLabel(GPU_REFERENCES.find((r) => r.id === "z1_extreme")!)).toBe("AMD Ryzen Z1 Extreme");
  });
});

describe("searching with a name as the browser or driver shows it", () => {
  it("finds the GPU from the full name, pasted as is", () => {
    const top = (q: string) => searchGpus(q, 1)[0]?.id;
    expect(top("Mesa Intel(R) Arc(TM) B580 Graphics (BMG G21)")).toBe("arc_b580_12gb");
    expect(top("Intel(R) Arc(TM) 140V GPU")).toBe("arc_140v");
    expect(top("NVIDIA GeForce RTX 2080 Ti/PCIe/SSE2")).toBe("rtx_2080_ti_11gb");
    expect(top("AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 19.1.7, DRM 3.61)")).toBe("rx_7800_xt_16gb");
    expect(top("ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti (0x00001E07) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("rtx_2080_ti_11gb");
    expect(searchGpus("Mesa Intel(R) Arc(TM) A770 Graphics (DG2)", 2).map((o) => o.id).sort()).toEqual(["arc_a770_16gb", "arc_a770_8gb"]);
  });

  it("still reads short names the same way", () => {
    expect(searchGpus("r9 290", 1)[0].id).toBe("r9_290");
    expect(searchGpus("a770", 3).map((o) => o.id)).toContain("arc_a770_8gb");
  });
});
