import * as THREE from "three";
import { BENCHMARK, BENCHMARK_VERSION } from "../benchmark/catalog";
import { browserName, isSoftwareRenderer, liveVerdict, parseBackend } from "../benchmark/diagnose";
import { computeRunStats, graphPoints, liveBatchFps, liveBreakdown, lowFpsSelect, nextBatchFrames, runFrameTimesInto, scoreFor, type TimedBatch } from "../benchmark/metrics";
import { WARMUP_SECONDS, getPreset, getResolution, getScoreTest, matchesScoreTest } from "../benchmark/presets";
import { emptySystem, type BenchResult, type GraphicsApi, type RunDiagnostics } from "../benchmark/types";
import { makeFlythrough, type Flythrough } from "../engine/scenes";
import { $, esc, nextFrame } from "./dom";
import { BATCH_MS, MOBILE } from "./env";
import { drawGraph } from "./hud";
import { route } from "./router";
import { beginRun, endRun, markFinished, setRunPhase } from "./run-guard";
import { detectDeviceContext, detectDeviceContextAsync } from "./share-env";
import { app, showView } from "./shell";
import { upsertResult, type RunConfig } from "./store";

// ---------------------------------------------------------------------------
// Run controller: warm-up -> timed -> finish, uncapped scheduler
// ---------------------------------------------------------------------------
/** Upper bound on waiting for outstanding GPU timer results once rendering has stopped. */
const DRAIN_MS = 500;
/** Resolved GPU timer results kept for the live HUD readout. */
const RECENT_GPU = 120;
/**
 * Batches queued on the GPU at once (WebGL2). Batches are short (BATCH_MS), so three keep at
 * least ~24 ms of work queued against main-thread hiccups (GC, other tabs). The dev
 * server accepts ?inflight=N to compare (1 drains the GPU between batches, like the old loop).
 */
const DEV_PARAMS = new URLSearchParams(import.meta.env.DEV ? location.search : "");
const MAX_IN_FLIGHT = Number(DEV_PARAMS.get("inflight")) || 3;
/** Dev server only: ?batch=MS overrides the batch length, ?present=all draws every frame to the canvas. */
const BATCH = Number(DEV_PARAMS.get("batch")) || BATCH_MS;
const PRESENT_ALL = DEV_PARAMS.get("present") === "all";
/** Dev server only: ?presentHz=N caps how often a frame goes to the canvas (default: every refresh). */
const PRESENT_HZ = Number(DEV_PARAMS.get("presentHz")) || 0;
/** HUD refresh interval, ms. The loop ticks far more often than this while waiting on the GPU. */
const HUD_MS = 50;
/**
 * While the queue is full, the loop sleeps until about SPIN_MS before the oldest batch is due,
 * then polls every task. Another batch is still queued behind it, so the GPU stays fed either
 * way; sleeping just avoids pinning a CPU core (which costs laptops GPU power budget).
 * Browsers round chained short timeouts up to ~4 ms, so the loop only sleeps when the batch is
 * due well after that; otherwise it noticed finished batches late (fake frame-time spikes).
 */
const SPIN_MS = 5;
const MAX_SLEEP_MS = 10;
/** Live 1% low refresh interval, ms. It scans every timed frame, so it runs rarely (O(n), no sort). */
const LIVE_LOWS_MS = 1000;
/** Brave farbles the renderer string ("Brave") and hardwareConcurrency, so neither is recorded. */
const BRAVE = "brave" in navigator;

interface BatteryLike {
  charging: boolean;
}

/** Charging state where the Battery Status API exists (Chromium); null elsewhere or on desktops without one. */
async function onBattery(): Promise<boolean | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return null;
    return !(await nav.getBattery()).charging;
  } catch {
    return null;
  }
}

/** JS heap in use, MB (Chromium only). */
function heapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / 1048576 : null;
}

function rendererInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): { renderer: string; vendor: string } {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    };
  } catch {
    return { renderer: "unavailable", vendor: "unavailable" };
  }
}

function stageMessage(html: string | null): void {
  const el = $("#stage-msg");
  el.hidden = html === null;
  el.innerHTML = html ?? "";
}

function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): void {
  const host = $("#canvas-host");
  const s = Math.min(host.clientWidth / w, host.clientHeight / h);
  canvas.style.width = `${Math.max(1, Math.floor(w * s))}px`;
  canvas.style.height = `${Math.max(1, Math.floor(h * s))}px`;
}

