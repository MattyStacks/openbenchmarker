import { describe, expect, it } from "vitest";
import { GPU_REFERENCES } from "../src/benchmark/catalog";
import { boardOf, buildGpuId, catalogFile, chipTokens, isCatalogIdShape, parseGpuInfo, productName, referenceMatches, vendorOf } from "../src/benchmark/gpu-id";

// Real output of the Windows GPU command on an RTX 5090 laptop (Lenovo Legion Pro 7).
const LAPTOP_WIN = "Computer type: laptop\r\nGPU: NVIDIA GeForce RTX 5090 Laptop GPU (24 GB) [board 17AA]\r\nGPU: Intel(R) Graphics (? GB) [board 17AA]\r\n";

describe("reading the pasted command output", () => {
  it("finds the laptop's discrete GPU first", () => {
    const info = parseGpuInfo(LAPTOP_WIN);
    expect(info.formFactor).toBe("laptop");
    expect(info.gpus[0]).toEqual({ name: "NVIDIA GeForce RTX 5090 Laptop GPU", vramGb: 24, board: "17aa" });
    expect(info.gpus.map((g) => g.name)).toEqual(["NVIDIA GeForce RTX 5090 Laptop GPU", "Intel(R) Graphics"]);
  });

  it("reads the Linux command, older output and raw nvidia-smi", () => {
    const linux = parseGpuInfo("Computer type: desktop\nGPU: Navi 48 [Radeon RX 9070/9070 XT/9070 GRE] (16 GB) [board 1da2]\nGPU:  (? GB) [board 0000]\n");
    expect(linux).toEqual({ formFactor: "desktop", gpus: [{ name: "Navi 48 [Radeon RX 9070/9070 XT/9070 GRE]", vramGb: 16, board: "1da2" }] });
    const old = parseGpuInfo("GPU:         NVIDIA GeForce RTX 4070 (12 GB); Intel(R) UHD Graphics 770 (0 GB)");
    expect(old.gpus[0]).toEqual({ name: "NVIDIA GeForce RTX 4070", vramGb: 12, board: "" });
    expect(old.formFactor).toBeNull();
    expect(parseGpuInfo("NVIDIA GeForce RTX 5090 Laptop GPU, 24463 MiB").gpus[0].vramGb).toBe(24);
  });

  it("skips virtual adapters and lines that aren't GPUs, and ranks integrated GPUs last", () => {
    const info = parseGpuInfo("GPU: Microsoft Basic Display Adapter (0 GB)\nCPU: AMD Ryzen 7\nGPU: AMD Radeon(TM) Graphics (? GB)\nGPU: AMD Radeon RX 7600M XT (8 GB) [board 1043]\n");
    expect(info.gpus.map((g) => g.name)).toEqual(["AMD Radeon RX 7600M XT", "AMD Radeon(TM) Graphics"]);
    expect(parseGpuInfo("").gpus).toEqual([]);
  });
});

describe("matching the catalog's reference GPUs", () => {
  it("names chips the way the reference ids do", () => {
    expect(chipTokens("NVIDIA GeForce RTX 5090 Laptop GPU")).toEqual(["rtx_5090_laptop"]);
    expect(chipTokens("NVIDIA GeForce RTX 3050 Ti Laptop GPU")).toEqual(["rtx_3050_ti_laptop"]);
    expect(chipTokens("AMD Radeon RX 7600M XT")).toEqual(["rx_7600m_xt"]);
    expect(chipTokens("Intel(R) Arc(TM) B580 Graphics")).toEqual(["arc_b580"]);
    expect(chipTokens("Intel(R) Arc(TM) A770M Graphics")).toEqual(["arc_a770m"]);
    expect(chipTokens("Intel(R) Arc(TM) 140V GPU (16GB)")).toEqual(["arc_140v"]);
    expect(chipTokens("Navi 48 [Radeon RX 9070/9070 XT/9070 GRE]")).toEqual(["rx_9070", "rx_9070_xt", "rx_9070_gre"]);
    expect(chipTokens("GA104M [GeForce RTX 3070 Mobile / Max-Q]")).toEqual(["rtx_3070_laptop"]);
    expect(chipTokens("Intel(R) Graphics")).toEqual([]);
  });

  it("finds the exact reference, or offers the choices", () => {
    expect(referenceMatches({ name: "NVIDIA GeForce RTX 5090 Laptop GPU", vramGb: 24 })).toMatchObject({ base: "rtx_5090_laptop_24gb" });
    expect(referenceMatches({ name: "NVIDIA GeForce RTX 5080", vramGb: 16 }).base).toBe("rtx_5080_16gb");
    // The desktop 5090 has 32 GB: a 5090 laptop's chip doesn't match it.
    expect(referenceMatches({ name: "NVIDIA GeForce RTX 5090", vramGb: 32 }).base).toBe("rtx_5090_32gb");
    const lspci = referenceMatches({ name: "Navi 48 [Radeon RX 9070/9070 XT/9070 GRE]", vramGb: 16 });
    expect(lspci.base).toBeNull(); // 9070 and 9070 XT both have 16 GB: the user picks
    expect(lspci.options).toEqual(expect.arrayContaining(["rx_9070_16gb", "rx_9070_xt_16gb", "rx_9070_gre_12gb"]));
    // VRAM unknown: the one reference for the chip, or every size to choose from.
    expect(referenceMatches({ name: "Intel(R) Arc(TM) B580 Graphics", vramGb: null }).base).toBe("arc_b580_12gb");
    const sizes = referenceMatches({ name: "NVIDIA GeForce RTX 4060 Ti", vramGb: null });
    expect(sizes.base).toBeNull();
    expect(sizes.options).toEqual(["rtx_4060_ti_16gb", "rtx_4060_ti_8gb"]);
  });

  it("falls back to chip and memory when no reference exists yet", () => {
    expect(referenceMatches({ name: "NVIDIA GeForce RTX 6090", vramGb: 48 })).toEqual({ base: null, options: [], fallback: "rtx_6090_48gb" });
  });

  it("knows the vendor", () => {
    expect(vendorOf("rtx_5090_laptop_24gb_reference")).toBe("nvidia");
    expect(vendorOf("rx_9070_xt_16gb")).toBe("amd");
    expect(vendorOf("arc_b580_12gb_le")).toBe("intel");
    expect(vendorOf("rtx_6090_48gb_reference")).toBe("nvidia");
    expect(vendorOf("mystery_8gb")).toBeNull();
    expect(GPU_REFERENCES.length).toBeGreaterThan(300);
  });
});

