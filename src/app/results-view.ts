import { BENCHMARK, CATALOG_SNAPSHOT_DATE, GPU_CATALOG, NOT_LISTED, UPSTREAM_ISSUES, UPSTREAM_REPO, UPSTREAM_TEMPLATES } from "../benchmark/catalog";
import { download, gamesYamlEntry, suggestedFileName, toCsv, toJson, toYaml } from "../benchmark/exporter";
import { VERDICT_LABEL, diagnose, isMaskedRenderer } from "../benchmark/diagnose";
import { round1 } from "../benchmark/metrics";
import { getScoreTest } from "../benchmark/presets";
import { commandsFor } from "../benchmark/sysinfo";
import { LINUX_ONLY_FIELDS, type BenchResult, type SystemInfo } from "../benchmark/types";
import { validateSubmission } from "../benchmark/validate";
import { $, esc } from "./dom";
import { BATCH_MS } from "./env";
import { showView } from "./shell";
import { upsertResult } from "./store";

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

export const TEXT_FIELDS: { key: keyof SystemInfo; label: string; placeholder: string; linux?: boolean; inputmode?: string }[] = [
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

const fmtMs = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : `${x.toFixed(2)} ms`);
const fmtPct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : `${Math.round(x * 100)}%`);

/** "What limited this run": verdict, time breakdown, findings and every raw signal. */
function diagPanel(r: BenchResult): string {
  const dx = diagnose(r);
  const d = r.diag;
  const bar = (cls: string, label: string, v: number | null, title: string) =>
    `<div class="share ${cls}" title="${esc(title)}"><span>${label}</span><span class="bar"><i style="width:${v === null ? 0 : Math.round(v * 100)}%"></i></span><b>${fmtPct(v)}</b></div>`;
  return `<section class="card diag" aria-labelledby="diag-title">
    <h2 id="diag-title"><span class="kana" aria-hidden="true">診断</span>What limited this run</h2>
    <div class="diag-head"><span class="limit-tag v-${dx.verdict}">${esc(VERDICT_LABEL[dx.verdict])}${dx.estimated && dx.verdict !== "unknown" ? " (est.)" : ""}</span><h3>${esc(dx.headline)}</h3></div>
    <p class="diag-detail">${esc(dx.detail)}</p>
    ${
      d
        ? `<div class="share-bars" aria-label="Share of each frame's time">
        ${bar("gpu", "GPU busy", dx.shares.gpu, "Share of the run the GPU spent on our frames (GPU timer queries)")}
        ${bar("js", "Page JavaScript", dx.shares.js, "Scene update and three.js draw submission on the main thread")}
        ${bar("wait", "Waiting for GPU", dx.shares.wait, "Waiting with the GPU queue full: the GPU (or its driver) was behind, which is what a GPU-limited run looks like")}
        ${bar("over", "Browser overhead", dx.shares.overhead, "Event loop, HUD updates and other tasks between batches")}
      </div>
      <p class="muted tiny">Shares of the average ${fmtMs(d.frameMs)} frame. They overlap: the GPU works while JavaScript prepares the next frame. A GPU-limited run shows GPU busy near 100%.</p>`
        : ""
    }
    ${
      dx.findings.length
        ? `<ul class="findings">${dx.findings
            .map((f) => `<li class="${f.severity}"><b>${esc(f.title)}</b><p>${esc(f.detail)}</p>${f.fix ? `<p class="fix">→ ${esc(f.fix)}</p>` : ""}</li>`)
            .join("")}</ul>`
        : ""
    }
    ${
      d
        ? `<details><summary>All measured and detected signals</summary><dl class="hints">
        <dt>GPU time / frame</dt><dd>${fmtMs(d.gpuMs)}</dd>
        <dt>Wall time / frame</dt><dd>${fmtMs(d.frameMs)}</dd>
        <dt>JS time / frame</dt><dd>${fmtMs(d.cpuMs)} (scene update ${fmtMs(d.updateMs)}, draw submission ${fmtMs(Math.max(0, d.cpuMs - d.updateMs))})</dd>
        <dt>GPU wait / frame</dt><dd>${fmtMs(d.syncMs)}</dd>
        <dt>Loop busy</dt><dd>${fmtPct(r.loopBusy)}</dd>
        <dt>Main-thread stalls</dt><dd>${d.stalls} (${fmtMs(d.stallMs)} total)</dd>
        <dt>Hitches</dt><dd>${d.hitches}${d.gpuHitches !== undefined && d.hitches ? ` (${d.gpuHitches} from GPU time, ${Math.max(0, d.hitches - d.gpuHitches)} from frame pacing)` : ""}, frame-time std. dev. ${fmtMs(d.frameStdMs)}</dd>
        <dt>JS heap growth</dt><dd>${d.heapGrowthMb === null ? "n/a" : `${Math.round(d.heapGrowthMb)} MB`}</dd>
        <dt>Timing method</dt><dd>${esc(r.timing ?? "n/a")}</dd>
        <dt>Rendered with</dt><dd>bloom ${d.features.bloom ? "on" : "off"}, MSAA ${d.features.msaa}×, shadow map ${d.features.shadowMap || "off"}, reflections ${d.features.reflections ? `${d.features.reflections}×` : "off"}, volumetric haze ${d.features.volumetrics ? `${d.features.volumetrics} steps` : "off"}</dd>
        <dt>WebGL renderer <em>(detected)</em></dt><dd>${isMaskedRenderer(d.renderer) ? `hidden by the browser ("${esc(d.renderer)}")` : esc(d.renderer)}</dd>
        <dt>WebGL vendor <em>(detected)</em></dt><dd>${isMaskedRenderer(d.renderer) ? "hidden" : esc(d.vendor)}</dd>
        <dt>ANGLE backend <em>(detected)</em></dt><dd>${esc(d.backend || "n/a")}</dd>
        <dt>Max texture size</dt><dd>${d.maxTextureSize}</dd>
        <dt>CPU threads <em>(detected)</em></dt><dd>${d.cpuThreads ?? "n/a"}</dd>
        <dt>On battery <em>(detected)</em></dt><dd>${d.onBattery === null ? "unknown" : d.onBattery ? "yes" : "no"}</dd>
        <dt>Browser <em>(detected)</em></dt><dd>${esc(d.browser)}</dd>
      </dl></details>`
        : ""
    }
  </section>`;
}

