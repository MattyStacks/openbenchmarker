import { describe, expect, it } from "vitest";
import { GPU_REFERENCES } from "../src/benchmark/catalog";
import { boardOf, buildGpuId, catalogFile, chipTokens, integratedChip, isCatalogIdShape, isSharedReference, isSizelessReference, isUnnamedIntegrated, knownProduct, parseGpuInfo, productName, referenceIn, referenceMatches, vendorOf } from "../src/benchmark/gpu-id";

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

  it("a card whose reference has no memory size adds its own, and builds on that reference", () => {
    const f = catalogFile("hd_7790_2gb_sapphire_dual_x", "Sapphire Radeon HD 7790 Dual-X", "desktop")!;
    expect(f.path).toBe("data/gpus/desktop/amd/hd_7790_2gb_sapphire_dual_x.yaml");
    expect(f.yaml).toContain("base: hd_7790\n");
    expect(f.yaml).toContain("  capacity_gb: 2\n");
    expect(catalogFile("r9_m280x_4gb_reference", "AMD Radeon R9 M280X", "laptop")!.yaml).toContain("base: r9_m280x\n");
  });

  it("no reference yet: no base line; a bad id or unknown vendor gives nothing", () => {
    expect(catalogFile("rtx_6090_48gb_reference", "RTX 6090", "desktop")!.yaml).not.toContain("base:");
    expect(catalogFile("RTX 5080", "x", "desktop")).toBeNull();
    expect(catalogFile("mystery_8gb_reference", "x", "desktop")).toBeNull();
  });
});

describe("handheld PCs", () => {
  it("reads a handheld computer type", () => {
    expect(parseGpuInfo("Computer type: handheld\nGPU: AMD Radeon(TM) Graphics (? GB) [board 1043]").formFactor).toBe("handheld");
  });

  it("builds <device>_<chip>_<ram>gb, the RAM replacing a chip's own memory token", () => {
    expect(buildGpuId({ base: "z1_extreme", formFactor: "handheld", line: "ROG Ally X", ramGb: 24 })).toBe("rog_ally_x_z1_extreme_24gb");
    expect(buildGpuId({ base: "arc_140v_16gb", formFactor: "handheld", line: "MSI Claw 8 AI+", ramGb: 32 })).toBe("msi_claw_8_ai_arc_140v_32gb");
    // Not finished until it has a RAM size: no memory token, so not a valid id yet.
    expect(isCatalogIdShape(buildGpuId({ base: "z1_extreme", formFactor: "handheld", line: "ROG Ally" }))).toBe(false);
    expect(productName("AMD Radeon(TM) Graphics", { base: "z1_extreme", formFactor: "handheld", line: "ROG Ally X", ramGb: 24 })).toBe("ROG Ally X 24 GB");
  });

  it("finds the chip's reference after the device name, for the vendor and base:", () => {
    expect(referenceIn("rog_ally_x_z1_extreme_24gb")).toBe("z1_extreme");
    expect(referenceIn("rtx_5080_16gb_gigabyte_gaming_oc")).toBe("rtx_5080_16gb");
    expect(vendorOf("rog_ally_x_z1_extreme_24gb")).toBe("amd");
    // The chip's reference names its own memory (rx_7600m_xt_8gb), not the handheld's RAM.
    expect(vendorOf("rog_ally_x_rx_7600m_xt_24gb")).toBe("amd");
    expect(vendorOf("msi_claw_8_ai_arc_140v_32gb")).toBe("intel");
    const f = catalogFile("rog_ally_x_z1_extreme_24gb", "ROG Ally X 24 GB", "handheld")!;
    expect(f.path).toBe("data/gpus/handheld/amd/rog_ally_x_z1_extreme_24gb.yaml");
    expect(f.yaml).toContain("base: z1_extreme\n");
    expect(f.yaml).toContain("  form_factor: handheld\n");
    expect(f.yaml).toContain("  capacity_gb: 24\n  shared: true\n");
    expect(f.yaml).not.toContain("board_partner");
  });

  it("recognises Valve's machines, whose GPU names don't say what they are", () => {
    // Real Linux command output on a Steam Machine.
    const machine = parseGpuInfo("Computer type: desktop\nGPU: Navi 33 [Radeon Graphics] (8 GB) [board 1e44]\n");
    expect(knownProduct(machine.gpus[0])).toBe("steam_machine_8gb_valve");
    expect(knownProduct({ name: "VanGogh [AMD Custom GPU 0405]", vramGb: 1, board: "1002" })).toBe("steam_deck_lcd_16gb");
    // A Navi 33 card from anyone else is just a Radeon card.
    expect(knownProduct({ name: "Navi 33 [Radeon RX 7600/7600 XT]", vramGb: 8, board: "1da2" })).toBeNull();
  });
});

