// Dev-only: measure real GPU cost per preset, resolution and setting, for rebalancing the presets.
// Loaded from main.ts only when import.meta.env.DEV is true, so production builds drop it.
// URL: /?lab  (optionally &only=matrix|variants|systems|cand; &quick = Low/720p only, few frames,
// for headless smoke tests; &frames=N frames per sample point, default 15). Candidate presets to
// try, each measured at every resolution:
//   &cand=Low:bloom=0.4;rain=4000|Extreme:volumetrics=32   (or &cand=...&res=720p,4K)
// Needs EXT_disjoint_timer_query_webgl2 (Chrome/Edge on desktop). Copy the JSON at the end.
import * as THREE from "three";
import { BENCHMARK_VERSION } from "../benchmark/catalog";
import { browserName } from "../benchmark/diagnose";
import { PRESETS, RESOLUTIONS, getPreset, getResolution, type Preset } from "../benchmark/presets";
import { makeFlythrough, type Flythrough } from "../engine/scenes";

/** Scene times sampled across the 60 s score segment (t = 3..63). */
const SAMPLES = [5, 13, 21, 29, 37, 45, 53, 61];
const QUICK = new URLSearchParams(location.search).has("quick");
const FRAMES_PER_SAMPLE = QUICK ? 2 : Number(new URLSearchParams(location.search).get("frames")) || 15;
const WARM_FRAMES = QUICK ? 2 : 20;
const SYSTEMS = ["sky", "atmosphere", "towers", "signs", "rain", "traffic", "drones", "fx"];

interface Measure {
  /** Mean GPU time per frame (timer queries), ms. */
  gpuMs: number;
  /** Mean JS time per frame (scene update + draw submission), ms. */
  cpuMs: number;
  /** Mean GPU ms per sampled scene time, showing how load varies along the flight. */
  bySample: number[];
  /** Slowest single frame's GPU time, ms (spikes the averages hide). */
  maxMs: number;
}

