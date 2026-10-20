#!/usr/bin/env node
// Dev tool: headless screenshots and renderer.info load reports of the Neon Flythrough.
// Starts a Vite dev server, opens /?capture (dev-only hook in src/app/capture.ts) in headless Chromium.
//
//   node scripts/capture.mjs --out shots/stage3 [--presets Low,Ultra] [--times 5,20,40] [--w 1280 --h 720]
//   node scripts/capture.mjs --info [--t 20]          # draw calls / triangles for every preset (JSON)
//   node scripts/capture.mjs --timing [--t 20]        # relative ms/frame per preset (software GL!)
//   node scripts/capture.mjs --og public/og-image.png [--t 20]   # 1200x630 Ultra frame
//
// Headless Chromium renders WebGL with SwiftShader (CPU), so images are correct but timings only
// show relative load between presets, never real GPU performance.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const PRESETS = ["Low", "Medium", "High", "Ultra", "Extreme"];

const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});

async function open(preset, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => console.error(`[${preset}] page error:`, e.message));
  page.on("console", (m) => m.type() === "error" && console.error(`[${preset}]`, m.text()));
  await page.goto(`${base}?capture&preset=${preset}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__cap, null, { timeout: 600_000, polling: 250 });
  return page;
}

try {
  if (opt("info")) {
    const t = Number(opt("t", 20));
    const w = Number(opt("w", 1280)), h = Number(opt("h", 720));
    const rows = {};
    for (const p of PRESETS) {
      const page = await open(p, w, h);
      rows[p] = await page.evaluate((t) => ({ ...window.__cap.renderAt(t), counts: window.__cap.counts, features: window.__cap.features }), t);
      await page.close();
      console.error(`${p}: ${rows[p].calls} calls, ${rows[p].triangles} tris`);
    }
    console.log(JSON.stringify({ t, w, h, rows }, null, 2));
  } else if (opt("timing")) {
    const t = Number(opt("t", 20));
    const w = Number(opt("w", 1280)), h = Number(opt("h", 720));
    const presets = opt("presets") ? String(opt("presets")).split(",") : PRESETS;
    // --breakdown: also time the frame with each system hidden (its cost = full - without).
    const systems = opt("breakdown") ? ["sky", "atmosphere", "towers", "signs", "rain", "traffic", "drones", "fx"] : [];
    for (const p of presets) {
      const page = await open(p, w, h);
      const ms = await page.evaluate((t) => window.__cap.timeAt(t, 8), t);
      console.log(`${p.padEnd(8)} ${ms.toFixed(1)} ms/frame (software GL, relative only)`);
      for (const s of systems) {
        const without = await page.evaluate(([t, s]) => {
          window.__cap.setVisible(s, false);
          const v = window.__cap.timeAt(t, 8);
          window.__cap.setVisible(s, true);
          return v;
        }, [t, s]);
        console.log(`  ${s.padEnd(11)} ${(ms - without).toFixed(1)} ms`);
      }
      await page.close();
    }
  } else if (opt("probe")) {
    // Evaluate an async expression in the capture page (modules load via the dev server), e.g.
    // --probe "(await import('/src/engine/world.ts')).JOURNEY_SECONDS"
    const page = await open(String(opt("preset", "Low")), 320, 180);
    console.log(JSON.stringify(await page.evaluate(`(async () => (${opt("probe")}))()`), null, 1));
  } else if (opt("ui")) {
    // Page screenshots: home (desktop + phone), run HUD, a sample result and history.
    const out = opt("ui");
    mkdirSync(out, { recursive: true });
    const sample = {
      id: "sample-1", gameId: "openbenchmarker_neon_flythrough", benchmarkVersion: "1.1.0", date: "2026-10-20", time: "12:00",
      resolutionId: "1080p", resolution: "1080p", width: 1920, height: 1080, preset: "High", durationS: 60, graphicsApi: "WebGL2",
      avgFps: 143.2, p1Low: 98.4, p5Low: 112.7, worstMs: 14.2, frameCount: 8592, loopBusy: 0.94, timing: "gpu-timer",
      valid: true, invalidReason: "", mobile: false,
      system: { gpuId: "", os: "", osDetail: "", cpu: "", memoryGb: "", memoryType: "", driver: "", distro: "", kernel: "", mesa: "", proton: "" },
    };
    const shots = [
      ["home", 1280, 900, "#/"],
      ["home-phone", 390, 844, "#/"],
      ["result", 1280, 1400, "#/result/sample-1"],
      ["history", 1280, 700, "#/history"],
    ];
    for (const [name, w, h, hash] of shots) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.addInitScript((s) => localStorage.setItem("ogb.results.v1", JSON.stringify([s])), sample);
      await page.goto(base + hash);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(out, `${name}.png`), fullPage: name !== "home-phone" });
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => localStorage.setItem("ogb.config.v1", JSON.stringify({ resolution: "720p", preset: "Low", duration: 30 })));
    await page.goto(base);
    await page.click("#start");
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(out, "run.png") });
    await page.click("#abort");
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, "result-invalid.png"), fullPage: true });
    await page.close();
    console.log(`wrote UI shots to ${out}`);
  } else if (opt("og")) {
    const out = opt("og");
    const t = Number(opt("t", 20));
    const page = await open("Ultra", 1200, 630);
    await page.evaluate((t) => window.__cap.renderAt(t), t);
    await page.screenshot({ path: out });
    console.log(`wrote ${out}`);
  } else {
    const out = opt("out", "shots");
    const presets = String(opt("presets", "Low,Ultra")).split(",");
    const times = String(opt("times", "5,20,40")).split(",").map(Number);
    const w = Number(opt("w", 1280)), h = Number(opt("h", 720));
    // --view x,y,z,lx,ly,lz: fixed camera (position, look target) instead of the flight camera.
    const v = opt("view") ? String(opt("view")).split(",").map(Number) : null;
    const view = v ? { pos: v.slice(0, 3), look: v.slice(3, 6) } : undefined;
    const tag = opt("name") ? `${opt("name")}_` : "";
    mkdirSync(out, { recursive: true });
    for (const p of presets) {
      const page = await open(p, w, h);
      for (const t of times) {
        const info = await page.evaluate(([t, view]) => window.__cap.renderAt(t, view), [t, view]);
        const file = join(out, `${tag}${p}_t${String(t).padStart(3, "0")}.png`);
        await page.screenshot({ path: file });
        console.log(`${file}  ${info.calls} calls, ${info.triangles} tris`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