describe("references with no memory size", () => {
  it("are discrete cards sold with more than one size, not shared-memory chips", () => {
    for (const id of ["hd_7730", "hd_7790", "r9_290", "r9_m280x", "arc_a530m"]) expect(isSizelessReference(id)).toBe(true);
    // Integrated: no VRAM to add (their own ID rule is decided upstream).
    for (const id of ["z1_extreme", "arc_140v", "arc_b390"]) expect(isSizelessReference(id)).toBe(false);
    for (const id of ["rtx_2080_ti_11gb", "hd_7790_2gb", "mystery_9000"]) expect(isSizelessReference(id)).toBe(false);
  });

  it("every one gets a valid id once its size is added", () => {
    const sizeless = GPU_REFERENCES.filter((r) => isSizelessReference(r.id));
    expect(sizeless.length).toBeGreaterThan(10);
    for (const r of sizeless) {
      for (const formFactor of ["desktop", "laptop"] as const) {
        const id = buildGpuId({ base: `${r.id}_2gb`, formFactor });
        expect(isCatalogIdShape(id)).toBe(true);
        expect(catalogFile(id, r.name, formFactor)!.yaml).toContain(`base: ${r.id}\n`);
      }
    }
  });
});

describe("integrated graphics (shared memory)", () => {
  it("say shared in place of a memory size, in a laptop or a desktop PC, never with a maker", () => {
    expect(isSharedReference("arc_140v")).toBe(true);
    expect(isSharedReference("hd_7790")).toBe(false);
    expect(buildGpuId({ base: "arc_140v", formFactor: "laptop" })).toBe("arc_140v_shared_reference");
    expect(buildGpuId({ base: "arc_b390", formFactor: "desktop", maker: "asus", line: "nuc" })).toBe("arc_b390_shared_reference");
    // Handhelds keep their RAM size.
    expect(buildGpuId({ base: "z1_extreme", formFactor: "handheld", line: "ROG Ally", ramGb: 16 })).toBe("rog_ally_z1_extreme_16gb");
    expect(productName("Intel(R) Arc(TM) 140V GPU", { base: "arc_140v", formFactor: "desktop", maker: "asus" })).toBe("Intel Arc 140V GPU");
  });

  it("shared is the one memory token: never alongside a size, never twice", () => {
    for (const id of ["arc_140v_shared_reference", "radeon_780m_shared_generic"]) expect(isCatalogIdShape(id)).toBe(true);
    for (const id of ["arc_140v_reference", "arc_140v_16gb_shared_reference", "arc_140v_shared_shared"]) expect(isCatalogIdShape(id)).toBe(false);
  });

  it("their catalog file is an igpu file with shared memory and no capacity, on the chip's reference", () => {
    expect(catalogFile("arc_130t_shared_reference", "Intel Arc 130T GPU", "laptop")).toEqual({
      path: "data/gpus/igpu/intel/arc_130t_shared_reference.yaml",
      yaml: 'id: arc_130t_shared_reference\nbase: arc_130t\nidentity:\n  name: "Intel Arc 130T GPU"\n  gpu_vendor: intel\nclassification:\n  form_factor: igpu\nmemory:\n  shared: true\n',
    });
    // Every shared-memory reference gets a valid ID and file outside a handheld.
    for (const r of GPU_REFERENCES.filter((x) => x.memoryShared)) {
      for (const formFactor of ["laptop", "desktop"] as const) {
        const id = buildGpuId({ base: r.id, formFactor });
        expect(isCatalogIdShape(id)).toBe(true);
        expect(catalogFile(id, r.name, formFactor)!.path).toBe(`data/gpus/igpu/${r.vendor}/${id}.yaml`);
      }
    }
  });
});

