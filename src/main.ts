import "./style.css";
import * as THREE from "three";
import {
  BENCHMARK,
  BENCHMARK_VERSION,
  CATALOG_SNAPSHOT_DATE,
  GPU_CATALOG,
  NOT_LISTED,
  UPSTREAM_ISSUES,
  UPSTREAM_REPO,
  UPSTREAM_TEMPLATES,
} from "./benchmark/catalog";
import { download, gamesYamlEntry, suggestedFileName, toCsv, toJson, toYaml } from "./benchmark/exporter";
import { computeStats, liveFps, round1 } from "./benchmark/metrics";
import {
  DURATIONS,
  PRESETS,
  RESOLUTIONS,
  WARMUP_SECONDS,
  getPreset,
  getResolution,
  nativeSize,
  normalizeResolution,
  resolutionLabel,
  type PresetId,
  type ResolutionId,
} from "./benchmark/presets";
import { LINUX_ONLY_FIELDS, emptySystem, type BenchResult, type GraphicsApi, type SystemInfo } from "./benchmark/types";
import { commandsFor } from "./benchmark/sysinfo";
import { missingLabels, validateSubmission } from "./benchmark/validate";
import { makeFlythrough, type Flythrough } from "./engine/scenes";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------------------
// Local history (this browser only)
// ---------------------------------------------------------------------------
const STORE_KEY = "ogb.results.v1";
const CONFIG_KEY = "ogb.config.v1";

function loadHistory(): BenchResult[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map((r) => ({ ...r, resolution: normalizeResolution(r.resolution), system: { ...emptySystem(), ...(r.system || {}) } }))
      : [];
  } catch {
    return [];
  }
}
function saveHistory(list: BenchResult[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: results still shown for this session */
  }
}
let history = loadHistory();
function upsertResult(r: BenchResult): void {
  const i = history.findIndex((x) => x.id === r.id);
  if (i >= 0) history[i] = r;
  else history.unshift(r);
  saveHistory(history);
}

// ---------------------------------------------------------------------------
// Views / routing
// ---------------------------------------------------------------------------
type View = "home" | "run" | "results" | "history";
let running = false;

const TITLES: Record<View, string> = {
  home: "OpenBenchmarker: Free Browser GPU Benchmark",
  run: "Running Neon Flythrough · OpenBenchmarker",
  results: "Result · OpenBenchmarker",
  history: "My Results · OpenBenchmarker",
};

function showView(v: View): void {
  for (const id of ["home", "run", "results", "history"]) $(`#view-${id}`).hidden = id !== v;
  document.title = TITLES[v];
  document.body.dataset.view = v;
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === v));
}

function route(): void {
  if (running) return;
  const h = location.hash;
  const m = h.match(/^#\/result\/(.+)$/);
  if (m) {
    const r = history.find((x) => x.id === decodeURIComponent(m[1]));
    if (r) return renderResults(r);
  }
  if (h === "#/history") return renderHistory();
  showView("home");
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------------------
// Home: configuration (visible immediately, no reveal step)
// ---------------------------------------------------------------------------
interface RunConfig {
  resolution: ResolutionId;
  preset: PresetId;
  duration: number;
}
const native = nativeSize(screen.width, screen.height, window.devicePixelRatio || 1);

function loadConfig(): RunConfig {
  const def: RunConfig = { resolution: "1080p", preset: "High", duration: 60 };
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return {
      resolution: getResolution(c.resolution)?.id ?? def.resolution,
      preset: getPreset(c.preset)?.id ?? def.preset,
      duration: (DURATIONS as readonly number[]).includes(c.duration) ? c.duration : def.duration,
    };
  } catch {
    return def;
  }
}

function buildConfigForm(): void {
  const cfg = loadConfig();
  $<HTMLSelectElement>("#cfg-resolution").innerHTML = RESOLUTIONS.map(
    (r) => `<option value="${r.id}" ${r.id === cfg.resolution ? "selected" : ""}>${r.id === "native" ? `Native (${native.width}×${native.height})` : esc(r.label)}</option>`,
  ).join("");
  $("#cfg-preset").innerHTML = PRESETS.map(
    (p) => `<label><input type="radio" name="preset" value="${p.id}" ${p.id === cfg.preset ? "checked" : ""}/><span>${p.id}</span></label>`,
  ).join("");
  $("#cfg-duration").innerHTML = DURATIONS.map(
    (d) => `<label><input type="radio" name="duration" value="${d}" ${d === cfg.duration ? "checked" : ""}/><span>${d} s</span></label>`,
  ).join("");
  $<HTMLFormElement>("#config").addEventListener("submit", (e) => {
    e.preventDefault();
    if (running) return;
    const fd = new FormData(e.target as HTMLFormElement);
    const c: RunConfig = {
      resolution: fd.get("resolution") as ResolutionId,
      preset: fd.get("preset") as PresetId,
      duration: Number(fd.get("duration")),
    };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    void startRun(c);
  });
}

// ---------------------------------------------------------------------------
// Run controller: warm-up -> timed -> finish, uncapped scheduler
// ---------------------------------------------------------------------------
const BATCH_MS = 28;

function stageMessage(html: string | null): void {
  const el = $("#stage-msg");
  el.hidden = html === null;
  el.innerHTML = html ?? "";
}

/** Phones and tablets, including iPadOS Safari, which reports a desktop Mac user agent. */
function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
const MOBILE = isMobileDevice();

function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): void {
  const host = $("#canvas-host");
  const s = Math.min(host.clientWidth / w, host.clientHeight / h);
  canvas.style.width = `${Math.max(1, Math.floor(w * s))}px`;
  canvas.style.height = `${Math.max(1, Math.floor(h * s))}px`;
}

