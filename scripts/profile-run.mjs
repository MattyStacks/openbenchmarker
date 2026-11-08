// Run against an already-running local dev server. Machine-specific browser flags stay in env.
// Example: BENCH_URL=http://localhost:5180 PW_CHANNEL=chromium PW_ARGS='...' node scripts/profile-run.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { exec } from 'node:child_process';
// Optional: GPU_BUSY_CMD prints one utilization percentage (e.g. a vendor CLI query); BENCH_QUERY
// appends dev URL params (e.g. 'trace&inflight=3'); BENCH_OUT appends one JSON line per trial;
// BENCH_LABEL tags it. Steady-state statistics skip the first BENCH_SETTLE_S (default 5) timed seconds.
const run = cmd => new Promise(resolve => exec(cmd, { timeout: 2000 }, (e, out) => resolve(e ? NaN : Number(String(out).trim().split(/\s+/)[0]))));
const pct = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;
const summary = list => { const s = [...list].sort((a, b) => a - b); return { n: s.length, median: pct(s, .5), p95: pct(s, .95), p99: pct(s, .99), max: s.at(-1) ?? 0 }; };
const browser = process.env.PW_CDP_URL ? await chromium.connectOverCDP(process.env.PW_CDP_URL) : await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE_PATH || undefined,
  channel: process.env.PW_CHANNEL || 'chromium',
  headless: process.env.BENCH_HEADED !== '1',
  args: process.env.PW_ARGS?.split(/\s+/).filter(Boolean) ?? [],
});
try {
  for (let trial = 0; trial < Number(process.env.BENCH_REPEATS || 3); trial++) {
    const page = await browser.newPage({ viewport: process.env.BENCH_HEADED === '1' ? null : { width: 1280, height: 720 } });
    await page.goto((process.env.BENCH_URL || 'http://localhost:5179') + (process.env.BENCH_QUERY ? `/?${process.env.BENCH_QUERY}` : ''));
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
        if (timed && lastImage) window.benchPresentations.push([now, now - lastImage]);
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
    if (process.env.GPU_BUSY_CMD) {
      await page.waitForFunction(() => document.querySelector('#hud-phase')?.textContent.startsWith('TIMED'), null, { timeout: 120000 });
      const t0 = Date.now();
      let sampling = false;
      monitor = setInterval(async () => {
        if (sampling) return; sampling = true;
        const n = await run(process.env.GPU_BUSY_CMD); sampling = false;
        if (Number.isFinite(n)) gpuBusy.push([(Date.now() - t0) / 1000, n]);
      }, 250);
      monitor.unref();
    } else if (process.env.GPU_BUSY_FILE) {
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
    const data = await page.evaluate(() => ({ result: JSON.parse(localStorage.getItem('ogb.results.v1'))[0], pacing: window.benchPacing, presentations: window.benchPresentations, transfers: window.benchTransfers, trace: window.benchTrace ?? null }));
    if (!data.result.valid) throw new Error(`Invalid run: ${data.result.invalidReason}`);
    const settle = Number(process.env.BENCH_SETTLE_S ?? 5) * 1000;
    const pres = data.presentations;
    const t0 = pres[0]?.[0] ?? 0;
    const steadyPres = pres.filter(([t]) => t - t0 >= settle).map(([, d]) => d);
    const intervals = pres.map(([, d]) => d);
    const med = summary(steadyPres).median || 1;
    // Gaps over time: where long handoff intervals happen (per second of the timed phase).
    const gapsBySecond = {};
    for (const [t, d] of pres) if (d > med * 1.5) { const k = Math.floor((t - t0) / 1000); gapsBySecond[k] = (gapsBySecond[k] || 0) + 1; }
    const busy = gpuBusy.map(x => Array.isArray(x) ? x : [0, x]);
    const busyStats = list => list.length ? { n: list.length, min: Math.min(...list), mean: list.reduce((a, b) => a + b, 0) / list.length, max: Math.max(...list) } : null;
    let traceSummary = null;
    if (data.trace) {
      const shown = data.trace.filter(r => r.timed && r.handoffAt);
      const steady = shown.filter(r => r.handoffAt - (shown[0]?.handoffAt ?? 0) >= settle);
      // Scene-time step vs display step: equal steps mean even motion regardless of callback jitter.
      const sceneJudder = [], late = [], workerQueue = [], gpuDelivery = [], transport = [];
      for (let i = 1; i < steady.length; i++) {
        const a = steady[i - 1], b = steady[i];
        sceneJudder.push(Math.abs((b.sampledAt - a.sampledAt) - (b.handoffAt - a.handoffAt)));
      }
      for (const r of steady) {
        late.push(r.arrivedAt - r.targetAt); workerQueue.push(r.renderedAt - r.receivedAt);
        gpuDelivery.push(r.postedAt - r.renderedAt); transport.push(r.receivedAt - r.sampledAt);
      }
      traceSummary = { handoffs: shown.length, resets: data.trace.filter(r => r.reset).map(r => ({ ...r, reset: r.reset - (shown[0]?.handoffAt ?? r.reset) })),
        sceneMinusDisplayStepMs: summary(sceneJudder), arrivalMinusTargetMs: summary(late), requestToRenderMs: summary(workerQueue),
        renderToPostMs: summary(gpuDelivery), mainToWorkerMs: summary(transport) };
    }
    const out = { label: process.env.BENCH_LABEL || '', query: process.env.BENCH_QUERY || '', trial, renderer,
      renderFps: data.result.avgFps, timerCoverage: data.result.diag?.gpuBusy, gpuMs: data.result.diag?.gpuMs,
      osGpuBusy: busyStats(busy.map(([, n]) => n)), osGpuBusySteady: busyStats(busy.filter(([t]) => t * 1000 >= settle).map(([, n]) => n)),
      handoffWholeMs: summary(intervals), handoffSteadyMs: summary(steadyPres), handoffsPerS: pres.length && pres.at(-1)[0] > t0 ? pres.length * 1000 / (pres.at(-1)[0] - t0) : 0,
      longGapsSteady: { over1_5x: steadyPres.filter(d => d > med * 1.5).length, over2x: steadyPres.filter(d => d > med * 2).length, over50ms: steadyPres.filter(d => d > 50).length },
      gapsBySecond, trace: traceSummary, bitmapTransferMs: summary(data.transfers), animationCallbackMs: summary(data.pacing),
      presentationDiag: data.result.diag?.presentation, layout };
    console.log(JSON.stringify(out));
    if (process.env.BENCH_OUT) appendFileSync(process.env.BENCH_OUT, JSON.stringify({ ...out, osGpuBusySeries: busy, result: data.result }) + '\n');
    await page.close();
  }
} finally {
  await browser.close();
}