export async function startRun(cfg: RunConfig): Promise<void> {
  app.running = true;
  const preset = getPreset(cfg.preset)!;
  const res = getResolution(cfg.resolution)!;
  const scoreTest = getScoreTest(cfg.scoreTest);
  // Sampled at start and when timing begins; both resolve long before the run ends.
  let battery: boolean | null = null;
  const sampleBattery = () => void onBattery().then((b) => b !== null && (battery = battery === true || b));
  sampleBattery();
  const { width, height, id: resolution } = res;

  // 1) Show the run view FIRST, 2) measure the stage, 3) only then create the WebGL context.
  window.scrollTo(0, 0);
  showView("run");
  $("#hud-phase").textContent = "Building city…";
  $("#hud-bar").style.width = "0%";
  $("#hud-fps").textContent = "0";
  $("#hud-avg").textContent = $("#hud-p1").textContent = "–";
  $("#hud-frames").textContent = "0";
  $("#hud-settings").textContent = `${scoreTest ? `${scoreTest.name} · ` : ""}${width}×${height} · ${preset.id} · ${cfg.duration} s`;
  setLimit(null, "measuring…");
  $("#hud-gpu").textContent = $("#hud-cpu").textContent = "–";
  $<HTMLButtonElement>("#abort").disabled = false;
  stageMessage(null);
  await nextFrame();
  await nextFrame();
  const stage = $("#stage");
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    app.running = false;
    stageMessage(`<p>Stage has no size (${rect.width}×${rect.height}); cannot start.</p><button class="btn" data-act="home">Back</button>`);
    return;
  }

  // Cleared when the run ends in any way; still there on the next load = the OS killed the page.
  beginRun({ resolution, preset: preset.id, duration: cfg.duration, ...(scoreTest ? { scoreTest: scoreTest.id } : {}) });
  const canvas = document.createElement("canvas");
  canvas.className = "bench-canvas";
  $("#canvas-host").replaceChildren(canvas);
  let renderer: THREE.WebGLRenderer;
  let made: THREE.WebGLRenderer | null = null;
  let fly: Flythrough;
  let gl: WebGLRenderingContext | WebGL2RenderingContext;
  let api: GraphicsApi;
  try {
    // No canvas MSAA: every preset renders through the composer, which has its own MSAA, so a
    // multisampled canvas only added a full-screen resolve on every screen update.
    renderer = made = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false); // exact render size; CSS only scales the display
    fitCanvas(canvas, width, height);
    gl = renderer.getContext();
    api = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1";
    fly = makeFlythrough(renderer, preset, width, height);
  } catch (e) {
    app.running = false;
    endRun();
    // Free the context now, so a failed start doesn't hold GPU memory while the message shows.
    if (made) {
      made.dispose();
      made.forceContextLoss();
    }
    canvas.remove();
    stageMessage(
      `<h3>Could not start the renderer</h3><p>${esc((e as Error).message || e)}</p><p>This browser or GPU may not support WebGL2.</p><button class="btn" data-act="home">Back</button>`,
    );
    return;
  }
  if (fly.features.fallbackReason) console.warn(fly.features.fallbackReason);
  setRunPhase("warmup");
  $("#hud-settings").textContent = `${scoreTest ? `${scoreTest.name} · ` : ""}${width}×${height} · ${preset.id} · ${cfg.duration} s · ${api}`;
  const info = rendererInfo(gl);
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
  const software = isSoftwareRenderer(info.renderer);
  // Display/sharing only. The async read (navigator.brave.isBrave(), high-entropy platform) resolves before warm-up ends.
  let device = detectDeviceContext(info.renderer, info.vendor);
  void detectDeviceContextAsync(info.renderer, info.vendor).then((d) => (device = d));

  const px = new Uint8Array(4);
  const timed: TimedBatch[] = [];
  const warm: TimedBatch[] = [];
  /** GPU time per timed frame in submission order; NaN until (or unless) its query result arrives. */
  const gpuMs: number[] = [];
  let timedFrames = 0;
  let batchFrames = 1;
  let phase: "warmup" | "timed" = "warmup";
  let done = false;
  const runStart = performance.now();
  let timedStart = 0;
  let lastStatsAt = 0;
  let postedAt = 0;
  let heapAtTimed: number | null = null;
  /** Ring of the most recently resolved GPU frame times, any phase (live HUD only). */
  const recentGpu: number[] = [];
  const now = new Date();

  const channel = new MessageChannel();

  // Per-frame GPU time via EXT_disjoint_timer_query_webgl2 (WebGL2 only). Results arrive only
  // after control returns to the event loop, so they're polled at the start of each batch.
  const gl2 = api === "WebGL2" ? (gl as WebGL2RenderingContext) : null;
  const timerExt = gl2?.getExtension("EXT_disjoint_timer_query_webgl2") as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null
    | undefined;
  const queryPool: WebGLQuery[] = [];
  /** In submission order; `frame` is the index into gpuMs, or -1 for a warm-up frame. */
  const pending: { q: WebGLQuery; frame: number }[] = [];
  function pollQueries(): void {
    if (!gl2 || !timerExt || pending.length === 0) return;
    let ready = 0;
    while (ready < pending.length && gl2.getQueryParameter(pending[ready].q, gl2.QUERY_RESULT_AVAILABLE)) ready++;
    if (ready === 0) return;
    if (gl2.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      // Timings are unreliable (clock change, context switch): drop every outstanding result.
      for (const p of pending) queryPool.push(p.q);
      pending.length = 0;
      return;
    }
    for (let i = 0; i < ready; i++) {
      const { q, frame } = pending[i];
      const ms = (gl2.getQueryParameter(q, gl2.QUERY_RESULT) as number) / 1e6;
      if (frame >= 0) gpuMs[frame] = ms;
      recentGpu.push(ms);
      queryPool.push(q);
    }
    if (recentGpu.length > RECENT_GPU) recentGpu.splice(0, recentGpu.length - RECENT_GPU);
    pending.splice(0, ready);
  }
  const invalidate = (reason: string) => {
    if (!done) finish(reason);
  };
  const onVisibility = () => document.visibilityState === "hidden" && invalidate("Tab hidden during run");
  // The render size is fixed and CSS only scales the display, so a resize just refits the canvas.
  // It invalidates only once timing has started, and on mobile only when the width changes (rotation):
  // mobile browsers resize the viewport height whenever their address bar or toolbar shows or hides.
  let timedViewportW = 0;
  const onSizeChange = (reason: string) => {
    fitCanvas(canvas, width, height);
    if (phase === "warmup") return;
    if (MOBILE && Math.abs(window.innerWidth - timedViewportW) < 2) return;
    invalidate(reason);
  };
  const onResize = () => onSizeChange("Window resized during run");
  const onLost = (e: Event) => {
    e.preventDefault();
    invalidate("WebGL context lost during run");
  };
  const ro = new ResizeObserver(() => onSizeChange("Stage resized during run"));
  const onAbort = () => invalidate("Aborted by user");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  canvas.addEventListener("webglcontextlost", onLost);
  ro.observe(stage);
  $("#abort").addEventListener("click", onAbort);

  function cleanup(): void {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
    canvas.removeEventListener("webglcontextlost", onLost);
    ro.disconnect();
    $("#abort").removeEventListener("click", onAbort);
    cancelAnimationFrame(rafId);
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    if (gl2) for (const q of [...queryPool, ...pending.map((p) => p.q)]) gl2.deleteQuery(q);
    if (gl2) for (const f of inFlight) if (f.fence) gl2.deleteSync(f.fence);
    try {
      fly.dispose();
    } catch (e) {
      console.warn("dispose failed", e);
    }
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  function finish(reason: string, keepStage = false): void {
    done = true;
    if (reason || !gl2 || !timerExt || pending.length === 0) {
      finalize(reason, keepStage);
      return;
    }
    // Rendering has stopped; collect outstanding GPU timer results over a few tasks.
    $("#hud-phase").textContent = "Collecting GPU timings…";
    const drainEnd = performance.now() + DRAIN_MS;
    const drain = () => {
      if (!gl.isContextLost()) pollQueries();
      if (pending.length && !gl.isContextLost() && performance.now() < drainEnd) setTimeout(drain, 0);
      else finalize("", false);
    };
    setTimeout(drain, 0);
  }

  function finalize(reason: string, keepStage: boolean): void {
    endRun();
    const st = computeRunStats(timed, gpuMs);
    const heapEnd = heapMb();
    const diag: RunDiagnostics = {
      gpuBusy: st.gpuBusy,
      gpuMs: st.gpuMsPerFrame,
      cpuMs: st.cpuMsPerFrame,
      updateMs: st.updateMsPerFrame,
      syncMs: st.syncMsPerFrame,
      frameMs: st.avgFps > 0 ? 1000 / st.avgFps : 0,
      stalls: st.stalls,
      stallMs: st.stallMs,
      hitches: st.hitches,
      gpuHitches: st.gpuHitches,
      frameStdMs: st.frameStdMs,
      heapGrowthMb: heapAtTimed !== null && heapEnd !== null ? heapEnd - heapAtTimed : null,
      renderer: info.renderer,
      vendor: info.vendor,
      backend: parseBackend(info.renderer),
      maxTextureSize,
      cpuThreads: BRAVE ? null : navigator.hardwareConcurrency || null,
      onBattery: battery,
      browser: BRAVE ? browserName(navigator.userAgent).replace(/^Chrome/, "Brave") : browserName(navigator.userAgent),
      features: {
        bloom: fly.features.bloom,
        msaa: fly.features.msaa,
        shadowMap: fly.features.shadows ? fly.features.shadowMap : 0,
        reflections: fly.features.reflections ? preset.reflections : 0,
        volumetrics: fly.features.volumetrics,
        fallbackReason: fly.features.fallbackReason,
      },
    };
    const valid = reason === "" && st.frames > 0;
    const scored = valid && scoreTest && matchesScoreTest(scoreTest, preset.id, res.id, width, height, cfg.duration);
    const result: BenchResult = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      gameId: BENCHMARK.gameId,
      benchmarkVersion: BENCHMARK_VERSION,
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      resolutionId: res.id,
      resolution,
      width,
      height,
      preset: preset.id,
      durationS: cfg.duration,
      graphicsApi: api,
      avgFps: st.avgFps,
      p1Low: st.p1Low,
      p5Low: st.p5Low,
      worstMs: st.worstMs,
      frameCount: st.frames,
      loopBusy: st.loopBusy,
      timing: st.timing,
      valid,
      invalidReason: reason || (st.frames > 0 ? "" : "No timed frames recorded"),
      mobile: MOBILE,
      ...(scoreTest ? { scoreTest: scoreTest.id } : {}),
      ...(scored ? { score: scoreFor(st.avgFps) } : {}),
      diag,
      device,
      system: emptySystem(),
    };
    upsertResult(result);
    if (valid) markFinished(resolution, preset.id);
    cleanup();
    app.running = false;
    if (keepStage) {
      stageMessage(
        `<h3>Rendering failed</h3><p>${esc(reason)}</p><p>The run was marked invalid.</p><div class="row"><a class="btn" href="#/result/${encodeURIComponent(result.id)}">View invalid result</a><a class="btn" href="#/">Back</a></div>`,
      );
    } else {
      location.hash = `#/result/${encodeURIComponent(result.id)}`;
      route();
    }
  }

  let lastLimitAt = 0;
  let liveTimes: Float64Array = new Float64Array(0);
  const graph = $<HTMLCanvasElement>("#hud-graph");
  const g2d = graph.getContext("2d")!;

  function updateHud(t: number): void {
    const arr = phase === "timed" ? timed : warm;
    $("#hud-fps").textContent = Math.round(liveBatchFps(arr)).toString();
    if (t - lastLimitAt > 400) {
      lastLimitAt = t;
      let gpuMean: number | null = null;
      if (recentGpu.length) gpuMean = recentGpu.reduce((a, b) => a + b, 0) / recentGpu.length;
      const live = liveBreakdown(arr, gpuMean);
      if (live.frameMs > 0) {
        $("#hud-gpu").textContent = gpuMean === null ? "n/a" : `${gpuMean.toFixed(1)} ms`;
        $("#hud-cpu").textContent = `${live.cpuMs.toFixed(1)} ms`;
        if (software) setLimit("software", "");
        else setLimit(liveVerdict(live.gpuBusy), live.gpuBusy === null ? "no GPU timer" : `${Math.round(live.gpuBusy * 100)}% busy`);
      }
    }
    if (phase === "warmup") {
      const left = Math.max(0, WARMUP_SECONDS - (t - runStart) / 1000);
      $("#hud-phase").textContent = `WARM-UP ${left.toFixed(1)} s · not counted`;
      $("#hud-bar").style.width = "0%";
    } else {
      const el = (t - timedStart) / 1000;
      $("#hud-phase").textContent = `TIMED ${Math.min(el, cfg.duration).toFixed(1)} / ${cfg.duration} s`;
      $("#hud-bar").style.width = `${Math.min(100, (el / cfg.duration) * 100).toFixed(1)}%`;
      $("#hud-frames").textContent = timedFrames.toString();
      // Keep this cheap: the GPU queue holds only ~2 batches, so a long main-thread task here
      // starves it (a full sort of every frame time grew to ~100 ms on 300k-frame runs).
      if (timedFrames > 0 && lastComplete > timedStart) $("#hud-avg").textContent = ((timedFrames * 1000) / (lastComplete - timedStart)).toFixed(1);
      if (t - lastStatsAt > LIVE_LOWS_MS) {
        lastStatsAt = t;
        const r = runFrameTimesInto(timed, gpuMs, liveTimes);
        liveTimes = r.out;
        $("#hud-p1").textContent = lowFpsSelect(liveTimes, r.n, 0.01).toFixed(1);
      }
    }
    drawGraph(graph, g2d, graphPoints(arr));
  }

  // Frames are submitted back-to-back with no per-frame sync, in batches of about BATCH_MS.
  // WebGL2: batches are pipelined. Each ends with a fence, and up to MAX_IN_FLIGHT batches are
  // queued on the GPU, so when one finishes the next is already waiting and the GPU never idles
  // while the page updates the HUD, yields, or builds the next frame. Fence status only updates
  // between tasks, so the loop yields (MessageChannel, no vsync wait) and polls on every tick.
  // A batch's interval runs from the previous batch's completion to its own, so intervals
  // partition the timed wall-clock. Phase changes drain the queue with a blocking 1-pixel
  // readback (gl.finish() doesn't wait in Chrome; readPixels does), so each frame's
  // warm-up/timed membership is fixed when it is submitted and timing starts on an idle GPU.
  // WebGL1 has no fences: every batch is drained with a readback, as before.
  interface InFlight {
    fence: WebGLSync | null;
    phase: "warmup" | "timed";
    frames: number;
    cpuMs: number;
    updateMs: number;
    /** Time spent waiting with the queue full before this batch could be submitted. */
    waitMs: number;
    yieldMs: number;
  }
  const inFlight: InFlight[] = [];
  // Present at most once per display refresh: the first frame after each animation frame goes to
  // the canvas, the rest end offscreen with the same GPU work. Drawing every frame to the canvas
  // made the browser's own screen updates contend with the benchmark on the GPU when frames took
  // about one refresh interval (stutter, GPU-time spikes, lost FPS).
  let presentDue = true;
  let rafId = 0;
  let lastPresentAt = 0;
  const onRaf = (now: number) => {
    // Allow 2 ms of refresh jitter so e.g. 60 Hz on a 120 Hz display is every other refresh.
    if (!PRESENT_HZ || now - lastPresentAt >= 1000 / PRESENT_HZ - 2) {
      presentDue = true;
      lastPresentAt = now;
    }
    rafId = requestAnimationFrame(onRaf);
  };
  rafId = requestAnimationFrame(onRaf);
  let lastComplete = 0;
  let waitSince = 0;
  let timedSubmitted = 0;
  let lastErrorCheck = 0;
  let lastHudAt = 0;
  /** Wall-clock per frame of the last finished batch, for estimating when the next one is due. */
  let lastFrameMs = 0;

  /** Record finished batches as one interval ending at `t` (several can finish within one tick). */
  function complete(list: InFlight[], t: number, drainMs = 0): void {
    if (list.length === 0) return;
    let frames = 0, cpuMs = 0, updateMs = 0, waitMs = drainMs, yieldMs = 0;
    for (const f of list) {
      frames += f.frames;
      cpuMs += f.cpuMs;
      updateMs += f.updateMs;
      waitMs += f.waitMs;
      yieldMs = Math.max(yieldMs, f.yieldMs);
      if (f.fence) gl2!.deleteSync(f.fence);
    }
    const ms = t - lastComplete;
    lastComplete = t;
    lastFrameMs = ms / frames;
    const b: TimedBatch = { frames, ms, busyMs: Math.min(ms, cpuMs + waitMs), cpuMs, updateMs, syncMs: waitMs, yieldMs };
    batchFrames = nextBatchFrames(Math.max(1, Math.round(frames / list.length)), ms / list.length, BATCH);
    if (list[0].phase === "warmup") warm.push(b);
    else {
      timed.push(b);
      timedFrames += frames;
    }
  }

  /** Block until the GPU has finished everything queued, then retire it all. */
  function drain(): number {
    const s0 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = performance.now();
    complete(inFlight.splice(0), t, t - s0);
    checkError();
    return t;
  }

  function checkError(): void {
    const err = gl.getError();
    if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL error 0x${err.toString(16)}`);
  }

  function submit(tick0: number, yieldMs: number, phaseEnd: number): void {
    let n = 0;
    let cpuMs = 0;
    fly.timing.updateMs = 0;
    let t = tick0;
    do {
      let q: WebGLQuery | null = null;
      if (gl2 && timerExt) {
        q = queryPool.pop() ?? gl2.createQuery();
        if (q) gl2.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
      }
      const f0 = performance.now();
      fly.render((t - runStart) / 1000, undefined, presentDue || PRESENT_ALL);
      presentDue = false;
      renderer.setRenderTarget(null);
      cpuMs += performance.now() - f0;
      if (phase === "timed") gpuMs.push(NaN);
      if (q) {
        gl2!.endQuery(timerExt!.TIME_ELAPSED_EXT);
        pending.push({ q, frame: phase === "timed" ? timedSubmitted : -1 });
      }
      if (phase === "timed") timedSubmitted++;
      n++;
      t = performance.now();
    } while (n < batchFrames && t - tick0 < BATCH && t < phaseEnd);
    const fence = gl2 ? gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    inFlight.push({ fence, phase, frames: n, cpuMs, updateMs: fly.timing.updateMs, waitMs: waitSince ? tick0 - waitSince : 0, yieldMs });
    waitSince = 0;
  }

  function tick(): void {
    if (done) return;
    const tick0 = performance.now();
    if (!lastComplete) lastComplete = tick0;
    const yieldMs = postedAt ? Math.max(0, tick0 - postedAt) : 0;
    try {
      pollQueries();
      // Retire batches the GPU has finished.
      let k = 0;
      while (k < inFlight.length && inFlight[k].fence && gl2!.getSyncParameter(inFlight[k].fence!, gl2!.SYNC_STATUS) === gl2!.SIGNALED) k++;
      if (k) complete(inFlight.splice(0, k), tick0);

      const phaseEnd = phase === "warmup" ? runStart + WARMUP_SECONDS * 1000 : timedStart + cfg.duration * 1000;
      if (tick0 >= phaseEnd) {
        if (phase === "warmup") setRunPhase("timed"); // in the uncounted warm-up tail, before the drain
        const t = drain();
        if (phase === "timed") {
          finish("");
          return;
        }
        phase = "timed";
        timedStart = t; // the readback just emptied the queue
        lastComplete = t;
        timedViewportW = window.innerWidth;
        heapAtTimed = heapMb();
        sampleBattery();
      } else if (inFlight.length < (gl2 ? MAX_IN_FLIGHT : 1)) {
        submit(tick0, yieldMs, phaseEnd);
        if (!gl2) drain();
      } else if (!waitSince) waitSince = tick0;
      if (tick0 - lastErrorCheck > 1000) {
        lastErrorCheck = tick0;
        checkError();
      }
    } catch (e) {
      if (!done) finish(`Render error: ${(e as Error).message || e}`, true);
      return;
    }
    if (done) return;
    const t = performance.now();
    if (t - lastHudAt > HUD_MS) {
      lastHudAt = t;
      updateHud(t);
    }
    // postedAt is when this tick should run, so a late tick shows up as a stall.
    if (gl2 && inFlight.length >= MAX_IN_FLIGHT && lastFrameMs > 0) {
      const now = performance.now();
      const eta = lastComplete + lastFrameMs * inFlight[0].frames - now;
      if (eta > SPIN_MS + 2) {
        const sleep = Math.min(MAX_SLEEP_MS, Math.floor(eta - SPIN_MS));
        postedAt = now + sleep;
        setTimeout(tick, sleep);
        return;
      }
    }
    postedAt = performance.now();
    channel.port2.postMessage(0); // yield to input/compositor, no vsync wait
  }
  channel.port1.onmessage = tick;
  $("#hud-phase").textContent = `WARM-UP ${WARMUP_SECONDS.toFixed(1)} s · not counted`;
  channel.port2.postMessage(0);
}

/** Live "LIMIT" chip in the HUD. */
function setLimit(v: "gpu" | "cpu" | "mixed" | "software" | null, sub: string): void {
  const el = $("#hud-limit");
  el.dataset.v = v === "software" ? "cpu" : (v ?? "");
  const label = { gpu: "GPU", cpu: "CPU", mixed: "GPU + CPU", software: "SOFTWARE RENDERING" }[v ?? "gpu"];
  el.textContent = `LIMIT · ${v ? label : "?"}${sub ? ` · ${sub}` : ""}`;
}

export function bindStageMessage(): void {
  $("#stage-msg").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.act === "home") {
      stageMessage(null);
      location.hash = "#/";
      route();
    }
  });
}