async function startRun(cfg: RunConfig): Promise<void> {
  running = true;
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
    running = false;
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
    running = false;
    canvas.remove();
    stageMessage(
      `<h3>Could not start the renderer</h3><p>${esc((e as Error).message || e)}</p><p>This browser or GPU may not support WebGL2.</p><button class="btn" data-act="home">Back</button>`,
    );
    return;
  }
  if (fly.features.fallbackReason) console.warn(fly.features.fallbackReason);
  $("#hud-settings").textContent = `${width}×${height} · ${preset.id} · ${cfg.duration} s · ${api}`;

  const px = new Uint8Array(4);
  const timed: number[] = [];
  const warm: number[] = [];
  let phase: "warmup" | "timed" = "warmup";
  let done = false;
  const runStart = performance.now();
  let timedStart = 0;
  let lastStatsAt = 0;
  const now = new Date();

  const channel = new MessageChannel();
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
    const wallMs = timedStart ? performance.now() - timedStart : 0;
    const st = computeStats(timed);
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
      loopBusy: wallMs > 0 ? Math.min(1, st.totalMs / wallMs) : 0,
      valid: reason === "" && st.frames > 0,
      invalidReason: reason || (st.frames > 0 ? "" : "No timed frames recorded"),
      mobile: MOBILE,
      system: emptySystem(),
    };
    upsertResult(result);
    cleanup();
    running = false;
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
  function drawGraph(times: number[]): void {
    const W = graph.width, H = graph.height;
    g2d.clearRect(0, 0, W, H);
    const n = Math.min(times.length, 240);
    let max = 25;
    for (let i = times.length - n; i < times.length; i++) max = Math.max(max, times[i] * 1.15);
    const y60 = H - (16.667 / max) * H;
    g2d.strokeStyle = "rgba(255,255,255,0.35)";
    g2d.setLineDash([4, 4]);
    g2d.beginPath();
    g2d.moveTo(0, y60);
    g2d.lineTo(W, y60);
    g2d.stroke();
    g2d.setLineDash([]);
    g2d.fillStyle = "rgba(255,255,255,0.6)";
    g2d.font = "10px system-ui, sans-serif";
    g2d.fillText(`60 FPS · max ${max.toFixed(0)} ms`, 4, Math.max(10, y60 - 3));
    g2d.strokeStyle = "#22e6ff";
    g2d.lineWidth = 1.5;
    g2d.beginPath();
    for (let i = 0; i < n; i++) {
      const t = times[times.length - n + i];
      const x = (i / 239) * W, y = H - (t / max) * H;
      if (i) g2d.lineTo(x, y);
      else g2d.moveTo(x, y);
    }
    g2d.stroke();
  }

  function updateHud(t: number): void {
    const arr = phase === "timed" ? timed : warm;
    $("#hud-fps").textContent = Math.round(liveFps(arr)).toString();
    if (phase === "warmup") {
      const left = Math.max(0, WARMUP_SECONDS - (t - runStart) / 1000);
      $("#hud-phase").textContent = `WARM-UP ${left.toFixed(1)} s · not counted`;
      $("#hud-bar").style.width = "0%";
    } else {
      const el = (t - timedStart) / 1000;
      $("#hud-phase").textContent = `TIMED ${Math.min(el, cfg.duration).toFixed(1)} / ${cfg.duration} s`;
      $("#hud-bar").style.width = `${Math.min(100, (el / cfg.duration) * 100).toFixed(1)}%`;
      $("#hud-frames").textContent = timed.length.toString();
      if (t - lastStatsAt > 400) {
        lastStatsAt = t;
        const st = computeStats(timed);
        $("#hud-avg").textContent = st.avgFps.toFixed(1);
        $("#hud-p1").textContent = st.p1Low.toFixed(1);
      }
    }
    drawGraph(arr);
  }

  function batch(): void {
    if (done) return;
    const bStart = performance.now();
    let t1 = bStart;
    try {
      do {
        const t0 = performance.now();
        fly.render((t0 - runStart) / 1000);
        renderer.setRenderTarget(null);
        // gl.finish() does not wait for Chrome's GPU process; a 1-pixel readback does.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        t1 = performance.now();
        if (phase === "warmup") {
          warm.push(t1 - t0);
          if (t1 - runStart >= WARMUP_SECONDS * 1000) {
            phase = "timed";
            timedStart = performance.now();
            timedViewportW = window.innerWidth;
          }
        } else {
          timed.push(t1 - t0);
          if (t1 - timedStart >= cfg.duration * 1000) {
            finish("");
            return;
          }
        }
      } while (!done && t1 - bStart < BATCH_MS);
      const err = gl.getError();
      if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) throw new Error(`WebGL error 0x${err.toString(16)}`);
    } catch (e) {
      if (!done) finish(`Render error: ${(e as Error).message || e}`, true);
      return;
    }
    if (done) return;
    updateHud(t1);
    channel.port2.postMessage(0); // yield to input/compositor, no vsync wait
  }
  channel.port1.onmessage = batch;
  $("#hud-phase").textContent = `WARM-UP ${WARMUP_SECONDS.toFixed(1)} s · not counted`;
  channel.port2.postMessage(0);
}

