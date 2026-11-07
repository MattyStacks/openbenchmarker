import * as THREE from 'three';
import { makeFlythrough } from './scenes';
import type { TimedBatch } from '../benchmark/metrics';
import { BatchSizer } from '../benchmark/batch-sizer';
import { WARMUP_SECONDS, STRESS_LAP_SECONDS } from '../benchmark/presets';
import type { WorkerInput, WorkerOutput, WorkerSettings } from './render-worker-protocol';
const scope = self as unknown as { postMessage(message: WorkerOutput, transfer?: Transferable[]): void };
const send = (message: WorkerOutput, transfer?: Transferable[]) => scope.postMessage(message, transfer);
let start: (() => void) | undefined, abort: ((reason: string) => void) | undefined;
const presentations: { sampledAt: number; targetAt: number; targetTick: number; generation: number }[] = [];
self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const m = e.data;
  if (m.type === 'present') { if (presentations[0]?.generation !== m.generation) presentations.length = 0; presentations.push(m); if (presentations.length > 4) presentations.shift(); }
  else if (m.type === 'start') start?.();
  else if (m.type === 'abort') abort?.(m.reason);
  else try { initialize(m.canvas, m.settings); } catch (e) { send({ type: 'error', reason: String(e) }); }
};
function initialize(canvas: OffscreenCanvas, settings: WorkerSettings): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(settings.width, settings.height, false);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const fly = makeFlythrough(renderer, settings.preset, settings.width, settings.height);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const ext = settings.timers ? gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null : null;
  const sizer = new BatchSizer(settings.gpuBatchMs);
  const channel = new MessageChannel();
  // Re-enter through a message task: chaining timer callbacks clamps a requested
  // 1 ms poll to >=4 ms after five nestings, long enough to empty a short GPU queue.
  const wake = () => { if (!stopped) channel.port2.postMessage(0); };
  interface Flight { fence: WebGLSync; images: { image: ImageBitmap; targetAt: number; targetTick: number; generation: number }[]; frames: number; cpuMs: number; updateMs: number; waitMs: number; yieldMs: number; phase: 'warmup' | 'timed' }
  const flights: Flight[] = [], pending: { q: WebGLQuery; frame: number }[] = [], pool: WebGLQuery[] = [];
  const warm: TimedBatch[] = [], timed: TimedBatch[] = [], gpu: { frame: number; ms: number }[] = [], recent: number[] = [], lapStarts: number[] = [];
  let phase: 'warmup' | 'timed' = 'warmup', stopped = false;
  let runStart = 0, timedStart = 0, lastComplete = 0, frames = 0, submitted = 0, batchCount = 0, batchFrames = 1;
  let waitSince = 0, postedAt = 0, lastProgress = 0, lastError = 0;
  function poll(): void {
    if (!ext || !pending.length || !gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const { q } of pending) pool.push(q);
      pending.length = 0; recent.length = 0; return;
    }
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q, frame } = pending.shift()!;
      const ms = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
      if (frame >= 0) gpu.push({ frame, ms });
      recent.push(ms); if (recent.length > 120) recent.shift(); pool.push(q);
    }
  }
  function progress(force = false): void {
    const now = performance.now();
    if (!force && now - lastProgress < 50) return;
    lastProgress = now;
    send({ type: 'progress', sentAt: performance.timeOrigin + now, phase, elapsed: now - runStart, timedStart: timedStart ? timedStart - runStart : 0,
      warm: warm.splice(0), timed: timed.splice(0), gpu: gpu.splice(0), recent: [...recent], frames, lapStarts: [...lapStarts] });
  }
  function complete(list: Flight[], now: number, drainMs = 0): void {
    if (!list.length) return;
    let n = 0, cpuMs = 0, updateMs = 0, syncMs = drainMs, yieldMs = 0;
    for (const f of list) {
      // Keep all requested previews: discarding an earlier completed image here
      // defeats timestamped playout even when throughput exceeds display refresh.
      for (const { image, targetAt, targetTick, generation } of f.images) send({ type: "frame", image, targetAt, targetTick, generation }, [image]);
      n += f.frames; cpuMs += f.cpuMs; updateMs += f.updateMs; syncMs += f.waitMs;
      yieldMs = Math.max(yieldMs, f.yieldMs); gl.deleteSync(f.fence);
    }
    const ms = now - lastComplete; lastComplete = now;
    const batch = { frames: n, ms, cpuMs, updateMs, syncMs, yieldMs, busyMs: Math.min(ms, cpuMs + syncMs) };
    batchFrames = sizer.observe(n, ms, recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null);
    if (list[0].phase === 'warmup') warm.push(batch);
    else {
      timed.push(batch); frames += n; batchCount++;
      if (settings.lapCount && lapStarts.length < settings.lapCount && now >= timedStart + lapStarts.length * STRESS_LAP_SECONDS * 1000) lapStarts.push(batchCount);
    }
  }
  function finish(reason: string): void {
    if (stopped) return;
    stopped = true;
    const deadline = performance.now() + 500;
    const collect = () => {
      try { if (!gl.isContextLost()) poll(); } catch (e) { reason ||= String(e); }
      if (!reason && pending.length && !gl.isContextLost() && performance.now() < deadline) { setTimeout(collect, 0); return; }
      progress(true); send({ type: 'finished', reason });
      channel.port1.close(); channel.port2.close();
      for (const f of flights) { for (const { image } of f.images) image.close(); gl.deleteSync(f.fence); }
      for (const { q } of pending) gl.deleteQuery(q);
      for (const q of pool) gl.deleteQuery(q);
      fly.dispose(); renderer.dispose();
    };
    setTimeout(collect, 0);
  }
  function tick(): void {
    if (stopped) return;
    const tick0 = performance.now(), yieldMs = postedAt ? tick0 - postedAt : 0;
    try {
      poll(); let k = 0;
      while (k < flights.length) {
        const status = gl.clientWaitSync(flights[k].fence, 0, 0);
        if (status === gl.WAIT_FAILED) throw new Error('GPU fence wait failed');
        if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) break;
        k++;
      }
      if (k) complete(flights.splice(0, k), tick0);
      const end = phase === 'warmup' ? runStart + WARMUP_SECONDS * 1000 : timedStart + settings.duration * 1000;
      if (tick0 >= end) {
        // Stop submission and wait for every fence before changing phases. Reading
        // a cleared canvas after bitmap transfer is not a reliable queue drain.
        if (flights.length) { progress(); postedAt = performance.now() + 1; setTimeout(wake, 1); return; }
        if (phase === 'timed') { finish(''); return; }
        timedStart = performance.now(); lastComplete = timedStart; phase = 'timed';
        if (settings.lapCount) lapStarts.push(0);
        progress(true);
      } else if (flights.length < settings.inFlight) {
        let n = 0, cpuMs = 0; fly.timing.updateMs = 0;
        const images: { image: ImageBitmap; targetAt: number; targetTick: number; generation: number }[] = [];
        do {
          const q = ext ? pool.pop() ?? gl.createQuery() : null;
          if (q) gl.beginQuery(ext!.TIME_ELAPSED_EXT, q);
          const c0 = performance.now(), presentation = presentations.shift();
          // Sample preview motion on the display clock, not on variable queue-submission times.
          const sceneT = Math.max(0, ((presentation ? presentation.sampledAt - performance.timeOrigin : c0) - runStart) / 1000);
          fly.render(settings.lapCount ? sceneT % STRESS_LAP_SECONDS : sceneT, undefined, !!presentation);
          if (presentation) images.push({ image: canvas.transferToImageBitmap(), targetAt: presentation.targetAt, targetTick: presentation.targetTick, generation: presentation.generation });
          renderer.setRenderTarget(null); cpuMs += performance.now() - c0;
          if (q) { gl.endQuery(ext!.TIME_ELAPSED_EXT); pending.push({ q, frame: phase === 'timed' ? submitted : -1 }); }
          if (phase === 'timed') submitted++;
          n++;
        } while (n < batchFrames && performance.now() - tick0 < settings.cpuBatchMs && performance.now() < end);
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!fence) throw new Error('Could not create GPU fence');
        gl.flush(); flights.push({ fence, images, phase, frames: n, cpuMs, updateMs: fly.timing.updateMs, waitMs: waitSince ? tick0 - waitSince : 0, yieldMs }); waitSince = 0;
      } else if (!waitSince) waitSince = tick0;
      if (tick0 - lastError > 1000) { lastError = tick0; const e = gl.getError(); if (e !== gl.NO_ERROR) throw new Error(`WebGL error 0x${e.toString(16)}`); }
      progress();
      if (flights.length >= settings.inFlight) { postedAt = performance.now() + 1; setTimeout(wake, 1); }
      else { postedAt = performance.now(); channel.port2.postMessage(0); }
    } catch (e) { finish(`Render error: ${String(e)}`); }
  }
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); finish('WebGL context lost during run'); });
  abort = finish;
  start = () => { runStart = lastComplete = performance.now(); channel.port1.onmessage = tick; channel.port2.postMessage(0); };
  send({ type: 'ready', renderer: String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), vendor: String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR)), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), features: fly.features });
}
