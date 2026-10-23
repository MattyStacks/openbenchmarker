import {
  BENCHMARK,
  CATALOG_SNAPSHOT_DATE,
  CC_BY_DEED,
  DATA_LICENSE,
  GPU_CATALOG,
  NOT_LISTED,
  OGB_SITE,
  UPSTREAM_CATALOG_README,
  UPSTREAM_REPO,
  UPSTREAM_TEMPLATES,
  gpuRequestUrl,
} from "../benchmark/catalog";
import { download, gamesYamlEntry, suggestedFileName, toCsv, toJson, toYaml } from "../benchmark/exporter";
import { VERDICT_LABEL, diagnose, isMaskedRenderer } from "../benchmark/diagnose";
import { round1 } from "../benchmark/metrics";
import { getScoreTest } from "../benchmark/presets";
import { decodeShare, encodeShare, shareBlocker, sharedRunFrom, type SharedRun } from "../benchmark/share-codec";
import { clearPending, pendingCode, setPending } from "./challenge";
import { LABELS, bindCompareBoxes, compareBoxHtml, comparePanelHtml } from "./compare-view";
import { prefillFromShare } from "./home";
import { commandsFor } from "../benchmark/sysinfo";
import { LINUX_ONLY_FIELDS, type BenchResult, type SystemInfo } from "../benchmark/types";
import { validateSubmission } from "../benchmark/validate";
import { $, esc } from "./dom";
import { BATCH_MS } from "./env";
import { deviceLine, gpuLine, isHandheld, runClass } from "./result-display";
import { bindShareBox, sharePayload, shareBoxHtml } from "./share";
import { showView } from "./shell";
import { upsertResult } from "./store";

/**
 * Hints for the system form. From the run's own recorded diagnostics when present, so a desktop
 * result opened on a phone shows the desktop's values; the live probe (a throwaway WebGL context in
 * THIS browser) is only for old results recorded before diagnostics existed.
 */
function hintsFor(r: BenchResult): { source: "run" | "live"; rows: [string, string][] } {
  const d = r.diag;
  if (d)
    return {
      source: "run",
      rows: [
        ["WebGL renderer", isMaskedRenderer(d.renderer) ? `hidden by the browser ("${d.renderer}")` : d.renderer],
        ["Logical CPU threads", d.cpuThreads === null ? "not reported" : String(d.cpuThreads)],
        ["Browser", d.browser],
      ],
    };
  const h = browserHints();
  return { source: "live", rows: [["WebGL renderer", h.renderer], ["Logical CPU threads", h.threads], ["User agent", h.ua]] };
}

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

/** The run this result was compared with ("Set up the same test"), decoded from the saved code. */
function comparedWith(r: BenchResult): SharedRun | null {
  if (!r.challenge) return null;
  const d = decodeShare(r.challenge);
  return d.ok ? d.payload.runs[d.payload.type === "comparison" ? 1 : 0] : null;
}

function comparisonSection(r: BenchResult, other: SharedRun): string {
  if (!r.valid || shareBlocker(sharedRunFrom(r)))
    return `<section class="compare-panel"><h2 class="cmp-title">Side by side</h2><p>This run was invalid, so it can't be compared with the other run (${other.avgFps.toFixed(1)} FPS avg).</p><button type="button" class="btn" data-compare-again>Set up again</button></section>`;
  return comparePanelHtml(
    other,
    sharedRunFrom(r),
    LABELS.shared,
    `<div class="row cmp-actions"><button type="button" class="btn btn-primary" data-share-comparison>Share the comparison</button><button type="button" class="btn" data-share-only>Share this run only</button><span class="share-status" role="status" data-cmp-status></span></div>`,
  );
}

/** "Not now" on the submit nudge: in memory only, so it stays hidden until the page reloads. */
let nudgeDismissed = false;

/** Set by openResult so the page can scroll to a section after it renders. */
let pendingFocus: "submit" | null = null;

