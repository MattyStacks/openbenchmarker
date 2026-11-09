import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

// My Results' "Download all as YAML": one zip, ready results in the upstream layout, the rest in not-ready/.

const BASE = {
  gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "4.0.0", date: "2026-11-09", time: "14:02",
  resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "High", durationS: 60, graphicsApi: "WebGL2",
  avgFps: 143.21, p1Low: 101.04, p5Low: 118.5, worstMs: 14.2, frameCount: 8600, loopBusy: 0.97, timing: "gpu-timer", valid: true, invalidReason: "",
  mobile: false,
  device: { browser: "chrome", browserMajor: 141, os: "linux", deviceType: "desktop", webkitEngine: false, gpuLabel: null },
};
const RESULTS = [
  { ...BASE, id: "e2e-ready", system: { gpuId: "rtx_5080_16gb_fe", os: "linux", cpu: "AMD Ryzen 7 9800X3D", overclocked: "no" } },
  { ...BASE, id: "e2e-draft", time: "15:00", system: { os: "linux" } },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((rs) => {
    if (!sessionStorage.getItem("e2e-seeded")) {
      localStorage.setItem("ogb.results.v1", JSON.stringify(rs));
      sessionStorage.setItem("e2e-seeded", "1");
    }
  }, RESULTS);
});

test("download all as YAML gives one zip, ready results first in the upstream layout", async ({ page }) => {
  await page.goto("/#/history");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all as YAML (.zip)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^openbenchmarker_results_\d{8}\.zip$/);
  const bytes = readFileSync(await download.path());
  const text = bytes.toString("latin1");
  expect(text.startsWith("PK\u0003\u0004")).toBe(true);
  expect(text).toContain("data/community/rtx_5080_16gb_fe/result_20261109_openbenchmarker_neon_flythrough.yaml");
  expect(text).toContain("not-ready/no-gpu-chosen/result_20261109_openbenchmarker_neon_flythrough.yaml");
  expect(text).toContain("README.txt");

  // Only the ready ones.
  await page.getByLabel("Only results ready to submit").check();
  const [only] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all as YAML (.zip)" }).click()]);
  expect(readFileSync(await only.path()).toString("latin1")).not.toContain("not-ready/no-gpu-chosen/");
});

test("a result that isn't ready can still be downloaded as YAML on its own", async ({ page }) => {
  await page.goto("/#/history");
  const card = page.locator('.run-card[data-id="e2e-draft"]');
  await card.locator("summary[aria-label='More actions for this result']").click();
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download YAML" }).click()]);
  const yaml = readFileSync(await download.path(), "utf8");
  expect(yaml).toMatch(/^# Not ready to submit: it still needs GPU/m);
  expect(yaml).toMatch(/^ {2}os: linux$/m);
});
