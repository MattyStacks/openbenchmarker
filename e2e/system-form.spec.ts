import { expect, test } from "./fixtures";

// The results page's System details form: best guesses from the browser, the type-to-search GPU
// list (listed, known-but-unlisted and typed GPUs), dropdowns with "Other", the optional paste of
// the lookup command's output, and that what's filled in reaches the YAML and a share link.
// Saved results are seeded, so no benchmark runs.

const GPU_ID = "rtx_5080_16gb_fe";
const RESULT = {
  id: "e2e-1", gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "2.2.0", date: "2026-10-20", time: "14:02",
  resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "High", durationS: 60, graphicsApi: "WebGL2",
  avgFps: 143.21, p1Low: 101.04, p5Low: 118.5, worstMs: 14.2, frameCount: 8600, loopBusy: 0.97, timing: "gpu-timer", valid: true, invalidReason: "",
  mobile: false,
  device: { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" },
  system: { gpuId: GPU_ID, os: "windows", osDetail: "Windows 11 Pro 24H2", cpu: "AMD Ryzen 7 7800X3D", memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2", driver: "561.09", overclocked: "no" },
  carriedFrom: "2026-10-19 21:40",
  guessed: true,
};
// A fresh run on a Steam Machine (real Chromium renderer string), nothing filled in yet.
const STEAM = {
  ...RESULT, id: "e2e-steam", carriedFrom: undefined, guessed: undefined,
  device: { browser: "chrome", browserMajor: 153, os: "linux", deviceType: "desktop", webkitEngine: false, gpuLabel: "AMD Steam Machine" },
  diag: {
    gpuBusy: 0.98, gpuMs: 6.8, cpuMs: 1.2, updateMs: 0.4, syncMs: 5.4, frameMs: 6.98, stalls: 0, stallMs: 0, hitches: 0, frameStdMs: 0.4, heapGrowthMb: null,
    renderer: "ANGLE (AMD, AMD Steam Machine (radeonsi navi33 ACO), OpenGL ES 3.2)", vendor: "Google Inc. (AMD)", backend: "OpenGL", maxTextureSize: 16384,
    cpuThreads: 12, onBattery: false, browser: "Chrome 153", features: { bloom: true, msaa: 8, shadowMap: 4096, reflections: 0, volumetrics: 32, fallbackReason: "" },
  },
  probe: { platformVersion: "", model: "", formFactors: ["Desktop"], deviceMemoryGb: 32, screen: { width: 1280, height: 720, dpr: 1 }, battery: { charging: true, level: 1 }, webgpu: null },
  system: { overclocked: "no" },
};

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Seed once per test, not on every navigation, so the page's own saves stick.
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem("e2e-seeded")) {
      localStorage.setItem("ogb.results.v1", JSON.stringify(r));
      sessionStorage.setItem("e2e-seeded", "1");
    }
  }, [RESULT, STEAM]);
});

test("a Steam Machine run is filled in from the browser, marked, and ready to download", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#/result/${STEAM.id}`);
  const form = page.locator("#sys-form");
  await expect(form.locator("#gpu-search")).toHaveValue("Steam Machine (8 GB)");
  await expect(form.locator('[data-suggested="gpuId"]')).toHaveText("from your browser");
  await expect(form.locator('[name="os"]')).toHaveValue("linux");
  await expect(form.locator('[name="cpu"]')).toHaveValue("AMD Custom CPU 1772");
  await expect(form.locator('[data-combo-select="memoryGb"]')).toHaveValue("32");
  await expect(form.locator('[data-suggested="memoryGb"]')).toContainText("rounds down");
  await expect(page.locator("#guess-summary")).toContainText("Steam Machine (8 GB) · SteamOS · AMD Custom CPU 1772 · 32 GB");
  await expect(page.locator("#guess-summary")).toContainText("Ready to download and submit");
  await expect(page.locator("#yaml-preview")).toContainText("gpu_id: steam_machine_8gb_valve");
  await expect(page.locator("#yaml-preview")).toContainText("  memory_gb: 32 # assumed, not confirmed");

  // Picking a value from a dropdown confirms it; "Other" types one in.
  await form.locator('[data-combo-select="memoryGb"]').selectOption("32");
  await form.locator('[data-combo-select="memoryType"]').selectOption("__other__");
  await form.locator('[name="memoryType"]').fill("DDR5-6200");
  await expect(page.locator("#yaml-preview")).toContainText('  memory_type: "DDR5-6200"\n');
  await page.reload();
  await expect(form.locator('[data-combo-select="memoryType"]')).toHaveValue("DDR5-6200");
  // Choosing the guessed value from the dropdown confirms it.
  await expect(form.locator('[data-suggested="memoryGb"]')).toBeHidden();
  await expect(page.locator("#yaml-preview")).toContainText("  memory_gb: 32\n");
  // Cleared guesses stay cleared.
  await form.locator('[data-combo-select="memoryGb"]').selectOption("");
  await page.reload();
  await expect(form.locator('[data-combo-select="memoryGb"]')).toHaveValue("");
  expect(errors).toEqual([]);
});