describe("integrated graphics with no reference file", () => {
  it("are named by their chip, as sold, without the company", () => {
    const chips: [string, string][] = [
      ["Intel(R) Iris(R) Xe Graphics", "iris_xe"],
      ["Intel(R) UHD Graphics 620", "uhd_620"],
      ["Intel(R) UHD Graphics 770", "uhd_770"],
      ["Intel(R) Iris(R) Plus Graphics 655", "iris_plus_655"],
      ["Intel(R) HD Graphics 4000", "intel_hd_4000"],
      ["AMD Radeon 780M", "radeon_780m"],
      ["AMD Radeon(TM) 890M Graphics", "radeon_890m"],
      ["AMD Radeon(TM) 8060S Graphics", "radeon_8060s"],
      ["AMD Radeon(TM) Vega 8 Graphics", "radeon_vega_8"],
      ["Radeon 780M", "radeon_780m"],
      ["vega 8", "radeon_vega_8"],
      ["iris xe", "iris_xe"],
      ["Advanced Micro Devices, Inc. [AMD/ATI] Rembrandt [Radeon 680M]", "radeon_680m"],
      ["Intel Corporation Alder Lake-P GT2 [Iris Xe Graphics]", "iris_xe"],
    ];
    for (const [name, chip] of chips) expect([name, integratedChip(name)]).toEqual([name, chip]);
  });

  it("aren't confused with discrete GPUs, or with chips the name doesn't give", () => {
    for (const name of ["AMD Radeon HD 7790", "AMD Radeon RX 6800S", "AMD Radeon RX Vega 64", "Vega 56", "AMD Radeon Pro 5500M", "AMD Radeon 540", "Intel(R) Iris(R) Xe MAX Graphics", "Intel(R) Arc(TM) A770 Graphics", "NVIDIA GeForce GTX 970", "NVIDIA GeForce GTX 980M", "HD 4000"])
      expect([name, integratedChip(name), isUnnamedIntegrated(name)]).toEqual([name, "", false]);
    for (const name of ["AMD Radeon(TM) Graphics", "AMD Radeon Graphics", "Intel(R) Graphics", "Intel(R) UHD Graphics", "Intel(R) Arc(TM) Graphics"])
      expect([name, integratedChip(name), isUnnamedIntegrated(name)]).toEqual([name, "", true]);
  });

  it("get a shared ID and an igpu file with the right vendor and no base", () => {
    for (const [chip, vendor, name] of [
      ["radeon_780m", "amd", "AMD Radeon 780M"],
      ["radeon_vega_8", "amd", "AMD Radeon Vega 8 Graphics"],
      ["iris_xe", "intel", "Intel Iris Xe Graphics"],
      ["uhd_620", "intel", "Intel UHD Graphics 620"],
      ["intel_hd_4000", "intel", "Intel HD Graphics 4000"],
    ] as const) {
      for (const formFactor of ["laptop", "desktop"] as const) {
        const id = buildGpuId({ base: chip, formFactor, maker: "asus", shared: true });
        expect(id).toBe(`${chip}_shared_reference`);
        expect(productName(name, { base: chip, formFactor, maker: "asus", shared: true })).toBe(name);
        expect(catalogFile(id, name, formFactor)).toEqual({
          path: `data/gpus/igpu/${vendor}/${id}.yaml`,
          yaml: `id: ${id}\nidentity:\n  name: "${name}"\n  gpu_vendor: ${vendor}\nclassification:\n  form_factor: igpu\nmemory:\n  shared: true\n`,
        });
      }
    }
    // In a handheld the RAM is the memory token, as for any handheld.
    expect(buildGpuId({ base: "radeon_780m", formFactor: "handheld", line: "Mystery Go", ramGb: 32, shared: true })).toBe("mystery_go_radeon_780m_32gb");
    // AMD's discrete hd_ cards keep their vendor.
    expect(vendorOf("hd_7790_2gb_reference")).toBe("amd");
  });

  it("are listed after a discrete GPU in pasted output", () => {
    const info = parseGpuInfo("GPU: AMD Radeon 780M (2 GB)\nGPU: NVIDIA GeForce RTX 4060 Laptop GPU (8 GB)");
    expect(info.gpus.map((g) => g.name)).toEqual(["NVIDIA GeForce RTX 4060 Laptop GPU", "AMD Radeon 780M"]);
  });
});
