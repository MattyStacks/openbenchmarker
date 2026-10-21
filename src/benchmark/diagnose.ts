import type { BenchResult, RunDiagnostics } from "./types";

// ---------------------------------------------------------------------------
// "What limited this run": a verdict and findings from the signals a browser can measure.
// Pure, so it can be recomputed from any saved result and unit-tested.
// ---------------------------------------------------------------------------

/**
 * gpu: the GPU was busy nearly all the time, so a faster GPU gives more FPS.
 * cpu: one CPU thread, the page's JavaScript (scene update + draw submission), was the bottleneck.
 * driver: neither the GPU nor the page's JS was busy; the time went to the browser's GPU process
 *   or the graphics driver turning draw calls into GPU work (also one CPU thread).
 * WebGL can only feed the GPU from one thread, so a "cpu" or "driver" run can show low total CPU
 * use in Task Manager: one maxed thread is only 1/threads of the total.
 * mixed: GPU and CPU both close to the limit.
 * software: no hardware acceleration; the CPU rendered every pixel.
 * unknown: no GPU timers and no clear proxy.
 */
export type Verdict = "gpu" | "cpu" | "driver" | "mixed" | "software" | "unknown";

export interface Finding {
  severity: "info" | "warn" | "bad";
  title: string;
  detail: string;
  fix?: string;
}

export interface Diagnosis {
  verdict: Verdict;
  /** True when the verdict is inferred without GPU timers. */
  estimated: boolean;
  headline: string;
  detail: string;
  findings: Finding[];
  /** Shares of the average frame's wall-clock time (0-1), for the breakdown bar. */
  shares: { gpu: number | null; js: number; wait: number; overhead: number };
}

export const GPU_BOUND = 0.9;
export const CPU_BOUND = 0.75;

export const VERDICT_LABEL: Record<Verdict, string> = {
  gpu: "GPU-limited",
  cpu: "CPU-limited (1 thread)",
  driver: "Driver-limited (1 thread)",
  mixed: "GPU + CPU",
  software: "Software rendering",
  unknown: "Unknown",
};

const SOFTWARE = /SwiftShader|llvmpipe|softpipe|lavapipe|Microsoft Basic Render|SwANGLE|\bSoftware\b/i;
/** Common integrated GPUs. Apple Silicon is left out: it has no other GPU to switch to. */
const INTEGRATED = /Intel\(R\) (?:UHD|HD|Iris)|Intel.*\b(?:UHD|HD|Iris) Graphics|AMD Radeon\(TM\) Graphics|Radeon\(TM\) \d{3}M\b|Radeon \d{3}M\b|Radeon\(TM\) Vega \d+ Graphics|Mali-|Adreno/i;

export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE.test(renderer);
}

/** Renderer strings that carry no GPU information (privacy masking, e.g. Brave's farbling, or unavailable). */
export function isMaskedRenderer(renderer: string): boolean {
  return /^\s*(?:|unavailable|Brave|WebKit WebGL|Mozilla)\s*$/i.test(renderer);
}

export function isIntegratedRenderer(renderer: string): boolean {
  return INTEGRATED.test(renderer) && !SOFTWARE.test(renderer);
}

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x2C02) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "D3D11". */
export function parseBackend(renderer: string): string {
  const m = /^ANGLE \((.*)\)$/.exec(renderer.trim());
  if (!m) return "";
  const last = m[1].split(",").pop()!.trim();
  if (/^(D3D11|D3D9|Vulkan|OpenGL(?: ES)?|Metal)$/i.test(last)) return last;
  // ANGLE on Vulkan, OpenGL or Metal names the API mid-string and ends with the driver.
  const api = /\b(Vulkan|OpenGL ES|OpenGL|Metal|Direct3D11|Direct3D9)\b/.exec(m[1]);
  return api ? ({ Direct3D11: "D3D11", Direct3D9: "D3D9" } as Record<string, string>)[api[1]] ?? api[1] : "";
}

