// Run against an already-running local dev server. Machine-specific browser flags stay in env.
// Example: BENCH_URL=http://localhost:5180 PW_CHANNEL=chromium PW_ARGS='...' node scripts/profile-run.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const browser = process.env.PW_CDP_URL ? await chromium.connectOverCDP(process.env.PW_CDP_URL) : await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE_PATH || undefined,
  channel: process.env.PW_CHANNEL || 'chromium',
  headless: process.env.BENCH_HEADED !== '1',
  args: process.env.PW_ARGS?.split(/\s+/).filter(Boolean) ?? [],
});
try {
  for (let trial = 0; trial < Number(process.env.BENCH_REPEATS || 3); trial++) {
    const page = await browser.newPage({ viewport: process.env.BENCH_HEADED === '1' ? null : { width: 1280, height: 720 } });
    await page.goto(process.env.BENCH_URL || 'http://localhost:5179');
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return '';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return String(name);
    });
    if (!renderer || /SwiftShader|llvmpipe|softpipe|software/i.test(renderer)) throw new Error(`Real GPU required: ${renderer}`);
    for (const [name, value] of Object.entries({ resolution: process.env.BENCH_RES || '720p', preset: process.env.BENCH_PRESET || 'Low', duration: '30' })) {
      await page.locator(`input[name="${name}"]`).evaluateAll((inputs, value) => {
        const input = inputs.find(i => i.value === value);
        if (!input) throw new Error(`Unknown setting: ${value}`);
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    }
    await page.evaluate(() => {
      window.benchPacing = [];
      window.benchPresentations = [];
      window.benchTransfers = [];
      const transfer = ImageBitmapRenderingContext.prototype.transferFromImageBitmap;
      let lastImage = 0;
      ImageBitmapRenderingContext.prototype.transferFromImageBitmap = function(image) {
        const now = performance.now();
        const timed = document.querySelector('#hud-phase')?.textContent.startsWith('TIMED');
        if (timed && lastImage) window.benchPresentations.push(now - lastImage);
        lastImage = timed ? now : 0;
        const result = transfer.call(this, image);
        if (timed) window.benchTransfers.push(performance.now() - now);
        return result;
      };
      let last = 0;
      const frame = t => {
        const timed = document.querySelector('#hud-phase')?.textContent.startsWith('TIMED');
        if (timed && last) window.benchPacing.push(t - last);
        last = timed ? t : 0;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      document.querySelector('#config').requestSubmit();
    });
    const layout = await page.evaluate(() => {
      const bounds = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      return { innerHeight, outerHeight, screenHeight: screen.availHeight, abort: bounds('#abort'), graph: bounds('#hud-graph') };
    });
    const gpuBusy = [];
    let traceSession;
    const traceEvents = [];
    if (process.env.BENCH_TRACE) {
      await page.waitForFunction(() => document.querySelector('#hud-phase')?.textContent.startsWith('TIMED'), null, { timeout: 120000 });
      traceSession = await page.context().newCDPSession(page);
      traceSession.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
      await traceSession.send('Tracing.start', { categories: 'toplevel,gpu,viz,cc,devtools.timeline', options: 'record-continuously' });
    }
    let monitor;
    if (process.env.GPU_BUSY_FILE) {
      await page.waitForFunction(() => document.querySelector('#hud-phase')?.textContent.startsWith('TIMED') || location.hash.startsWith('#/result/'), null, { timeout: 120000 });
      readFileSync(process.env.GPU_BUSY_FILE, 'utf8');
      monitor = setInterval(() => {
        try { const n = Number(readFileSync(process.env.GPU_BUSY_FILE, 'utf8')); if (Number.isFinite(n)) gpuBusy.push(n); } catch {}
      }, 500);
      monitor.unref();
    }
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ogb.results.v1') || '[]').length > 0, null, { timeout: 180000 });
    if (monitor) clearInterval(monitor);
    if (traceSession) {
      const complete = new Promise(resolve => traceSession.once('Tracing.tracingComplete', resolve));
      await traceSession.send('Tracing.end');
      await complete;
      writeFileSync(`${process.env.BENCH_TRACE}-${trial}.json`, JSON.stringify({ traceEvents }));
      await traceSession.detach();
    }
    const data = await page.evaluate(() => ({ result: JSON.parse(localStorage.getItem('ogb.results.v1'))[0], pacing: window.benchPacing, presentations: window.benchPresentations, transfers: window.benchTransfers }));
    if (!data.result.valid) throw new Error(`Invalid run: ${data.result.invalidReason}`);
    const times = data.pacing.sort((a, b) => a - b);
    const images = data.presentations.sort((a, b) => a - b);
    const transfers = data.transfers.sort((a, b) => a - b);
    console.log(JSON.stringify({ trial, renderer, layout, bitmapTransferMs: { median: transfers[Math.floor(transfers.length / 2)], p95: transfers[Math.floor(transfers.length * .95)], max: transfers.at(-1) }, presentationCallbackMs: { samples: images.length, median: images[Math.floor(images.length / 2)], p95: images[Math.floor(images.length * 0.95)], max: images.at(-1) }, osGpuBusy: gpuBusy.length ? { samples: gpuBusy.length, min: Math.min(...gpuBusy), mean: gpuBusy.reduce((a, b) => a + b, 0) / gpuBusy.length, max: Math.max(...gpuBusy) } : null, result: data.result, animationCallbackMs: { samples: times.length, median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], max: times.at(-1) } }));
    await page.close();
  }
} finally {
  await browser.close();
}
