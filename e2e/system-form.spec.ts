import { expect, test } from "./fixtures";

// The results form's carried details, overclock section and lookup commands, and that the GPU and
// overclock filled in there reach a share link. A saved result is seeded, so no benchmark runs.

const GPU_ID = "rtx_5080_16gb_fe";
const RESULT = {
  id: "e2e-1", gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "2.2.0", date: "2026-10-20", time: "14:02",
  resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "High", durationS: 60, graphicsApi: "WebGL2",
  avgFps: 143.21, p1Low: 101.04, p5Low: 118.5, worstMs: 14.2, frameCount: 8600, loopBusy: 0.97, timing: "gpu-timer", valid: true, invalidReason: "",
  mobile: false,
  device: { browser: "edge", browserMajor: 141, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" },
  system: { gpuId: GPU_ID, os: "windows", osDetail: "Windows 11 Pro 24H2", cpu: "AMD Ryzen 7 7800X3D", memoryGb: "32", memoryType: "DDR5-6000", memoryChannels: "2", driver: "561.09", overclocked: "no" },
  carriedFrom: "2026-10-19 21:40",
};

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Seed once per test, not on every navigation, so the page's own saves stick.
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem("e2e-seeded")) {
      localStorage.setItem("ogb.results.v1", JSON.stringify([r]));
      sessionStorage.setItem("e2e-seeded", "1");
    }
  }, RESULT);
});

test("carried details, overclock section and driver commands", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  await expect(page.locator("#carried-note")).toContainText("Filled in from your result of 2026-10-19 21:40");
  await expect(form.locator('[name="cpu"]')).toHaveValue("AMD Ryzen 7 7800X3D");

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

  const cmds = page.locator("#os-cmds");
  for (const label of ["GPU driver (NVIDIA)", "GPU driver (AMD)", "GPU driver (Intel)"]) await expect(cmds).toContainText(label);
  await form.locator('[name="os"]').selectOption("linux");
  await expect(cmds).toContainText("GPU driver (AMD/Intel)");
  await expect(cmds).toContainText("dpkg-query");

  // Saved: a reload keeps the overclock details.
  await page.reload();
  await expect(form.locator('[name="ocCoreMhz"]')).toHaveValue("+150");
  expect(errors).toEqual([]);
});

test("a GPU that isn't listed can be typed in, saved and submitted with a warning", async ({ page }) => {
  await page.goto(`/#/result/${RESULT.id}`);
  const form = page.locator("#sys-form");
  await expect(form.locator('[name="gpuName"]')).toBeHidden();
  await form.locator('[name="gpuId"]').selectOption("__not_listed__");
  await expect(page.locator("#val-box")).toContainText("Your GPU: type its exact name");
  await expect(page.locator("#exp-yaml")).toBeDisabled();

  await form.locator('[name="gpuName"]').fill("AMD Radeon RX 9070 XT 16 GB");
  await form.locator('[name="gpuIdRequested"]').fill("rx_9070_xt_16gb");
  await expect(page.locator("#val-box")).toContainText("Submitting may fail");
  await expect(page.locator("#exp-yaml")).toBeEnabled();
  await expect(page.locator("#yaml-preview")).toContainText("gpu_id: rx_9070_xt_16gb");
  await expect(page.locator("#submit-steps")).toContainText("add rx_9070_xt_16gb to data/gpus/");
  await expect(page.locator("#gpu-request")).toHaveAttribute("href", /AMD%20Radeon%20RX%209070%20XT%2016%20GB/);

  await page.reload();
  await expect(form.locator('[name="gpuName"]')).toHaveValue("AMD Radeon RX 9070 XT 16 GB");
  await expect(form.locator('[name="gpuIdRequested"]')).toHaveValue("rx_9070_xt_16gb");
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