/** Browser name and major version from a user agent string, e.g. "Chrome 141", "Edge 141", "Firefox 132". */
export function browserName(ua: string): string {
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : "";
  };
  return (
    pick(/Edg\/(\d+)/, "Edge") ||
    pick(/OPR\/(\d+)/, "Opera") ||
    pick(/Firefox\/(\d+)/, "Firefox") ||
    pick(/Chrome\/(\d+)/, "Chrome") ||
    (/Safari\//.test(ua) ? pick(/Version\/(\d+)/, "Safari") : "") ||
    "Unknown"
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Why total CPU use looks low when one thread is the limit. */
function oneThreadNote(threads: number | null): string {
  const share = threads && threads > 1 ? ` (on this ${threads}-thread CPU, one maxed thread is only about ${Math.round(100 / threads)}% of total CPU use)` : "";
  return `Browsers drive the GPU from a single thread, so Task Manager shows low overall CPU use${share} even though that thread was the bottleneck. Single-thread speed matters here, not core count.`;
}
const ms = (x: number) => `${x < 10 ? x.toFixed(2) : x.toFixed(1)} ms`;

function verdictFor(d: RunDiagnostics, loopBusy: number): { verdict: Verdict; estimated: boolean } {
  if (isSoftwareRenderer(d.renderer)) return { verdict: "software", estimated: false };
  const frame = d.frameMs > 0 ? d.frameMs : 1;
  const js = d.cpuMs / frame;
  const wait = d.syncMs / frame;
  if (d.gpuBusy === null) {
    // No timers: a long readback wait means the GPU (or its driver) was behind; busy JS means CPU.
    if (js >= 0.6) return { verdict: "cpu", estimated: true };
    if (wait >= 0.5) return { verdict: "gpu", estimated: true };
    return { verdict: "unknown", estimated: true };
  }
  if (d.gpuBusy >= GPU_BOUND) return { verdict: "gpu", estimated: false };
  if (d.gpuBusy >= CPU_BOUND) return { verdict: "mixed", estimated: false };
  if (js >= 0.5 || 1 - loopBusy >= 0.25) return { verdict: "cpu", estimated: false };
  if (wait >= 0.35) return { verdict: "driver", estimated: false };
  return { verdict: "cpu", estimated: false };
}

export function diagnose(r: BenchResult): Diagnosis {
  const d = r.diag;
  if (!d) {
    return {
      verdict: "unknown",
      estimated: true,
      headline: "No diagnostics for this result",
      detail: "It was recorded before the tool measured what limits a run. Run the benchmark again to get a diagnosis.",
      findings: [],
      shares: { gpu: null, js: 0, wait: 0, overhead: 0 },
    };
  }
  const frame = d.frameMs > 0 ? d.frameMs : 1;
  const shares = {
    gpu: d.gpuBusy,
    js: Math.min(1, d.cpuMs / frame),
    wait: Math.min(1, d.syncMs / frame),
    overhead: Math.max(0, Math.min(1, 1 - r.loopBusy)),
  };
  const { verdict, estimated } = verdictFor(d, r.loopBusy);
  const sceneSplit = `scene update ${ms(d.updateMs)}, draw submission ${ms(Math.max(0, d.cpuMs - d.updateMs))}`;
  const gpuText = d.gpuBusy === null ? "" : ` (GPU busy ${pct(d.gpuBusy)})`;
  let headline = "";
  let detail = "";
  switch (verdict) {
    case "gpu":
      headline = estimated ? "Your GPU was most likely the limit" : `Your GPU was the limit${gpuText}`;
      detail = `A faster or overclocked GPU raises the FPS and score here. The CPU had headroom: the page's JavaScript took ${ms(d.cpuMs)} of each ${ms(d.frameMs)} frame.`;
      break;
    case "cpu":
      headline = `One CPU thread was the limit, not the GPU${gpuText}`;
      detail =
        (shares.js >= 0.5
          ? `Each frame took ${ms(d.frameMs)} and the page's JavaScript used ${ms(d.cpuMs)} of it (${sceneSplit}). A faster GPU won't raise this result much; a CPU with faster single-thread performance will.`
          : `The GPU was waiting, and ${pct(shares.overhead)} of the time went to the browser's event loop between batches rather than rendering. Background tabs, extensions or the browser itself were taking CPU time.`) +
        ` ${oneThreadNote(d.cpuThreads)}`;
      break;
    case "driver":
      headline = `The graphics driver or browser GPU process was the limit${gpuText}`;
      detail = `The GPU was busy only ${pct(d.gpuBusy ?? 0)} and the page's JavaScript only ${pct(shares.js)} of the time, but each frame still waited ${ms(d.syncMs)} on the GPU queue. That time went to the browser's GPU process and the driver turning draw calls into GPU work, which runs on one CPU thread. ${oneThreadNote(d.cpuThreads)}`;
      break;
    case "mixed":
      headline = `GPU and CPU were both close to the limit${gpuText}`;
      detail = `A faster GPU still helps, but only partly: the page's JavaScript took ${ms(d.cpuMs)} of each ${ms(d.frameMs)} frame (${sceneSplit}).`;
      break;
    case "software":
      headline = "Hardware acceleration is off: the CPU drew every frame";
      detail = `The browser rendered with "${d.renderer}", a software renderer, so this result says nothing about your GPU.`;
      break;
    case "unknown":
      headline = "The limit couldn't be measured";
      detail = `This browser (${d.browser}) doesn't expose GPU timer queries, and the other signals weren't clear-cut.`;
      break;
  }
  if (estimated && verdict !== "unknown" && verdict !== "software")
    detail += ` Estimated without GPU timers (${d.browser} doesn't expose them), from the time spent waiting for the GPU (${ms(d.syncMs)} per frame).`;

  const findings: Finding[] = [];
  if (verdict === "software")
    findings.push({
      severity: "bad",
      title: "Software rendering",
      detail: "The scene was drawn on the CPU, so the GPU played no part.",
      fix: "Turn on hardware acceleration in the browser's settings (Chrome/Edge: Settings → System → Use graphics acceleration), restart the browser and check chrome://gpu.",
    });
  if (isIntegratedRenderer(d.renderer))
    findings.push({
      severity: "warn",
      title: "The browser may be using an integrated GPU",
      detail: `The renderer is "${d.renderer}". If this machine also has a dedicated GPU, the browser isn't using it.`,
      fix: "Windows: Settings → System → Display → Graphics, pick your browser, and set it to High performance. Then restart the browser.",
    });
  if (verdict === "cpu" || verdict === "driver") {
    const fix =
      verdict === "driver"
        ? `Update the GPU driver.${d.backend ? ` On Windows you can also try another ANGLE backend in chrome://flags/#use-angle (this run used ${d.backend}).` : ""} To measure the GPU itself, run Score: Extreme or a higher resolution/preset.`
        : "To measure the GPU itself, run Score: Extreme or a higher resolution/preset: more work per frame moves the limit to the GPU.";
    findings.push({
      severity: r.scoreTest === "extreme" ? "warn" : "info",
      title: r.score !== undefined ? "This score is limited by the CPU side" : "This result is limited by the CPU side",
      detail:
        r.score !== undefined
          ? "The score is valid, but it mostly reflects CPU and browser speed. Compare it with GPU-limited scores carefully."
          : "Other machines with the same GPU and a faster CPU will get more FPS on these settings.",
      fix,
    });
  }
  if (d.onBattery)
    findings.push({
      severity: "warn",
      title: "Running on battery",
      detail: "Laptops lower GPU and CPU clocks on battery.",
      fix: "Plug in the charger and choose a performance power mode, then run again.",
    });
  const stallShare = r.durationS > 0 ? d.stallMs / (r.durationS * 1000) : 0;
  if (d.stalls >= 3 || stallShare > 0.01)
    findings.push({
      severity: stallShare > 0.03 ? "warn" : "info",
      title: "Other work interrupted the run",
      detail: `The page's main thread was held up ${d.stalls} time${d.stalls === 1 ? "" : "s"} for ${ms(d.stallMs)} in total by something else: other tabs, extensions, garbage collection or the browser.`,
      fix: "Close other tabs and apps (especially video and games), then run again.",
    });
  if (r.frameCount > 0 && (d.hitches > Math.max(5, r.frameCount * 0.005) || (r.avgFps > 0 && r.p1Low / r.avgFps < 0.5)))
    findings.push({
      severity: "warn",
      title: "Uneven frame pacing",
      detail: `${d.hitches} frame${d.hitches === 1 ? "" : "s"} took over 2.5× the median frame time (and at least 4 ms longer), and the 1% low is ${pct(r.avgFps > 0 ? r.p1Low / r.avgFps : 0)} of the average.`,
      fix: "Stutter that persists across runs often comes from background apps, power-saving clocks or memory pressure. Close other apps and use a performance power plan.",
    });
  if (d.heapGrowthMb !== null && d.heapGrowthMb > 200)
    findings.push({
      severity: "info",
      title: "Memory grew during the run",
      detail: `The page's JavaScript heap grew ${Math.round(d.heapGrowthMb)} MB, which can cause garbage-collection pauses.`,
    });
  if (d.features.fallbackReason)
    findings.push({
      severity: "warn",
      title: "Part of the preset couldn't run",
      detail: d.features.fallbackReason,
      fix: "Update the GPU driver and browser. This result used less work than the preset, so its FPS isn't comparable.",
    });
  if (isMaskedRenderer(d.renderer))
    findings.push({
      severity: "info",
      title: "The browser hid the GPU name",
      detail: `${d.browser} reported "${d.renderer || "nothing"}" instead of the GPU name${d.cpuThreads === null ? " and no reliable CPU thread count" : ""}, so they weren't recorded. Brave does this to block fingerprinting. The measurements themselves aren't affected.`,
      fix: "Optional: in Brave, turn Shields off for this site (or allow fingerprinting) and run again to record the GPU name.",
    });
  if (d.gpuBusy === null && verdict !== "software")
    findings.push({
      severity: "info",
      title: "No GPU timers in this browser",
      detail: `${d.browser} doesn't expose EXT_disjoint_timer_query_webgl2, so GPU busy time can't be measured and the 1% low uses batch averages.`,
      fix: "Chrome or Edge on desktop exposes GPU timers and gives the most detailed diagnosis.",
    });
  return { verdict, estimated, headline, detail, findings, shares };
}

/** Live HUD classification from a rolling GPU-busy estimate. */
export function liveVerdict(gpuBusy: number | null): "gpu" | "cpu" | "mixed" | null {
  if (gpuBusy === null) return null;
  return gpuBusy >= GPU_BOUND ? "gpu" : gpuBusy >= CPU_BOUND ? "mixed" : "cpu";
}