export function renderResults(r: BenchResult): void {
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
      <h1 class="sign">Neon Flythrough result</h1>
      <p class="muted">${esc(r.date)} ${esc(r.time)} · v${esc(r.benchmarkVersion)}</p>
    </div>
    ${r.valid ? "" : `<div class="banner-invalid" role="alert"><b>INVALID RUN:</b> ${esc(r.invalidReason)}. Saved locally; it can never be submitted.</div>`}
    ${r.mobile ? `<p class="muted">Mobile run: saved locally and exportable as JSON/CSV. Submissions from phones and tablets aren't accepted yet.</p>` : ""}
    <div class="score-cards">
      ${
        r.score !== undefined
          ? `<div class="score hero-score"><span>${esc(getScoreTest(r.scoreTest)?.name ?? "Score")}</span><b id="res-score">${r.score}</b><span class="score-test">${round1(r.avgFps).toFixed(1)} FPS × 100</span></div>
      <div class="score"><span>Average FPS</span><b id="res-avg">${round1(r.avgFps).toFixed(1)}</b></div>`
          : `<div class="score hero-score"><span>Average FPS</span><b id="res-avg">${round1(r.avgFps).toFixed(1)}</b></div>`
      }
      <div class="score"><span>1% Low FPS</span><b id="res-p1">${round1(r.p1Low).toFixed(1)}</b></div>
      <div class="score small"><span>5% Low FPS</span><b>${round1(r.p5Low).toFixed(1)}</b></div>
      <div class="score small"><span>Worst frame</span><b>${r.worstMs.toFixed(2)} ms</b></div>
      <div class="score small"><span>Frames timed</span><b id="res-frames">${r.frameCount}</b></div>
      <div class="score small"><span>Run settings</span><b class="settings" id="res-settings">${r.scoreTest ? `${esc(getScoreTest(r.scoreTest)?.name ?? r.scoreTest)} · ` : ""}${esc(r.resolution)} (${r.width}×${r.height}) · ${esc(r.preset)} · ${r.durationS} s · ${esc(r.graphicsApi)}</b></div>
    </div>
    ${r.scoreTest && r.score === undefined ? `<p class="muted">Started as ${esc(getScoreTest(r.scoreTest)?.name ?? r.scoreTest)}, but ${r.valid ? "its settings didn't match the locked test" : "the run was invalid"}, so it has no score.</p>` : ""}
    ${diagPanel(r)}
    <p class="muted small-print">Uncapped: frames were rendered back-to-back in ~${BATCH_MS} ms batches, with three batches kept queued on the GPU. Average FPS is frames divided by timed wall-clock. ${r.timing === "gpu-timer" ? "Lows and worst frame use each frame's GPU time from timer queries (or its batch average, if larger)." : r.timing === "batch-avg" ? "No GPU timer was available, so lows and worst frame use each batch's average frame time." : "Each frame was timed from submission to GPU completion."} Loop busy ${(r.loopBusy * 100).toFixed(0)}% of timed wall-clock.</p>

    <div class="results-grid">
      <form class="card sys-form" id="sys-form" autocomplete="off">
        <h2><span class="kana" aria-hidden="true">システム</span>System information</h2>
        <p class="muted">Only you can provide these. Nothing here is guessed or auto-filled; grey text is just an example.</p>
        <label class="field"><span>GPU <em>required</em></span><select name="gpuId">${gpuOptions}</select></label>
        <p class="muted tiny">Catalog snapshot ${esc(CATALOG_SNAPSHOT_DATE)} from <a href="${UPSTREAM_REPO}/tree/main/data/gpus" target="_blank" rel="noopener">open-gpu-benchmarks</a>.</p>
        <div id="gpu-blocked" class="blocked" hidden>
          <b>Your GPU isn't in the catalog yet, so this result can't be submitted.</b>
          Open an <a href="${UPSTREAM_ISSUES}" target="_blank" rel="noopener">issue</a> or a pull request upstream to add it (catalog <a href="${UPSTREAM_TEMPLATES}" target="_blank" rel="noopener">templates/</a>). Once it exists in the catalog, come back to My Results and submit. Please don't submit under a similar GPU. Local save and JSON/CSV export still work.
        </div>
        <label class="field"><span>Operating system <em>required</em></span>
          <select name="os"><option value="">— Select —</option><option value="windows">windows</option><option value="linux">linux</option></select></label>
        <label class="field"><span>GPU overclocked <em>optional</em></span>
          <select name="overclocked"><option value="">— Not saying —</option><option value="no">No, stock clocks and power limit</option><option value="yes">Yes, overclocked or raised power limit</option></select></label>
        <label class="field"><span>Graphics API <em>recorded by the run</em></span><input name="graphicsApi" value="${esc(r.graphicsApi)}" readonly aria-readonly="true" /></label>
        ${TEXT_FIELDS.map(
          (f) =>
            `<label class="field${f.linux ? " linux-only" : ""}"><span>${esc(f.label)} <em>optional${f.linux ? ", Linux only" : ""}</em></span><input name="${f.key}" placeholder="${esc(f.placeholder)}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ""} /></label>`,
        ).join("")}
      </form>

      <div class="card">
        <h2><span class="kana" aria-hidden="true">ヒント</span>Browser hints <span class="muted">(for your eyes only)</span></h2>
        <p class="muted tiny">Reported by the browser, often masked or generic. Never copied into your system fields: use them to help you pick the right values. The run records the renderer, thread count, battery state and browser separately, labelled as detected (see "What limited this run").</p>
        <dl class="hints">
          <dt>WebGL renderer</dt><dd>${esc(hints.renderer)}</dd>
          <dt>Logical CPU threads</dt><dd>${esc(hints.threads)}</dd>
          <dt>User agent</dt><dd>${esc(hints.ua)}</dd>
        </dl>
        <div id="os-cmds"></div>

        <h2><span class="kana" aria-hidden="true">送信</span>Export &amp; submit</h2>
        <div id="val-box" aria-live="polite"></div>
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