test("carried details and the overclock section", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  await expect(page.locator("#carried-note")).toContainText("Filled in from your result of 2026-10-19 21:40");
  await expect(form.locator('[name="cpu"]')).toHaveValue("AMD Ryzen 7 7800X3D");
  await expect(form.locator("#gpu-search")).toHaveValue("GeForce RTX 5080 Founders Edition (16 GB)");

  const oc = form.locator(".oc-details");
  await expect(oc).toBeHidden();
  await form.locator('[name="overclocked"]').selectOption("yes");
  await expect(oc).toBeVisible();
  await expect(page.locator("#carried-note")).toHaveCount(0);
  await form.locator('[name="ocCoreMhz"]').fill("+150");
  await form.locator('[name="ocMemoryMhz"]').fill("1000");
  await form.locator('[name="ocPowerPct"]').fill("110");
  await expect(page.locator("#yaml-preview")).toContainText(
    "overclocked: true\noverclock: # as set in the submitter's tuning tool\n  core_clock_offset_mhz: 150\n  memory_clock_offset_mhz: 1000\n  power_limit_pct: 110\nresult:",
  );
  // Linux details only show for Linux.
  await expect(form.locator("#linux-more")).toBeHidden();
  await form.locator('[name="os"]').selectOption("linux");
  await expect(form.locator("#linux-more")).toBeVisible();

  await page.reload();
  await expect(form.locator('[name="ocCoreMhz"]')).toHaveValue("+150");
  expect(errors).toEqual([]);
});

test("search finds a GPU that isn't in the dataset yet and fills in its name, ID and catalog file", async ({ page }) => {
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  const search = form.locator("#gpu-search");
  await search.fill("4070 laptop");
  const option = page.getByRole("option", { name: /GeForce RTX 4070 Laptop GPU 8 GB/ });
  await expect(option).toContainText("Not in the dataset yet");
  await option.click();
  await expect(form.locator('[name="gpuIdRequested"]')).toHaveValue("rtx_4070_laptop_8gb_reference");
  await expect(form.locator('[name="gpuFormFactor"]')).toHaveValue("laptop");
  await expect(page.locator("#val-box")).toContainText("Submitting may fail");
  await expect(page.locator("#gpu-file")).toContainText("data/gpus/laptop/nvidia/rtx_4070_laptop_8gb_reference.yaml");
  await expect(page.locator("#yaml-preview")).toContainText("gpu_id: rtx_4070_laptop_8gb_reference");

  // A desktop chip with two memory sizes asks for the size, then the maker.
  await search.fill("5060 ti");
  await page.getByRole("option", { name: /RTX 5060 Ti 16 GB/ }).click();
  await expect(page.locator("#gpu-helper .helper-id code")).toHaveText("rtx_5060_ti_16gb_reference");
  await page.locator("#gpu-helper [data-helper-maker]").selectOption("msi");
  await page.locator("#gpu-helper [data-helper-line]").fill("Ventus 2X OC");
  await expect(form.locator('[name="gpuIdRequested"]')).toHaveValue("rtx_5060_ti_16gb_msi_ventus_2x_oc");
  await expect(form.locator('[name="gpuName"]')).toHaveValue("MSI NVIDIA GeForce RTX 5060 Ti 16 GB Ventus 2X OC");

  await page.reload();
  await expect(form.locator('[name="gpuIdRequested"]')).toHaveValue("rtx_5060_ti_16gb_msi_ventus_2x_oc");
  await expect(search).toHaveValue("MSI NVIDIA GeForce RTX 5060 Ti 16 GB Ventus 2X OC");
});

