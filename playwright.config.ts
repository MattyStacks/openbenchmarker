import { defineConfig } from "@playwright/test";

// Browser tests (e2e/). By default they run in Playwright's bundled Chromium, which renders WebGL in
// software (SwiftShader) and has no WebGPU: fine for checking that pages work, meaningless for timings.
// To test on a real GPU, pick the browser with environment variables (nothing machine-specific lives here):
//   PW_CHANNEL=msedge|chrome   launch an installed browser instead of the bundled Chromium
//   PW_ARGS="--flag --flag"    extra launch flags (e.g. --force-high-performance-gpu, --enable-unsafe-webgpu)
//   PW_CDP_URL=http://127.0.0.1:9333   connect to a browser you started with --remote-debugging-port
//                                      (see e2e/fixtures.ts; PW_CHANNEL and PW_ARGS are then ignored)
const PORT = 5179;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: { args: process.env.PW_ARGS?.split(/\s+/).filter(Boolean) ?? [] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
