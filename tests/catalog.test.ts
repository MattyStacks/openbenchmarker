import { describe, expect, it } from "vitest";
import { GPU_CATALOG, GPU_REFERENCES, catalogGroups, catalogLabel, findGpu, gpuRequestUrl } from "../src/benchmark/catalog";

describe("the catalog snapshot", () => {
  it("lists the Steam Machine and the handhelds with the specs the form fills in", () => {
    const machine = findGpu("steam_machine_8gb_valve")!;
    expect(machine).toMatchObject({ formFactor: "desktop", vendor: "amd", memoryGb: 8 });
    const deck = findGpu("steam_deck_lcd_16gb")!;
    expect(deck).toMatchObject({ formFactor: "handheld", memoryGb: 16, memoryType: "LPDDR5", ramMts: 5500, oem: "Valve", osShipped: "SteamOS" });
    // A product with base: gets its reference's specs, its own values winning.
    expect(findGpu("legion_go_s_z1_extreme_32gb")).toMatchObject({ base: "z1_extreme", architecture: "RDNA 3", memoryGb: 32, memoryType: "LPDDR5X" });
  });

  it("keeps a name and specs for every reference GPU", () => {
    expect(GPU_REFERENCES.length).toBeGreaterThan(300);
    for (const r of GPU_REFERENCES) expect(r.name, r.id).toBeTruthy();
    expect(GPU_REFERENCES.find((r) => r.id === "rtx_5080_16gb")).toMatchObject({ name: "GeForce RTX 5080", memoryGb: 16, memoryType: "GDDR7" });
  });
});

describe("the GPU list", () => {
  it("groups products by form factor, desktops first, and leaves out empty groups", () => {
    const groups = catalogGroups();
    expect(groups.map((g) => g.label)).toEqual(["Desktop cards and PCs", "Handheld PCs"]);
    expect(groups.flatMap((g) => g.gpus).length).toBe(GPU_CATALOG.length);
    expect(groups[1].gpus.map((g) => g.id)).toContain("steam_deck_lcd_16gb");
    expect(catalogGroups([{ id: "x_8gb", name: "X", vendor: "amd", formFactor: "server" }]).map((g) => g.label)).toEqual(["Other"]);
  });

  it("labels a handheld with its maker and memory, once", () => {
    expect(catalogLabel(findGpu("steam_deck_lcd_16gb")!)).toBe("Valve Steam Deck LCD (16 GB)");
    expect(catalogLabel(findGpu("legion_go_s_z1_extreme_16gb")!)).toBe("Lenovo Legion Go S Z1 Extreme 16 GB");
    expect(catalogLabel(findGpu("rtx_5080_16gb_fe")!)).toBe("GeForce RTX 5080 Founders Edition (16 GB)");
  });

  it("the GPU request issue offers handheld as a form factor", () => {
    expect(decodeURIComponent(gpuRequestUrl("x"))).toContain("desktop / laptop / handheld");
  });
});
