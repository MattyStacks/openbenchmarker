import { expect, test } from "./fixtures";

test("home page loads without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/Open GPU Benchmarker/);
  await expect(page.getByRole("heading", { name: "Neon Flythrough" })).toBeVisible();
  expect(errors).toEqual([]);
});

// Reports which GPU path the browser under test has. Only WebGL2 is required; the bundled Chromium has
// no WebGPU, so that's reported, not asserted.
test("reports graphics capabilities", async ({ page }) => {
  await page.goto("/");
  const caps = await page.evaluate(async () => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
    return {
      webgl2: gl ? String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null,
      webglTimerQuery: !!gl?.getExtension("EXT_disjoint_timer_query_webgl2"),
      webgpu: adapter ? `${adapter.info.vendor} / ${adapter.info.architecture}` : null,
      webgpuTimestampQuery: !!adapter?.features.has("timestamp-query"),
    };
  });
  test.info().annotations.push({ type: "graphics", description: JSON.stringify(caps) });
  console.log("graphics:", caps);
  expect(caps.webgl2).not.toBeNull();
});