interface Row {
  kind: "matrix" | "variant" | "system" | "cand";
  name: string;
  preset: string;
  resolution: string;
  build_ms: number;
  gpu_ms: number;
  cpu_ms: number;
  est_fps: number;
  by_sample: number[];
  max_gpu_ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runLab(): void {
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  document.body.replaceChildren();
  document.body.style.cssText = "margin:0;background:#0a0620;color:#eee;font:13px ui-monospace,Menlo,Consolas,monospace";
  const ui = document.createElement("div");
  ui.style.cssText = "padding:16px;max-width:1100px";
  ui.innerHTML = `<h2 style="margin:0 0 8px">Preset lab</h2>
    <p>Measures GPU time per frame with timer queries on this GPU. Keep this tab in front and the browser idle; it takes a few minutes.</p>
    <button id="go" style="font:inherit;padding:6px 14px">Start</button> <span id="st"></span>
    <table id="tb" style="border-collapse:collapse;margin-top:12px"></table>
    <p><button id="cp" style="font:inherit;padding:6px 14px" hidden>Copy JSON</button></p>
    <textarea id="out" rows="12" style="width:100%;display:none;background:#111;color:#ddd"></textarea>`;
  document.body.append(ui);
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;right:8px;bottom:8px;width:320px;height:180px;border:1px solid #444";
  document.body.append(canvas);
  const st = ui.querySelector<HTMLSpanElement>("#st")!;
  const tb = ui.querySelector<HTMLTableElement>("#tb")!;
  tb.innerHTML = `<tr>${["kind", "name", "res", "GPU ms", "CPU ms", "est FPS", "min–max GPU ms"].map((h) => `<th style="text-align:left;padding:2px 10px">${h}</th>`).join("")}</tr>`;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  if (!ext) {
    st.textContent = "This browser has no EXT_disjoint_timer_query_webgl2; use Chrome or Edge on desktop.";
    return;
  }
  const px = new Uint8Array(4);

  async function measure(fly: Flythrough): Promise<Measure> {
    for (let i = 0; i < WARM_FRAMES; i++) fly.render(SAMPLES[0] + i / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let attempt = 0; attempt < 3; attempt++) {
      const queries: { q: WebGLQuery; s: number }[] = [];
      let cpu = 0;
      for (let s = 0; s < SAMPLES.length; s++) {
        for (let i = 0; i < FRAMES_PER_SAMPLE; i++) {
          const qq = gl.createQuery()!;
          gl.beginQuery(ext!.TIME_ELAPSED_EXT, qq);
          const c0 = performance.now();
          fly.render(SAMPLES[s] + i / 60);
          renderer.setRenderTarget(null);
          cpu += performance.now() - c0;
          gl.endQuery(ext!.TIME_ELAPSED_EXT);
          queries.push({ q: qq, s });
        }
        await sleep(0); // let the browser breathe between samples
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const end = performance.now() + 3000;
      while (!gl.getQueryParameter(queries[queries.length - 1].q, gl.QUERY_RESULT_AVAILABLE) && performance.now() < end) await sleep(5);
      const disjoint = gl.getParameter(ext!.GPU_DISJOINT_EXT);
      let maxMs = 0;
      const sums = SAMPLES.map(() => 0),
        counts = SAMPLES.map(() => 0);
      for (const { q: qq, s } of queries) {
        if (!disjoint && gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) {
          const ms = (gl.getQueryParameter(qq, gl.QUERY_RESULT) as number) / 1e6;
          sums[s] += ms;
          maxMs = Math.max(maxMs, ms);
          counts[s]++;
        }
        gl.deleteQuery(qq);
      }
      const n = counts.reduce((a, b) => a + b, 0);
      if (disjoint || n < queries.length * 0.9) continue; // clock change or lost results: retry
      const bySample = sums.map((x, i) => (counts[i] ? x / counts[i] : NaN));
      return {
        gpuMs: sums.reduce((a, b) => a + b, 0) / n,
        cpuMs: cpu / queries.length,
        bySample,
        maxMs,
      };
    }
    throw new Error("GPU timer results were disjoint or missing three times");
  }

  const rows: Row[] = [];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  function addRow(kind: Row["kind"], name: string, preset: string, resolution: string, buildMs: number, m: Measure): void {
    const row: Row = {
      kind,
      name,
      preset,
      resolution,
      build_ms: Math.round(buildMs),
      gpu_ms: r2(m.gpuMs),
      cpu_ms: r2(m.cpuMs),
      est_fps: Math.round(1000 / Math.max(m.gpuMs, m.cpuMs)),
      by_sample: m.bySample.map(r2),
      max_gpu_ms: r2(m.maxMs),
    };
    rows.push(row);
    const ok = m.bySample.filter(Number.isFinite);
    const tr = document.createElement("tr");
    tr.innerHTML = [
      kind,
      name,
      resolution,
      row.gpu_ms.toFixed(2),
      row.cpu_ms.toFixed(2),
      String(row.est_fps),
      `${Math.min(...ok).toFixed(2)}–${Math.max(...ok).toFixed(2)}`,
    ]
      .map((c) => `<td style="padding:2px 10px">${c}</td>`)
      .join("");
    tb.append(tr);
  }

  async function config(preset: Preset, resId: string): Promise<{ fly: Flythrough; buildMs: number }> {
    const res = getResolution(resId)!;
    renderer.setSize(res.width, res.height, false);
    const b0 = performance.now();
    const fly = makeFlythrough(renderer, preset, res.width, res.height);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const buildMs = performance.now() - b0;
    if (fly.features.fallbackReason) throw new Error(fly.features.fallbackReason);
    await sleep(50);
    return { fly, buildMs };
  }

  const ext4k = getPreset(QUICK ? "Low" : "Extreme")!;
  const res4k = QUICK ? "720p" : "4K";
  const variants: [string, Partial<Preset>][] = [
    ["base", {}],
    ["msaa 4", { msaa: 4 }],
    ["msaa 0", { msaa: 0 }],
    ["shadow 2048", { shadowMap: 2048 }],
    ...(maxTex >= 8192 ? ([["shadow 8192", { shadowMap: 8192 }]] as [string, Partial<Preset>][]) : []),
    ["reflections 0", { reflections: 0 }],
    ["reflections 0.5", { reflections: 0.5 }],
    ["bloom off", { bloom: 0 }],
    ["rain 0", { rain: 0 }],
    ["rain x2", { rain: ext4k.rain * 2 }],
    ["rain x4", { rain: ext4k.rain * 4 }],
    ["lightShafts x2", { lightShafts: ext4k.lightShafts * 2 }],
    ["volumetrics 8", { volumetrics: 8 }],
    ["volumetrics 16", { volumetrics: 16 }],
    ["volumetrics 32", { volumetrics: 32 }],
    ["volumetrics 48", { volumetrics: 48 }],
  ];

  /** "Low:bloom=0.4;rain=4000|Extreme:volumetrics=32" -> [name, preset] pairs. */
  const cands: [string, Preset][] = (q.get("cand") ?? "")
    .split("|")
    .filter(Boolean)
    .map((c) => {
      const [id, sets = ""] = c.split(":");
      const over = Object.fromEntries(
        sets
          .split(";")
          .filter(Boolean)
          .map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])]),
      );
      const p = getPreset(id);
      if (!p) throw new Error(`Unknown preset in cand: ${id}`);
      return [`${id} ${sets}`.trim(), { ...p, ...over }];
    });
  const candRes = q.get("res") ? q.get("res")!.split(",") : RESOLUTIONS.map((r) => r.id);

  async function run(): Promise<void> {
    const t0 = performance.now();
    // With candidates, only they run unless &only= asks for more.
    const all = !only && !cands.length;
    if (all || only === "matrix")
      for (const p of QUICK ? PRESETS.slice(0, 1) : PRESETS)
        for (const r of QUICK ? RESOLUTIONS.slice(0, 1) : RESOLUTIONS) {
          st.textContent = `matrix: ${p.id} @ ${r.id}…`;
          const { fly, buildMs } = await config(p, r.id);
          addRow("matrix", p.id, p.id, r.id, buildMs, await measure(fly));
          fly.dispose();
        }
    if (!only || only === "cand")
      for (const [name, p] of cands)
        for (const r of candRes) {
          st.textContent = `candidate: ${name} @ ${r}…`;
          const { fly, buildMs } = await config(p, r);
          addRow("cand", name, p.id, r, buildMs, await measure(fly));
          fly.dispose();
        }
    if (all || only === "variants")
      for (const [name, over] of variants) {
        st.textContent = `Extreme 4K variant: ${name}…`;
        const { fly, buildMs } = await config({ ...ext4k, ...over }, res4k);
        addRow("variant", name, ext4k.id, res4k, buildMs, await measure(fly));
        fly.dispose();
      }
    if (all || only === "systems") {
      st.textContent = "Extreme 4K: cost of each system…";
      const { fly, buildMs } = await config(ext4k, res4k);
      const full = await measure(fly);
      addRow("system", "all", ext4k.id, res4k, buildMs, full);
      for (const s of SYSTEMS) {
        const g = fly.scene.getObjectByName(s);
        if (!g) continue;
        g.visible = false;
        const m = await measure(fly);
        g.visible = true;
        // Cost of the system = full - without it.
        addRow("system", `${s} (cost)`, ext4k.id, res4k, 0, {
          gpuMs: full.gpuMs - m.gpuMs,
          cpuMs: full.cpuMs - m.cpuMs,
          bySample: m.bySample.map((x, i) => full.bySample[i] - x),
          maxMs: m.maxMs,
        });
      }
      fly.dispose();
    }
    finishOut(t0);
  }

  function finishOut(t0: number): void {
    const out = ui.querySelector<HTMLTextAreaElement>("#out")!;
    out.value = JSON.stringify(
      {
        lab: 1,
        version: BENCHMARK_VERSION,
        renderer: rendererName,
        browser: browserName(navigator.userAgent),
        max_texture: maxTex,
        samples: SAMPLES,
        minutes: r2((performance.now() - t0) / 60000),
        rows,
      },
      null,
      0,
    ).replace(/\},\{/g, "},\n{");
    out.style.display = "block";
    const cp = ui.querySelector<HTMLButtonElement>("#cp")!;
    cp.hidden = false;
    cp.onclick = () => void navigator.clipboard.writeText(out.value).then(() => (cp.textContent = "Copied"));
    st.textContent = "Done. Copy the JSON and paste it back.";
  }

  ui.querySelector<HTMLButtonElement>("#go")!.onclick = (e) => {
    (e.target as HTMLButtonElement).disabled = true;
    run().catch((err) => (st.textContent = `Failed: ${(err as Error).message}`));
  };
}
