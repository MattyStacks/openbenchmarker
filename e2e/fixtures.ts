import { test as base, chromium, type Browser } from "@playwright/test";

export { expect } from "@playwright/test";

// With PW_CDP_URL set, tests run in a browser you started yourself with --remote-debugging-port instead of
// one Playwright launches. Useful when the GPU browser lives somewhere Playwright can't launch it well, such
// as Edge on the Windows side of WSL. Closing only disconnects; the browser keeps running.
const cdpUrl = process.env.PW_CDP_URL;

export const test = cdpUrl
  ? base.extend<object, { browser: Browser }>({
      browser: [
        async ({}, use) => {
          const browser = await chromium.connectOverCDP(cdpUrl);
          await use(browser);
          await browser.close();
        },
        { scope: "worker" },
      ],
    })
  : base;
