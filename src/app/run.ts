import * as THREE from "three";
import { BENCHMARK, BENCHMARK_VERSION } from "../benchmark/catalog";
import { computeRunStats, liveBatchFps, nextBatchFrames, type TimedBatch } from "../benchmark/metrics";
import { WARMUP_SECONDS, getPreset, getResolution, resolutionLabel } from "../benchmark/presets";
import { emptySystem, type BenchResult, type GraphicsApi } from "../benchmark/types";
import { makeFlythrough, type Flythrough } from "../engine/scenes";
import { $, esc, nextFrame } from "./dom";
import { BATCH_MS, MOBILE, native } from "./env";
import { drawGraph } from "./hud";
import { route } from "./router";
import { app, showView } from "./shell";
import { upsertResult, type RunConfig } from "./store";

// ---------------------------------------------------------------------------
// Run controller: warm-up -> timed -> finish, uncapped scheduler
// ---------------------------------------------------------------------------
/** Upper bound on waiting for outstanding GPU timer results once rendering has stopped. */
const DRAIN_MS = 500;

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
  const width = res.id === "native" ? native.width : res.width;
  const height = res.id === "native" ? native.height : res.height;
  const resolution = resolutionLabel(res.id, width, height);

  // 1) Show the run view FIRST, 2) measure the stage, 3) only then create the WebGL context.
  window.scrollTo(0, 0);
  showView("run");
  $("#hud-phase").textContent = "Building city…";
  $("#hud-bar").style.width = "0%";
  $("#hud-fps").textContent = "0";
  $("#hud-avg").textContent = $("#hud-p1").textContent = "–";
  $("#hud-frames").textContent = "0";
  $("#hud-settings").textContent = `${width}×${height} · ${preset.id} · ${cfg.duration} s`;
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

  const canvas = document.createElement("canvas");
  canvas.className = "bench-canvas";
  $("#canvas-host").replaceChildren(canvas);
  let renderer: THREE.WebGLRenderer;
  let fly: Flythrough;
  let gl: WebGLRenderingContext | WebGL2RenderingContext;
  let api: GraphicsApi;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false); // exact render size; CSS only scales the display
    fitCanvas(canvas, width, height);
    gl = renderer.getContext();
    api = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1";
    fly = makeFlythrough(renderer, preset, width, height);
  } catch (e) {
    app.running = false;
    canvas.remove();
    stageMessage(
      `<h3>Could not start the renderer</h3><p>${esc((e as Error).message || e)}</p><p>This browser or GPU may not support WebGL2.</p><button class="btn" data-act="home">Back</button>`,
    );
    return;
  }
  if (fly.features.fallbackReason) console.warn(fly.features.fallbackReason);
  $("#hud-settings").textContent = `${width}×${height} · ${preset.id} · ${cfg.duration} s · ${api}`;

  const px = new Uint8Array(4);
  const timed: TimedBatch[] = [];
  const warm: TimedBatch[] = [];
  /** GPU time per timed frame in submission order; NaN until (or unless) its query result arrives. */
  const gpuMs: number[] = [];
  let timedFrames = 0;
  let batchFrames = 1;
  let lastReadback = 0;
  let phase: "warmup" | "timed" = "warmup";
  let done = false;
  const runStart = performance.now();
  let timedStart = 0;
  let lastStatsAt = 0;
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
    if (gl2.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      // Timings are unreliable (clock change, context switch): drop every outstanding result.
      for (const p of pending) queryPool.push(p.q);
      pending.length = 0;
      return;
    }
    for (let i = 0; i < ready; i++) {
      const { q, frame } = pending[i];
      if (frame >= 0) gpuMs[frame] = (gl2.getQueryParameter(q, gl2.QUERY_RESULT) as number) / 1e6;
      queryPool.push(q);
    }
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
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    if (gl2) for (const q of [...queryPool, ...pending.map((p) => p.q)]) gl2.deleteQuery(q);
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
    const st = computeRunStats(timed, gpuMs);
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
      valid: reason === "" && st.frames > 0,
      invalidReason: reason || (st.frames > 0 ? "" : "No timed frames recorded"),
      mobile: MOBILE,
      system: emptySystem(),
    };
    upsertResult(result);
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

  const graph = $<HTMLCanvasElement>("#hud-graph");
  const g2d = graph.getContext("2d")!;

  function updateHud(t: number): void {
    const arr = phase === "timed" ? timed : warm;
    $("#hud-fps").textContent = Math.round(liveBatchFps(arr)).toString();
    if (phase === "warmup") {
      const left = Math.max(0, WARMUP_SECONDS - (t - runStart) / 1000);
      $("#hud-phase").textContent = `WARM-UP ${left.toFixed(1)} s · not counted`;
      $("#hud-bar").style.width = "0%";
    } else {
      const el = (t - timedStart) / 1000;
      $("#hud-phase").textContent = `TIMED ${Math.min(el, cfg.duration).toFixed(1)} / ${cfg.duration} s`;
      $("#hud-bar").style.width = `${Math.min(100, (el / cfg.duration) * 100).toFixed(1)}%`;
      $("#hud-frames").textContent = timedFrames.toString();
      if (t - lastStatsAt > 400) {
        lastStatsAt = t;
        const st = computeRunStats(timed, gpuMs);
        $("#hud-avg").textContent = st.avgFps.toFixed(1);
        $("#hud-p1").textContent = st.p1Low.toFixed(1);
      }
    }
    drawGraph(graph, g2d, arr.map((b) => b.ms / b.frames)); // per-batch average frame time
  }

  // Frames are submitted back-to-back with no per-frame sync, so the GPU never idles while
  // three.js builds the next frame. One 1-pixel readback per batch (gl.finish() does not wait
  // for Chrome's GPU process; readPixels does) keeps the queue at most one batch deep.
  // Phase changes and the end of the run happen only at batch boundaries, right after the
  // readback, so every frame's warm-up/timed membership is fixed when it is submitted.
  function batch(): void {
    if (done) return;
    const bStart = performance.now();
    if (!lastReadback) lastReadback = bStart;
    let n = 0;
    try {
      pollQueries();
      const phaseEnd = phase === "warmup" ? runStart + WARMUP_SECONDS * 1000 : timedStart + cfg.duration * 1000;
      let t = bStart;
      do {
        let q: WebGLQuery | null = null;
        if (gl2 && timerExt) {
          q = queryPool.pop() ?? gl2.createQuery();
          if (q) gl2.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
        }
        fly.render((t - runStart) / 1000);
        renderer.setRenderTarget(null);
        if (q) {
          gl2!.endQuery(timerExt!.TIME_ELAPSED_EXT);
          pending.push({ q, frame: phase === "timed" ? timedFrames + n : -1 });
        }
        n++;
        t = performance.now();
      } while (n < batchFrames && t - bStart < BATCH_MS && t < phaseEnd);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const err = gl.getError();
      if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL error 0x${err.toString(16)}`);
    } catch (e) {
      if (!done) finish(`Render error: ${(e as Error).message || e}`, true);
      return;
    }
    if (done) return;
    const tEnd = performance.now();
    const b: TimedBatch = { frames: n, ms: tEnd - lastReadback, busyMs: tEnd - bStart };
    lastReadback = tEnd;
    batchFrames = nextBatchFrames(n, b.busyMs, BATCH_MS);
    if (phase === "warmup") {
      warm.push(b);
      if (tEnd - runStart >= WARMUP_SECONDS * 1000) {
        phase = "timed";
        timedStart = tEnd; // queue is empty: the readback just drained it
        timedViewportW = window.innerWidth;
      }
    } else {
      timed.push(b);
      for (let i = 0; i < n; i++) gpuMs.push(NaN);
      timedFrames += n;
      if (tEnd - timedStart >= cfg.duration * 1000) {
        finish("");
        return;
      }
    }
    updateHud(tEnd);
    channel.port2.postMessage(0); // yield to input/compositor, no vsync wait
  }
  channel.port1.onmessage = batch;
  $("#hud-phase").textContent = `WARM-UP ${WARMUP_SECONDS.toFixed(1)} s · not counted`;
  channel.port2.postMessage(0);
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
