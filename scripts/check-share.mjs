#!/usr/bin/env node
// Check: every Share button in the site shares the LINK (navigator.share gets a #/r/ url) and never
// attaches a file. Attached images made iOS Messages and other apps drop the link.
//
//   npm run build && npm run check:share
//
// Serves dist/ with `vite preview`, opens headless Chromium at phone and desktop width, replaces
// navigator.share with a recorder, seeds saved results, clicks every Share button and checks what
// was handed to the share sheet. Copy link and Copy code are checked through the clipboard.
// Also checks that "How sharing works →" opens #/about/sharing without sideways scroll.
// Exit code 1 on any failure. Runs alongside `npm test` (tests/share-keeps-link.test.ts).
import { chromium } from "playwright";
import { preview } from "vite";

const server = await preview({ preview: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch();
const failures = [];
let checks = 0;

const result = (id, over = {}) => ({
  id, gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "2.2.0", date: "2026-10-22", time: "21:00", resolutionId: "720p", resolution: "720p",
  width: 1280, height: 720, preset: "Low", durationS: 30, graphicsApi: "WebGL2", avgFps: 343.6, p1Low: 115.4, p5Low: 147.5, worstMs: 13, frameCount: 10312,
  loopBusy: 0.97, timing: "gpu-timer", valid: true, invalidReason: "", mobile: false, system: {},
  device: { browser: "brave", browserMajor: 155, os: "windows", deviceType: "desktop", webkitEngine: false, gpuLabel: "NVIDIA GeForce RTX 5080" },
  ...over,
});

function expectLink(label, rec) {
  checks++;
  if (!rec) return failures.push(`${label}: navigator.share was not called`);
  if (!/#\/r\/[A-Za-z0-9_-]+$/.test(rec.url ?? "")) failures.push(`${label}: no share link in url (got ${JSON.stringify(rec.url)})`);
  if (rec.files) failures.push(`${label}: a file was attached (${rec.files}); the link can get dropped`);
}

for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => {
    window.__shares = [];
    navigator.canShare = () => true;
    navigator.share = async (d) => void window.__shares.push({ url: d.url ?? null, text: d.text ?? null, files: d.files ? d.files.length : 0 });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => failures.push(`${width}px page error: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  const last = () => page.evaluate(() => window.__shares.at(-1));
  const clickShare = async (label, selector) => {
    const before = await page.evaluate(() => window.__shares.length);
    await page.locator(selector).first().click();
    await page.waitForTimeout(150);
    const n = await page.evaluate(() => window.__shares.length);
    expectLink(`${width}px ${label}`, n > before ? await last() : null);
  };

  await page.goto(`${base}/`);
  await page.evaluate((rs) => {
    localStorage.setItem("ogb.results.v1", JSON.stringify(rs));
    localStorage.removeItem("ogb.historyView.v1");
  }, [result("plain"), result("other", { time: "20:00", avgFps: 4716.3, frameCount: 141500, mobile: true, device: { browser: "brave", browserMajor: null, os: "ios", deviceType: "tablet", webkitEngine: true, gpuLabel: "Apple GPU" } })]);

  // Results page: Share my result, Copy link, Copy code, and the Compare box's Share the comparison.
  await page.goto(`${base}/#/result/plain`);
  await page.reload();
  await clickShare("results: Share my result", "[data-share]");
  await page.locator("[data-copy-link]").click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  checks++;
  if (!/#\/r\/[A-Za-z0-9_-]+$/.test(link)) failures.push(`${width}px results: Copy link copied ${JSON.stringify(link)}`);
  await page.locator("[data-copy-code]").click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  checks++;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(code)) failures.push(`${width}px results: Copy code copied ${JSON.stringify(code)}`);
  await page.locator(".compare-box [data-cmp-pick] button").click();
  await clickShare("results: Compare box → Share the comparison", ".compare-box [data-cmp-share]");

  // A result that was run as a comparison: Share the comparison and Share this run only.
  await page.evaluate((c) => {
    const rs = JSON.parse(localStorage.getItem("ogb.results.v1"));
    rs.push({ ...rs[0], id: "compared", time: "22:00", challenge: c });
    localStorage.setItem("ogb.results.v1", JSON.stringify(rs));
  }, code);
  await page.goto(`${base}/#/result/compared`);
  await page.reload();
  await clickShare("comparison result: Share the comparison", "[data-share-comparison]");
  await clickShare("comparison result: Share this run only", "[data-share-only]");

  // A stress test result: Share my result, the compare box, and its shared link page (lap chart, no sideways scroll).
  await page.evaluate(() => {
    const rs = JSON.parse(localStorage.getItem("ogb.results.v1"));
    const laps = [152.1, 151.8, 150.2, 148.9, 147.5, 146.7].map((avgFps) => ({ avgFps, p1Low: avgFps * 0.8 }));
    rs.push({ ...rs[0], id: "stress", time: "19:00", resolutionId: "4K", resolution: "4K", width: 3840, height: 2160, preset: "Extreme", durationS: 576,
      avgFps: 149.53, p1Low: 120.3, p5Low: 131, worstMs: 11.2, frameCount: 86130, stressTest: "extreme", laps, challenge: undefined });
    localStorage.setItem("ogb.results.v1", JSON.stringify(rs));
  });
  await page.goto(`${base}/#/result/stress`);
  await page.reload();
  await clickShare("stress result: Share my result", "[data-share]");
  const stressLink = (await last())?.url ?? "";
  checks++;
  const stressPage = await page.evaluate(() => ({
    stability: document.querySelector("#res-stability")?.textContent,
    dots: document.querySelectorAll(".lap-chart .lc-wide .lc-dot").length,
    submit: !!document.querySelector("#submit-section"),
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (stressPage.stability !== "96.4%" || stressPage.dots !== 6 || stressPage.submit || stressPage.hscroll)
    failures.push(`${width}px stress result page: ${JSON.stringify(stressPage)}`);
  await page.locator(".compare-box [data-cmp-pick] button").click();
  await clickShare("stress result: Compare box → Share the comparison", ".compare-box [data-cmp-share]");
  await page.goto(stressLink.replace(/^https?:\/\/[^/]+/, base));
  await page.reload();
  checks++;
  const shared = await page.evaluate(() => ({
    view: !document.querySelector("#view-shared").hidden,
    stability: document.querySelector("#view-shared .hero-score b")?.textContent,
    dots: document.querySelectorAll("#view-shared .lap-chart .lc-wide .lc-dot").length,
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (!shared.view || shared.stability !== "96.4%" || shared.dots !== 6 || shared.hscroll) failures.push(`${width}px shared stress link: ${JSON.stringify(shared)}`);

  // My Results: card Share, then table row Share.
  await page.goto(`${base}/#/history`);
  await page.reload();
  await clickShare("My Results card: Share", ".run-card [data-act=share]");
  await page.locator(".run-card [data-act=compare]").first().click();
  await page.locator(".self-compare [data-cmp-paste] input").fill(link);
  await page.locator(".self-compare [data-cmp-paste] button").click();
  await clickShare("My Results card: Compare → Share the comparison", ".self-compare [data-cmp-share]");
  await page.evaluate(() => localStorage.setItem("ogb.historyView.v1", "table"));
  await page.reload();
  await clickShare("My Results table row: Share", ".hist-table [data-act=share]");
  await page.locator(".hist-table [data-act=compare]").first().click();
  await page.locator(".compare-row [data-cmp-pick] button").click();
  await clickShare("My Results table row: Compare → Share the comparison", ".compare-row [data-cmp-share]");

  // "How sharing works →" next to Share opens the About page's sharing section, with no sideways scroll.
  await page.goto(`${base}/#/result/plain`);
  await page.locator(".share-box a[href='#/about/sharing']").click();
  await page.waitForTimeout(200);
  checks++;
  const about = await page.evaluate(() => ({
    view: !document.querySelector("#view-about").hidden,
    section: !!document.querySelector("#sharing .about-table"),
    hscroll: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (!about.view || !about.section) failures.push(`${width}px: How sharing works didn't open the sharing section`);
  if (about.hscroll) failures.push(`${width}px: About page scrolls sideways`);
  await ctx.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
if (failures.length) {
  console.error(`check:share FAILED (${failures.length} of ${checks} checks):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`check:share OK: ${checks} checks, every Share button passes the link and attaches no file (390 px and 1280 px).`);