/** Open a result page, optionally scrolled to its submit section (My Results' "Submit…"). */
export function openResult(id: string, focus: "submit" | null = null): void {
  pendingFocus = focus;
  const target = `#/result/${encodeURIComponent(id)}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = target;
}

export function renderResults(r: BenchResult): void {
  showView("results");
  const cls = runClass(r);
  const handheld = isHandheld(cls);
  const showSubmit = r.valid && !handheld;
  const dev = [deviceLine(r), gpuLine(r) ? `${gpuLine(r)} (reported by browser)` : ""].filter(Boolean).join(" · ");
  const other = comparedWith(r);
  // The comparison is now on its result: the pending one (this tab) is done.
  if (r.challenge && pendingCode() === r.challenge) clearPending();
  const view = $("#view-results");
  const hints = showSubmit ? hintsFor(r) : null;
  const gpuOptions = [
    `<option value="">— Select your exact GPU —</option>`,
    ...GPU_CATALOG.map((g) => `<option value="${esc(g.id)}">${esc(g.name)} (${esc(g.id)})</option>`),
    `<option value="${NOT_LISTED}">My GPU isn't listed</option>`,
  ].join("");
  view.innerHTML = `
    <div class="results-head">
      <h1 class="sign">Neon Flythrough result</h1>
      <p class="muted">${esc(r.date)} ${esc(r.time)} · v${esc(r.benchmarkVersion)}</p>
      ${dev ? `<p class="result-device">${esc(dev)}</p>` : ""}
    </div>
    ${r.valid ? "" : `<div class="banner-invalid" role="alert"><b>INVALID RUN:</b> ${esc(r.invalidReason)}. Saved locally; it can never be submitted.</div>`}
    ${other ? comparisonSection(r, other) : ""}
    ${other ? `<h2 class="section-title">This run in full</h2>` : ""}
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
    ${r.valid && !shareBlocker(sharedRunFrom(r)) ? shareBoxHtml() : ""}
    ${r.valid && !shareBlocker(sharedRunFrom(r)) ? compareBoxHtml(r) : ""}
    ${r.scoreTest && r.score === undefined ? `<p class="muted">Started as ${esc(getScoreTest(r.scoreTest)?.name ?? r.scoreTest)}, but ${r.valid ? "its settings didn't match the locked test" : "the run was invalid"}, so it has no score.</p>` : ""}
    <details class="result-details" open>
      <summary>Details: what limited this run, timing and export</summary>
      ${diagPanel(r)}
    <p class="muted small-print">Uncapped: frames were rendered back-to-back in ~${BATCH_MS} ms batches, with three batches kept queued on the GPU. Average FPS is frames divided by timed wall-clock. ${r.timing === "gpu-timer" ? "Lows and worst frame use each frame's GPU time from timer queries (or its batch average, if larger)." : r.timing === "batch-avg" ? "No GPU timer was available, so lows and worst frame use each batch's average frame time." : "Each frame was timed from submission to GPU completion."} Loop busy ${(r.loopBusy * 100).toFixed(0)}% of timed wall-clock.</p>
      <div class="row export-row">
        <button type="button" class="btn" id="exp-json">Export JSON</button>
        <button type="button" class="btn" id="exp-csv">Export CSV</button>
      </div>
    </details>

    ${
      handheld && r.valid
        ? `<p class="handheld-note">📱 Phone and tablet runs can be shared, but not submitted: the Open GPU Benchmarks dataset lists desktop and laptop GPUs.</p>
      <p class="explore-link"><a href="${OGB_SITE}" target="_blank" rel="noopener">Explore results on Open GPU Benchmarks →</a></p>`
        : ""
    }
    ${showSubmit ? `<section class="submit-section" id="submit-section" aria-labelledby="submit-title">
    <h2 class="section-title" id="submit-title">Submit to Open GPU Benchmarks</h2>
    ${nudgeDismissed ? "" : `<div class="nudge" id="nudge">
      <p><b>Want to help other people pick a GPU?</b> If you're comfortable, add your result to Open GPU Benchmarks, the free, open dataset this tool feeds. It only takes a few minutes.</p>
      <div class="nudge-actions">
        <button type="button" class="btn btn-primary" data-nudge="submit">Submit your result →</button>
        <a class="btn" href="${OGB_SITE}" target="_blank" rel="noopener">See the charts →</a>
        <button type="button" class="btn" data-nudge="later">Not now</button>
      </div>
    </div>`}
    <div class="results-grid">
      <form class="card sys-form" id="sys-form" autocomplete="off">
        <h2><span class="kana" aria-hidden="true">システム</span>System information</h2>
        <p class="muted">Only you can provide these. Nothing here is guessed or auto-filled; grey text is just an example.</p>
        <label class="field"><span>GPU <em>required</em></span><select name="gpuId">${gpuOptions}</select></label>
        <p class="muted tiny">The catalog is new and growing: ${GPU_CATALOG.length} GPU${GPU_CATALOG.length === 1 ? "" : "s"} as of ${esc(CATALOG_SNAPSHOT_DATE)} (<a href="${UPSTREAM_REPO}/tree/main/data/gpus" target="_blank" rel="noopener">catalog</a>). Don't see yours? Choose "My GPU isn't listed".</p>
        <div id="gpu-blocked" class="blocked" hidden>
          <p><b>Your GPU isn't in the catalog yet — help add it!</b> The catalog is new and growing, and every card added makes the dataset more useful for everyone.</p>
          <div class="blocked-links">
            <p><a class="btn btn-primary" href="${esc(gpuRequestUrl(r.device?.gpuLabel))}" target="_blank" rel="noopener">Request your GPU (open an issue) →</a> <span class="muted tiny">Easiest, no coding needed.</span></p>
            <p><a class="btn" href="${UPSTREAM_TEMPLATES}" target="_blank" rel="noopener">Add it yourself (pull request) →</a> <span class="muted tiny">If you're comfortable with GitHub (<a href="${UPSTREAM_CATALOG_README}" target="_blank" rel="noopener">ID rules</a>).</span></p>
          </div>
          ${r.device?.gpuLabel ? `<p class="muted tiny">Starting point for your request: <b>${esc(r.device.gpuLabel)}</b> (reported by your browser). Edit it on GitHub to the exact card: brand, model and memory.</p>` : ""}
          <p>Once it's listed, you can come back and submit this result. It stays saved in My Results until then.</p>
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
        <p class="muted tiny">${
          hints!.source === "run"
            ? "Recorded by the browser during this run, often masked or generic."
            : "Read from this browser now (this result was recorded before the run saved them), often masked or generic."
        } Never copied into your system fields: use them to help you pick the right values.</p>
        <dl class="hints">${hints!.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        <div id="os-cmds"></div>

        <h2><span class="kana" aria-hidden="true">送信</span>Export &amp; submit</h2>
        <div id="submit-export">
        <div id="val-box" aria-live="polite"></div>
        <div class="row">
          <button type="button" class="btn btn-primary" id="exp-yaml">Download YAML</button>
          <button type="button" class="btn" id="copy-yaml">Copy YAML</button>
        </div>
        <p class="muted tiny why-manual"><b>Why isn't submitting automatic?</b> This site doesn't keep anything. You submit to Open GPU Benchmarks yourself, so you see exactly what's published and decide what goes in it.</p>
        </div>
        <div class="warn-public">
          <p>Submitting is optional, and it's up to you. Your results stay in this browser unless you choose to share, export or submit them.</p>
          <p>If you submit to Open GPU Benchmarks, your result joins a public dataset under the CC BY 4.0 license. That's a common license for open data: anyone can reuse the data as long as they credit the source. <a href="${CC_BY_DEED}" target="_blank" rel="noopener">Read what CC BY 4.0 allows →</a> (<a href="${DATA_LICENSE}" target="_blank" rel="noopener">dataset license</a>)</p>
          <p>Submitted results stay public, so leave any optional field blank if you'd rather not share it. Submissions go through GitHub, so your GitHub username is public on the pull request.</p>
        </div>
        <div id="submit-preview">
        <h3>Submission YAML preview</h3>
        <pre class="yaml" id="yaml-preview"></pre>
        <div id="submit-steps"></div>
        </div>
      </div>
    </div>
    </section>` : ""}
    <p class="about-link"><a href="#/about">About sharing &amp; FAQ →</a></p>`;

  if (other) {
    view.querySelector("[data-share-comparison]")?.addEventListener("click", () => {
      const status = view.querySelector<HTMLElement>("[data-cmp-status]");
      void sharePayload({ type: "comparison", runs: [other, sharedRunFrom(r)] }).done.then((o) => {
        if (status) status.textContent = o === "shared" ? "Shared ✓" : o === "copied" ? "Link and text copied ✓" : o === "failed" ? "Couldn't share here." : "";
      });
    });
    view.querySelector("[data-share-only]")?.addEventListener("click", () => {
      const status = view.querySelector<HTMLElement>("[data-cmp-status]");
      void sharePayload({ type: "result", runs: [sharedRunFrom(r)] }).done.then((o) => {
        if (status) status.textContent = o === "shared" ? "Shared ✓" : o === "copied" ? "Link and text copied ✓" : o === "failed" ? "Couldn't share here." : "";
      });
    });
    view.querySelector("[data-compare-again]")?.addEventListener("click", () => {
      setPending(encodeShare({ type: "challenge", runs: [other] }));
      prefillFromShare(other);
    });
  }
  if (!view.dataset.cmpBound) {
    view.dataset.cmpBound = "1";
    bindCompareBoxes(view);
  }
  const shareBox = view.querySelector<HTMLElement>(".share-box");
  if (shareBox) bindShareBox(shareBox, sharedRunFrom(r));
  $("#exp-json").onclick = () => download(suggestedFileName(r, "json"), toJson(r), "application/json");
  $("#exp-csv").onclick = () => download(suggestedFileName(r, "csv"), toCsv([r]), "text/csv");
  const focus = pendingFocus;
  pendingFocus = null;
  if (!showSubmit) return;

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
    // Not listed: the way to add the GPU replaces the submit controls (no dead-end buttons).
    const notListed = r.system.gpuId === NOT_LISTED;
    $("#gpu-blocked").hidden = !notListed;
    $("#submit-export").hidden = notListed;
    $("#submit-preview").hidden = notListed;
    $("#val-box").innerHTML = ok
      ? `<p class="ok">✓ Ready to submit: all required fields valid.</p>`
      : `<div class="next-step"><b>Add your system details to submit</b> (saving, sharing and export work anyway):<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
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
  view.querySelector("#nudge")?.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-nudge]")?.dataset.nudge;
    if (act === "submit") form.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (act === "later") {
      // Hidden until the page reloads; nothing is stored.
      nudgeDismissed = true;
      $("#nudge").remove();
    }
  });
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
  if (focus === "submit") requestAnimationFrame(() => $("#submit-section").scrollIntoView({ behavior: "smooth", block: "start" }));
}