$("#stage-msg").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.act === "home") {
    stageMessage(null);
    location.hash = "#/";
    route();
  }
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function browserHints(): { renderer: string; threads: string; ua: string } {
  let rendererStr = "unavailable";
  try {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl2") || c.getContext("webgl");
    if (g) {
      const ext = g.getExtension("WEBGL_debug_renderer_info");
      rendererStr = String(ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
      g.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    /* ignore */
  }
  return { renderer: rendererStr, threads: String(navigator.hardwareConcurrency ?? "unknown"), ua: navigator.userAgent };
}

const TEXT_FIELDS: { key: keyof SystemInfo; label: string; placeholder: string; linux?: boolean; inputmode?: string }[] = [
  { key: "osDetail", label: "OS version", placeholder: "e.g. Windows 11 Pro 24H2" },
  { key: "cpu", label: "CPU", placeholder: "e.g. AMD Ryzen 7 7800X3D" },
  { key: "memoryGb", label: "Memory (GB, digits only)", placeholder: "e.g. 32", inputmode: "numeric" },
  { key: "memoryType", label: "Memory type", placeholder: "e.g. DDR5-6000" },
  { key: "driver", label: "GPU driver", placeholder: "e.g. 561.09" },
  { key: "distro", label: "Distro", placeholder: "e.g. Fedora", linux: true },
  { key: "kernel", label: "Kernel", placeholder: "e.g. 6.11.4", linux: true },
  { key: "mesa", label: "Mesa", placeholder: "e.g. 24.2.5", linux: true },
  { key: "proton", label: "Proton", placeholder: "e.g. GE-Proton9-20", linux: true },
];

function renderResults(r: BenchResult): void {
  showView("results");
  const hints = browserHints();
  const view = $("#view-results");
  const gpuOptions = [
    `<option value="">— Select your exact GPU —</option>`,
    ...GPU_CATALOG.map((g) => `<option value="${esc(g.id)}">${esc(g.name)} (${esc(g.id)})</option>`),
    `<option value="${NOT_LISTED}">My GPU is not listed</option>`,
  ].join("");
  view.innerHTML = `
    <div class="results-head">
      <h1>Neon Flythrough result</h1>
      <p class="muted">${esc(r.date)} ${esc(r.time)} · v${esc(r.benchmarkVersion)}</p>
    </div>
    ${r.valid ? "" : `<div class="banner-invalid" role="alert"><b>INVALID RUN:</b> ${esc(r.invalidReason)}. Saved locally; it can never be submitted.</div>`}
    ${r.mobile ? `<p class="muted">Mobile run: saved locally and exportable as JSON/CSV. Submissions from phones and tablets aren't accepted yet.</p>` : ""}
    <div class="score-cards">
      <div class="score"><span>Average FPS</span><b id="res-avg">${round1(r.avgFps).toFixed(1)}</b></div>
      <div class="score"><span>1% Low FPS</span><b id="res-p1">${round1(r.p1Low).toFixed(1)}</b></div>
      <div class="score small"><span>5% Low FPS</span><b>${round1(r.p5Low).toFixed(1)}</b></div>
      <div class="score small"><span>Worst frame</span><b>${r.worstMs.toFixed(2)} ms</b></div>
      <div class="score small"><span>Frames timed</span><b id="res-frames">${r.frameCount}</b></div>
      <div class="score small"><span>Run settings</span><b class="settings" id="res-settings">${esc(r.resolution)} (${r.width}×${r.height}) · ${esc(r.preset)} · ${r.durationS} s</b></div>
    </div>
    <p class="muted small-print">Uncapped: frames were rendered back-to-back and each was timed from submission to GPU completion. Loop busy ${(r.loopBusy * 100).toFixed(0)}% of timed wall-clock.</p>

    <div class="results-grid">
      <form class="card sys-form" id="sys-form" autocomplete="off">
        <h2>System information</h2>
        <p class="muted">Only you can provide these. Nothing here is guessed or auto-filled; grey text is just an example.</p>
        <label class="field"><span>GPU <em>required</em></span><select name="gpuId">${gpuOptions}</select></label>
        <p class="muted tiny">Catalog snapshot ${esc(CATALOG_SNAPSHOT_DATE)} from <a href="${UPSTREAM_REPO}/tree/main/data/gpus" target="_blank" rel="noopener">open-gpu-benchmarks</a>.</p>
        <div id="gpu-blocked" class="blocked" hidden>
          <b>Your GPU isn't in the catalog yet, so this result can't be submitted.</b>
          Open an <a href="${UPSTREAM_ISSUES}" target="_blank" rel="noopener">issue</a> or a pull request upstream to add it (catalog <a href="${UPSTREAM_TEMPLATES}" target="_blank" rel="noopener">templates/</a>). Once it exists in the catalog, come back to My Results and submit. Please don't submit under a similar GPU. Local save and JSON/CSV export still work.
        </div>
        <label class="field"><span>Operating system <em>required</em></span>
          <select name="os"><option value="">— Select —</option><option value="windows">windows</option><option value="linux">linux</option></select></label>
        <label class="field"><span>Graphics API <em>recorded by the run</em></span><input name="graphicsApi" value="${esc(r.graphicsApi)}" readonly aria-readonly="true" /></label>
        ${TEXT_FIELDS.map(
          (f) =>
            `<label class="field${f.linux ? " linux-only" : ""}"><span>${esc(f.label)} <em>optional${f.linux ? ", Linux only" : ""}</em></span><input name="${f.key}" placeholder="${esc(f.placeholder)}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ""} /></label>`,
        ).join("")}
      </form>

      <div class="card">
        <h2>Browser hints <span class="muted">(for your eyes only)</span></h2>
        <p class="muted tiny">Reported by the browser, often masked or generic. Never copied into your result: use them to help you pick the right values.</p>
        <dl class="hints">
          <dt>WebGL renderer</dt><dd>${esc(hints.renderer)}</dd>
          <dt>Logical CPU threads</dt><dd>${esc(hints.threads)}</dd>
          <dt>User agent</dt><dd>${esc(hints.ua)}</dd>
        </dl>
        <div id="os-cmds"></div>

        <h2>Export &amp; submit</h2>
        <div id="val-box"></div>
        <div class="row">
          <button type="button" class="btn" id="exp-json">Export JSON</button>
          <button type="button" class="btn" id="exp-csv">Export CSV</button>
          <button type="button" class="btn btn-primary" id="exp-yaml">Download YAML</button>
          <button type="button" class="btn" id="copy-yaml">Copy YAML</button>
        </div>
        <div class="warn-public">
          <b>Submitted data is public forever.</b> Results in open-gpu-benchmarks are released under
          <a href="${UPSTREAM_REPO}/blob/main/data/LICENSE" target="_blank" rel="noopener">CC BY 4.0</a>: anyone can use them for anything, including AI training, and a submission can't be taken back. Only include what you're happy to make public.
        </div>
        <h3>Submission YAML preview</h3>
        <pre class="yaml" id="yaml-preview"></pre>
        <div id="submit-steps"></div>
      </div>
    </div>`;

  const form = $<HTMLFormElement>("#sys-form");
  for (const [k, v] of Object.entries(r.system)) {
    const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = v;
  }
  // Read-only lookup commands for the chosen OS. Shown only; the page never runs them.
  let cmdsOs: string | null = null;
  const renderCommands = () => {
    if (cmdsOs === r.system.os) return;
    cmdsOs = r.system.os;
    const set = commandsFor(r.system.os);
    const fieldLabel = (f: string) => TEXT_FIELDS.find((t) => t.key === f)?.label ?? (f === "gpu" ? "GPU (above)" : f);
    $("#os-cmds").innerHTML = set
      ? `<div class="cmds">
          <h3>Find these values on this ${r.system.os === "windows" ? "PC" : "machine"} <span class="muted">(${esc(set.shell)})</span></h3>
          <p class="muted tiny">${esc(set.howToOpen)} These commands only read information. This page never runs them or reads your system: you copy the values into the fields yourself.</p>
          <div class="cmd"><div class="cmd-head"><b>Everything at once</b><button type="button" class="btn btn-sm" data-copy="all">Copy</button></div><pre>${esc(set.all)}</pre></div>
          ${set.commands
            .map(
              (c, i) => `<div class="cmd"><div class="cmd-head"><b>${esc(c.label)}</b><span class="muted tiny">→ ${esc(fieldLabel(c.field))}</span>${c.command ? `<button type="button" class="btn btn-sm" data-copy="${i}">Copy</button>` : ""}</div>
              ${c.command ? `<pre>${esc(c.command)}</pre>` : ""}${c.note ? `<p class="muted tiny">${esc(c.note)}</p>` : ""}</div>`,
            )
            .join("")}
        </div>`
      : `<p class="muted tiny">Choose an operating system to see commands that look up these values for you.</p>`;
  };
  $("#os-cmds").addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    const set = commandsFor(r.system.os);
    if (!btn || !set) return;
    const text = btn.dataset.copy === "all" ? set.all : set.commands[Number(btn.dataset.copy)].command;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied ✓";
    } catch {
      const pre = btn.closest(".cmd")?.querySelector("pre");
      if (pre) getSelection()?.selectAllChildren(pre);
      btn.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1800);
  });

  const refresh = () => {
    renderCommands();
    const errors = validateSubmission(r);
    const ok = errors.length === 0;
    // Linux-only inputs stay visible once filled, so a windows/linux mix can be seen and fixed.
    form.classList.toggle("show-linux", r.system.os === "linux" || LINUX_ONLY_FIELDS.some((k) => r.system[k].trim()));
    $("#gpu-blocked").hidden = r.system.gpuId !== NOT_LISTED;
    $("#val-box").innerHTML = ok
      ? `<p class="ok">✓ Ready to submit: all required fields valid.</p>`
      : `<div class="errors"><b>Not submittable yet</b> (local save and JSON/CSV still work):<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
    $<HTMLButtonElement>("#exp-yaml").disabled = !ok;
    $<HTMLButtonElement>("#copy-yaml").disabled = !ok;
    const yaml = ok ? toYaml(r) : "";
    $("#yaml-preview").textContent = ok ? yaml : "The YAML appears here once every required field is valid.";
    $("#yaml-preview").classList.toggle("disabled", !ok);
    $("#submit-steps").innerHTML = ok
      ? `<h3>How to submit</h3><ol>
          <li>Open a pull request to <a href="${UPSTREAM_REPO}" target="_blank" rel="noopener">MattyStacks/open-gpu-benchmarks</a> adding <code>data/community/${esc(r.system.gpuId)}/${esc(suggestedFileName(r, "yaml"))}</code> with the YAML above
            (<a target="_blank" rel="noopener" href="${UPSTREAM_REPO}/new/main/data/community/${encodeURIComponent(r.system.gpuId)}?filename=${encodeURIComponent(suggestedFileName(r, "yaml"))}&value=${encodeURIComponent(yaml)}">open GitHub's new-file form</a>).</li>
          <li>If <code>${BENCHMARK.gameId}</code> isn't in <code>data/games.yaml</code> yet, add this entry in the same PR (alphabetical by name):<pre class="yaml">${esc(gamesYamlEntry(Number(r.date.slice(0, 4))))}</pre></li>
          <li>Run <code>python scripts/validate.py results</code> upstream, or let the PR checks run.</li></ol>`
      : "";
  };
  form.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.name in r.system) {
      (r.system as unknown as Record<string, string>)[el.name] = el.value;
      upsertResult(r);
      refresh();
    }
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  $("#exp-json").onclick = () => download(suggestedFileName(r, "json"), toJson(r), "application/json");
  $("#exp-csv").onclick = () => download(suggestedFileName(r, "csv"), toCsv([r]), "text/csv");
  $("#exp-yaml").onclick = () => validateSubmission(r).length === 0 && download(suggestedFileName(r, "yaml"), toYaml(r), "application/x-yaml");
  $("#copy-yaml").onclick = async () => {
    if (validateSubmission(r).length) return;
    try {
      await navigator.clipboard.writeText(toYaml(r));
      $("#copy-yaml").textContent = "Copied ✓";
    } catch {
      $("#copy-yaml").textContent = "Copy failed: select the preview";
    }
  };
  refresh();
}