test("any GPU can be typed in by name, and keyboard search picks a listed one", async ({ page }) => {
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  const search = form.locator("#gpu-search");
  await search.fill("Mystery GPU 9000 12 GB");
  await page.getByRole("option", { name: /Use “Mystery GPU 9000 12 GB”/ }).click();
  await expect(form.locator('[name="gpuName"]')).toHaveValue("Mystery GPU 9000 12 GB");
  await expect(form.locator('[name="gpuIdRequested"]')).toHaveValue("mystery_9000_12gb_reference");
  await expect(page.locator("#exp-yaml")).toBeEnabled();

  await search.fill("steam deck");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(form.locator('[name="gpuId"]')).toHaveValue("steam_deck_lcd_16gb");
  await expect(page.locator("#gpu-blocked")).toBeHidden();
});

test("pasting the command's output fills every detail it printed", async ({ page }) => {
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  await form.locator("#exact-values > summary").click();
  await expect(form.locator("[data-cmd-all]")).toContainText("Computer type:");
  await expect(form.locator("[data-cmd-open]")).toContainText("PowerShell");
  await form.getByText("Linux", { exact: true }).click();
  await expect(form.locator("[data-cmd-open]")).toContainText("Terminal (bash)");
  // Real output from a Steam Machine.
  await form.locator("[data-sys-paste]").fill(
    [
      "Computer type: desktop",
      "GPU: Navi 33 [Radeon Graphics] (8 GB) [board 1e44]",
      "OS version:  SteamOS",
      "Distro:      SteamOS",
      "Kernel:      7.2.7-valve2-2-neptune-72-g31504582a073",
      "CPU:         AMD Custom CPU 1772",
      "Memory (GB): 32",
      "Memory type: DDR5-5600",
      "Mesa (AMD/Intel driver): 26.1.2",
    ].join("\n"),
  );
  // The user had chosen the RTX 5080 themselves, so the GPU stays; everything else follows the paste.
  await expect(form.locator("[data-paste-status]")).toContainText("Filled in OS, OS version, CPU, Memory, Memory type, GPU driver, Distro, Kernel, Mesa");
  await expect(form.locator('[name="gpuId"]')).toHaveValue("rtx_5080_16gb_fe");
  await expect(form.locator('[name="os"]')).toHaveValue("linux");
  await expect(form.locator('[data-combo-select="memoryType"]')).toHaveValue("DDR5-5600");
  await expect(form.locator('[name="kernel"]')).toHaveValue("7.2.7-valve2-2-neptune-72-g31504582a073");
  await expect(form.locator('[name="driver"]')).toHaveValue("Mesa 26.1.2");
});

test("pasted output picks the GPU when none was chosen, and builds a handheld's ID", async ({ page }) => {
  await page.goto(`/#/result/${STEAM.id}`);
  const form = page.locator("#sys-form");
  // Clear the guessed GPU, then paste: Valve's Navi 33 is the Steam Machine.
  await form.locator("#gpu-search").fill("Some handheld");
  await page.getByRole("option", { name: /Use “Some handheld”/ }).click();
  await form.locator("#exact-values > summary").click();
  await form.locator("[data-sys-paste]").fill("Computer type: handheld\nGPU: AMD Radeon RX 7600M XT (8 GB) [board 1043]");
  // A typed GPU counts as the user's choice: the paste doesn't replace it.
  await expect(form.locator('[name="gpuName"]')).toHaveValue("Some handheld");
});

test("the share link carries the GPU and overclock filled in after the page opened", async ({ page }) => {
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  await form.locator('[name="overclocked"]').selectOption("yes");
  await form.locator('[name="ocCoreMhz"]').fill("150");
  await form.locator('[name="ocPowerPct"]').fill("110");

  await page.locator("[data-copy-link]").first().click();
  await expect(page.locator("[data-share-status]").first()).toContainText("copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#\/r\/[A-Za-z0-9_-]+$/);

  await page.goto(link);
  const facts = page.locator(".shared-facts");
  await expect(facts).toContainText("GPU (chosen by the sharer)");
  await expect(facts).toContainText("GeForce RTX 5080 Founders Edition");
  await expect(facts).toContainText("Yes: core +150 MHz, power limit 110%");
  await expect(facts).toContainText("NVIDIA GeForce RTX 5080");
});