describe("building the id", () => {
  it("laptops: the reference plus _reference, never the laptop's maker", () => {
    const gpu = parseGpuInfo(LAPTOP_WIN).gpus[0];
    expect(boardOf(gpu.board)).toBeNull(); // 17aa is Lenovo, the laptop maker
    const id = buildGpuId({ base: referenceMatches(gpu).base!, formFactor: "laptop", maker: "lenovo" });
    expect(id).toBe("rtx_5090_laptop_24gb_reference");
    expect(productName(gpu.name, { base: "rtx_5090_laptop_24gb", formFactor: "laptop" })).toBe("NVIDIA GeForce RTX 5090 Laptop GPU");
    expect(buildGpuId({ base: "rx_7600m_xt_8gb", formFactor: "laptop" })).toBe("rx_7600m_xt_8gb_reference");
  });

  it("desktops: brand and line, brand only, the vendor's own card, or unknown", () => {
    const base = "rtx_5080_16gb";
    expect(buildGpuId({ base, formFactor: "desktop", maker: "gigabyte", line: "Gaming OC" })).toBe("rtx_5080_16gb_gigabyte_gaming_oc");
    expect(buildGpuId({ base, formFactor: "desktop", maker: "gigabyte" })).toBe("rtx_5080_16gb_gigabyte_reference");
    expect(buildGpuId({ base, formFactor: "desktop", maker: "own" })).toBe("rtx_5080_16gb_fe");
    expect(buildGpuId({ base: "rx_9070_xt_16gb", formFactor: "desktop", maker: "own" })).toBe("rx_9070_xt_16gb_reference");
    expect(buildGpuId({ base: "arc_b580_12gb", formFactor: "desktop", maker: "own" })).toBe("arc_b580_12gb_le");
    expect(buildGpuId({ base, formFactor: "desktop" })).toBe("rtx_5080_16gb_reference");
    expect(boardOf("1458")).toEqual({ brand: "gigabyte" });
    expect(boardOf("10de")).toEqual({ own: true });
    expect(boardOf("")).toBeNull();
    expect(productName("NVIDIA GeForce RTX 5080", { base, formFactor: "desktop", maker: "gigabyte", line: "Gaming OC" })).toBe("Gigabyte NVIDIA GeForce RTX 5080 Gaming OC");
    expect(productName("NVIDIA GeForce RTX 5080", { base, formFactor: "desktop", maker: "own" })).toBe("NVIDIA GeForce RTX 5080 Founders Edition");
  });

  it("every built id follows the upstream id rule", () => {
    for (const id of ["rtx_5090_laptop_24gb_reference", "rtx_5080_16gb_gigabyte_gaming_oc", "rx_9070_xt_16gb_reference"]) expect(isCatalogIdShape(id)).toBe(true);
    for (const id of ["rtx_5080", "rtx__5080_16gb", "RTX_5080_16gb", "rtx_5080_16gb_16gb", "rtx-5080_16gb", "_rtx_5080_16gb"]) expect(isCatalogIdShape(id)).toBe(false);
  });
});

describe("the catalog file", () => {
  it("a laptop builds on its reference", () => {
    expect(catalogFile("rtx_5090_laptop_24gb_reference", "NVIDIA GeForce RTX 5090 Laptop GPU", "laptop")).toEqual({
      path: "data/gpus/laptop/nvidia/rtx_5090_laptop_24gb_reference.yaml",
      yaml: 'id: rtx_5090_laptop_24gb_reference\nbase: rtx_5090_laptop_24gb\nidentity:\n  name: "NVIDIA GeForce RTX 5090 Laptop GPU"\n  gpu_vendor: nvidia\nclassification:\n  form_factor: laptop\nmemory:\n  capacity_gb: 24\n',
    });
  });

  it("a branded desktop card names its board partner", () => {
    const f = catalogFile("rtx_5080_16gb_gigabyte_gaming_oc", "Gigabyte GeForce RTX 5080 Gaming OC", "desktop")!;
    expect(f.path).toBe("data/gpus/desktop/nvidia/rtx_5080_16gb_gigabyte_gaming_oc.yaml");
    expect(f.yaml).toContain("base: rtx_5080_16gb\n");
    expect(f.yaml).toContain("  board_partner: Gigabyte\n");
  });

  it("no reference yet: no base line; a bad id or unknown vendor gives nothing", () => {
    expect(catalogFile("rtx_6090_48gb_reference", "RTX 6090", "desktop")!.yaml).not.toContain("base:");
    expect(catalogFile("RTX 5080", "x", "desktop")).toBeNull();
    expect(catalogFile("mystery_8gb_reference", "x", "desktop")).toBeNull();
  });
});