// ---------------------------------------------------------------------------
// History ("My Results", localStorage only)
// ---------------------------------------------------------------------------
function statusOf(r: BenchResult): { cls: string; text: string } {
  if (!r.valid) return { cls: "bad", text: `Invalid: ${r.invalidReason}` };
  const errs = validateSubmission(r);
  if (errs.length) return { cls: "warn", text: `Local only — missing: ${missingLabels(errs).join(", ")}` };
  return { cls: "good", text: "Ready to submit" };
}

function renderHistory(): void {
  showView("history");
  history = loadHistory();
  const view = $("#view-history");
  view.innerHTML = `
    <div class="results-head"><h1>My Results</h1><p class="muted">Stored only in this browser (localStorage). Clearing site data deletes them.</p></div>
    ${
      history.length
        ? `<div class="row"><button class="btn" id="hist-csv">Export all as CSV</button></div>
        <div class="table-wrap"><table class="history">
          <thead><tr><th>Date</th><th>Resolution</th><th>Preset</th><th>Avg FPS</th><th>1% Low</th><th>Status</th><th></th></tr></thead>
          <tbody>${history
            .map((r) => {
              const s = statusOf(r);
              return `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td>${esc(r.resolution)}</td><td>${esc(r.preset)}</td><td>${round1(r.avgFps).toFixed(1)}</td><td>${round1(r.p1Low).toFixed(1)}</td>
              <td><span class="status ${s.cls}">${esc(s.text)}</span></td>
              <td class="actions"><a class="btn btn-sm" href="#/result/${encodeURIComponent(r.id)}">Open</a><button class="btn btn-sm" data-del="${esc(r.id)}">Delete</button></td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : `<p>No runs yet. <a href="#/">Run the benchmark</a>.</p>`
    }`;
  view.querySelector("#hist-csv")?.addEventListener("click", () => download("openbenchmarker_results.csv", toCsv(history), "text/csv"));
  view.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this result from this browser?")) return;
      history = history.filter((x) => x.id !== b.dataset.del);
      saveHistory(history);
      renderHistory();
    }),
  );
}

buildConfigForm();
if (location.hash === "#/run") location.hash = "#/";
route();
