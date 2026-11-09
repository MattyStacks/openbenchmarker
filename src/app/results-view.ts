import {
  BENCHMARK,
  CC_BY_DEED,
  DATA_LICENSE,
  NOT_LISTED,
  OGB_SITE,
  UPSTREAM_CATALOG_README,
  UPSTREAM_REPO,
  UPSTREAM_TEMPLATES,
} from "../benchmark/catalog";
import { download, gamesYamlEntry, suggestedFileName, toCsv, toDraftYaml, toJson, toYaml } from "../benchmark/exporter";
import { VERDICT_LABEL, diagnose, isMaskedRenderer } from "../benchmark/diagnose";
import { round1 } from "../benchmark/metrics";
import { getScoreTest, getStressTest } from "../benchmark/presets";
import { decodeShare, encodeShare, shareBlocker, sharedRunFrom, type SharedRun } from "../benchmark/share-codec";
import { clearPending, pendingCode, setPending } from "./challenge";
import { LABELS, bindCompareBoxes, compareBoxHtml, comparePanelHtml } from "./compare-view";
import { prefillFromShare } from "./home";
import { catalogFile } from "../benchmark/gpu-id";
import { submittedGpuId } from "../benchmark/fields";
import { applyGuesses } from "../benchmark/guess";
import type { BenchResult } from "../benchmark/types";
import { missingLabels, submissionWarnings, validateSubmission } from "../benchmark/validate";
import { $, esc } from "./dom";
import { BATCH_MS } from "./env";
import { deviceLine, gpuLine, isPhoneOrTablet, runClass } from "./result-display";
import { bindShareBox, sharePayload, shareBoxHtml } from "./share";
import { showView } from "./shell";
import { completedStress, lapsSectionHtml, stressCardsHtml } from "./stress-view";
import { upsertResult } from "./store";
import { bindSystemForm, systemFormHtml } from "./system-form";

const fmtMs = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : `${x.toFixed(2)} ms`);
const fmtPct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "n/a" : `${Math.round(x * 100)}%`);

/** The extra browser signals the form's guesses came from (recorded since 4.1), for the signals list. */
function probeRows(r: BenchResult): string {
  const p = r.probe;
  if (!p) return "";
  const rows: [string, string][] = [
    ["Platform version", p.platformVersion || "not reported"],
    ["Device memory", p.deviceMemoryGb ? `${p.deviceMemoryGb} GB or more (rounded down by the browser)` : "not reported"],
    ["Screen", p.screen ? `${p.screen.width}×${p.screen.height} at ${p.screen.dpr}×` : "not reported"],
    ["Battery", p.battery ? (p.battery.charging && p.battery.level === 1 ? "none, or full and charging" : `${Math.round(p.battery.level * 100)}%, ${p.battery.charging ? "charging" : "on battery"}`) : "not reported"],
    ["WebGPU adapter", p.webgpu ? [p.webgpu.vendor, p.webgpu.architecture, p.webgpu.description].filter(Boolean).join(" · ") || "available, unnamed" : "not available"],
  ];
  return rows.map(([k, v]) => `<dt>${esc(k)} <em>(detected)</em></dt><dd>${esc(v)}</dd>`).join("");
}

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
        ${bar("gpu", "GPU time coverage", dx.shares.gpu, "Share of the run the GPU spent on our frames (GPU timer queries)")}
        ${bar("js", "Render JavaScript", dx.shares.js, "Scene update and three.js draw submission on the rendering thread")}
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
        ${d.renderThread ? `<dt>Rendering</dt><dd>${d.renderThread === "worker" ? "Dedicated worker" : "Main thread (compatibility path)"}</dd>` : ""}
        ${d.presentation ? `<dt>Preview delivery</dt><dd>${d.presentation.fps.toFixed(1)} images/s; interval p95 ${fmtMs(d.presentation.p95Ms)}, max ${fmtMs(d.presentation.maxMs)}. Canvas handoffs, not monitor scanout.</dd>` : ""}
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
        ${probeRows(r)}
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
  const phone = isPhoneOrTablet(cls);
  const stress = getStressTest(r.stressTest);
  const stressDone = completedStress(r);
  const lapFps = (r.laps ?? []).map((l) => l.avgFps);
  // Stress tests show stability; they aren't submitted to the dataset.
  const showSubmit = r.valid && !phone && !stress;
  const dev = [deviceLine(r), gpuLine(r) ? `${gpuLine(r)} (reported by browser)` : ""].filter(Boolean).join(" · ");
  const other = comparedWith(r);
  // The comparison is now on its result: the pending one (this tab) is done.
  if (r.challenge && pendingCode() === r.challenge) clearPending();
  const view = $("#view-results");
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
        stressDone
          ? stressCardsHtml(stressDone, lapFps, round1(r.avgFps))
          : r.score !== undefined
          ? `<div class="score hero-score"><span>${esc(getScoreTest(r.scoreTest)?.name ?? "Score")}</span><b id="res-score">${r.score}</b><span class="score-test">${round1(r.avgFps).toFixed(1)} FPS × 100</span></div>
      <div class="score"><span>Average FPS</span><b id="res-avg">${round1(r.avgFps).toFixed(1)}</b></div>`
          : `<div class="score hero-score"><span>Average FPS</span><b id="res-avg">${round1(r.avgFps).toFixed(1)}</b></div>`
      }
      <div class="score"><span>1% Low FPS</span><b id="res-p1">${round1(r.p1Low).toFixed(1)}</b></div>
      <div class="score small"><span>5% Low FPS</span><b>${round1(r.p5Low).toFixed(1)}</b></div>
      <div class="score small"><span>Worst frame</span><b>${r.worstMs.toFixed(2)} ms</b></div>
      <div class="score small"><span>Frames timed</span><b id="res-frames">${r.frameCount}</b></div>
      <div class="score small"><span>Run settings</span><b class="settings" id="res-settings">${r.scoreTest ? `${esc(getScoreTest(r.scoreTest)?.name ?? r.scoreTest)} · ` : ""}${stress ? `${esc(stress.name)} · ` : ""}${esc(r.resolution)} (${r.width}×${r.height}) · ${esc(r.preset)} · ${stress ? `${lapFps.length} laps · ` : ""}${r.durationS} s · ${esc(r.graphicsApi)}</b></div>
    </div>
    ${r.valid && !shareBlocker(sharedRunFrom(r)) ? shareBoxHtml() : ""}
    ${stress && !stressDone ? `<p class="muted">Started as ${esc(stress.name)}, but ${r.valid ? "its settings didn't match the locked test" : "the run was invalid"}. ${lapFps.length} of ${stress.laps} laps finished, so it has no stability result.</p>` : ""}
    ${stress ? lapsSectionHtml(lapFps, (r.laps ?? []).map((l) => l.p1Low), !!r.diag && diagnose(r).verdict === "cpu", !!stressDone) : ""}
    ${r.scoreTest && r.score === undefined ? `<p class="muted">Started as ${esc(getScoreTest(r.scoreTest)?.name ?? r.scoreTest)}, but ${r.valid ? "its settings didn't match the locked test" : "the run was invalid"}, so it has no score.</p>` : ""}
    <details class="result-details" open>
      <summary>Details: what limited this run, timing and export</summary>
      ${diagPanel(r)}
    <p class="muted small-print">Uncapped: frames were rendered back-to-back in ~${BATCH_MS} ms batches, with three batches kept queued on the GPU. Average FPS is frames divided by timed wall-clock. ${r.timing === "gpu-timer" ? "Lows and worst frame use each frame's GPU time from timer queries (or its batch average, if larger)." : r.timing === "batch-avg" ? "No GPU timer was available, so lows and worst frame use each batch's average frame time." : "Each frame was timed from submission to GPU completion."} Loop busy ${(r.loopBusy * 100).toFixed(0)}% of timed wall-clock.</p>
      <div class="row export-row">
        <button type="button" class="btn" id="exp-json">Export JSON</button>
        <button type="button" class="btn" id="exp-csv">Export CSV</button>
        ${showSubmit || !r.valid ? "" : `<button type="button" class="btn" id="draft-yaml">Download YAML</button><button type="button" class="btn" id="copy-report">Copy YAML</button><span class="muted tiny" id="copy-report-status" role="status"></span>`}
      </div>
    </details>
    ${r.valid && !shareBlocker(sharedRunFrom(r)) ? compareBoxHtml(r) : ""}

    ${
      phone && r.valid
        ? `<p class="handheld-note">📱 Phone and tablet runs can be shared, but not submitted: the Open GPU Benchmarks dataset lists desktop, laptop and handheld PCs.</p>
      <p class="explore-link"><a href="${OGB_SITE}" target="_blank" rel="noopener">Explore results on Open GPU Benchmarks →</a></p>`
        : ""
    }
    ${stress && r.valid && !phone ? `<p class="handheld-note">Stress tests show stability, so they aren't submitted to Open GPU Benchmarks. To submit, run a score run or a custom run.</p>` : ""}
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
      ${systemFormHtml(r)}

      <div class="card submit-card">
        <h2><span class="kana" aria-hidden="true">送信</span>Download &amp; submit</h2>
        <div id="submit-export">
        <div id="val-box" aria-live="polite"></div>
        <div class="row">
          <button type="button" class="btn btn-primary" id="exp-yaml">Download YAML</button>
          <button type="button" class="btn" id="copy-yaml">Copy YAML</button>
        </div>
        <p class="muted tiny">Not submitting? The YAML keeps this result with your details, and My Results can download all of them at once.</p>
        </div>
        <div id="submit-steps"></div>
        <details class="yaml-details"><summary id="yaml-summary">YAML preview</summary><pre class="yaml" id="yaml-preview"></pre></details>
        <details class="publish-details"><summary>What submitting means</summary>
          <p class="muted tiny why-manual"><b>Why isn't submitting automatic?</b> This site doesn't keep anything. You submit to Open GPU Benchmarks yourself, so you see exactly what's published and decide what goes in it.</p>
          <div class="warn-public">
            <p>Submitting is optional, and it's up to you. Your results stay in this browser unless you choose to share, export or submit them.</p>
            <p>If you submit to Open GPU Benchmarks, your result joins a public dataset under the CC BY 4.0 license. That's a common license for open data: anyone can reuse the data as long as they credit the source. <a href="${CC_BY_DEED}" target="_blank" rel="noopener">Read what CC BY 4.0 allows →</a> (<a href="${DATA_LICENSE}" target="_blank" rel="noopener">dataset license</a>)</p>
            <p>Submitted results stay public, so leave any optional field blank if you'd rather not share it. Submissions go through GitHub, so your GitHub username is public on the pull request.</p>
          </div>
        </details>
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
  if (shareBox) bindShareBox(shareBox, () => sharedRunFrom(r));
  $("#exp-json").onclick = () => download(suggestedFileName(r, "json"), toJson(r), "application/json");
  $("#exp-csv").onclick = () => download(suggestedFileName(r, "csv"), toCsv([r]), "text/csv");
  // Results that aren't submitted here (phones, stress tests): the same YAML layout, saying what's missing.
  const draft = view.querySelector<HTMLButtonElement>("#draft-yaml");
  if (draft) draft.onclick = () => download(suggestedFileName(r, "yaml"), toDraftYaml(r), "application/x-yaml");
  const report = view.querySelector<HTMLButtonElement>("#copy-report");
  // Plain HTTP (LAN testing) has no clipboard: download it instead.
  if (report)
    report.onclick = async () => {
      try {
        await navigator.clipboard.writeText(toDraftYaml(r));
        $("#copy-report-status").textContent = "Copied ✓";
      } catch {
        download(suggestedFileName(r, "yaml"), toDraftYaml(r), "application/x-yaml");
      }
    };
  const focus = pendingFocus;
  pendingFocus = null;
  if (!showSubmit) return;

  const form = $<HTMLFormElement>("#sys-form");
  // Guesses for a result saved before they existed (or an old version); a no-op once applied.
  if (!r.guessed) {
    Object.assign(r, applyGuesses(r));
    upsertResult(r);
  }
  const sysForm = bindSystemForm(form, r, () => saveEdit());

  const refresh = () => {
    sysForm.refresh();
    const errors = validateSubmission(r);
    const ok = errors.length === 0;
    const notListed = r.system.gpuId === NOT_LISTED;
    const warnings = ok ? submissionWarnings(r) : [];
    $("#val-box").innerHTML = ok
      ? warnings.length
        ? `<div class="warn-box" role="note"><b>⚠ Submitting may fail.</b><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><p class="tiny">Your result is saved either way; the YAML is ready below.</p></div>`
        : `<p class="ok">✓ Ready to submit.</p>`
      : `<div class="next-step"><b>Not ready to submit yet</b>: ${esc(missingLabels(errors).join(", "))} still needed. You can download the YAML now and finish it later.</div>`;
    const yaml = ok ? toYaml(r) : toDraftYaml(r);
    const gpuId = submittedGpuId(r.system);
    const ff = r.system.gpuFormFactor;
    const gpuFile = notListed && (ff === "desktop" || ff === "laptop" || ff === "handheld") ? catalogFile(gpuId, r.system.gpuName, ff) : null;
    $("#yaml-summary").textContent = ok ? "YAML preview" : "YAML preview (draft, not ready to submit)";
    $("#yaml-preview").textContent = yaml;
    $("#submit-steps").innerHTML = ok
      ? `<h3>How to submit</h3><ol>
          ${
            notListed
              ? gpuFile
                ? `<li>Your GPU isn't in the catalog yet: in the same pull request, add <code>${esc(gpuFile.path)}</code> with your GPU's catalog file (under GPU in the form). Without it, the checks fail.</li>`
                : `<li>Your GPU isn't in the catalog yet: in the same pull request, add <code>${esc(gpuId)}</code> to <code>data/gpus/</code> using upstream's <a href="${UPSTREAM_TEMPLATES}" target="_blank" rel="noopener">templates</a> (<a href="${UPSTREAM_CATALOG_README}" target="_blank" rel="noopener">ID rules</a>). Without it, the checks fail.</li>`
              : ""
          }
          <li>Open a pull request to <a href="${UPSTREAM_REPO}" target="_blank" rel="noopener">MattyStacks/open-gpu-benchmarks</a> adding <code>data/community/${esc(gpuId)}/${esc(suggestedFileName(r, "yaml"))}</code> with the YAML
            (<a target="_blank" rel="noopener" href="${UPSTREAM_REPO}/new/main/data/community/${encodeURIComponent(gpuId)}?filename=${encodeURIComponent(suggestedFileName(r, "yaml"))}&value=${encodeURIComponent(yaml)}">open GitHub's new-file form</a>).</li>
          <li>If <code>${BENCHMARK.gameId}</code> isn't in <code>data/games.yaml</code> yet, add this entry in the same PR (alphabetical by name):<pre class="yaml">${esc(gamesYamlEntry(Number(r.date.slice(0, 4))))}</pre></li>
          <li>Run <code>python scripts/validate.py results</code> upstream, or let the PR checks run.</li></ol>`
      : "";
  };
  function saveEdit(): void {
    // Reviewed by the user: the "filled in from" note has done its job.
    if (r.carriedFrom) {
      delete r.carriedFrom;
      view.querySelector("#carried-note")?.remove();
    }
    upsertResult(r);
    refresh();
  }
  view.querySelector("#nudge")?.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-nudge]")?.dataset.nudge;
    if (act === "submit") form.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (act === "later") {
      // Hidden until the page reloads; nothing is stored.
      nudgeDismissed = true;
      $("#nudge").remove();
    }
  });
  // Ready: the submission. Not yet: the same layout as a draft, saying what's missing.
  const yamlNow = () => (validateSubmission(r).length === 0 ? toYaml(r) : toDraftYaml(r));
  $("#exp-yaml").onclick = () => download(suggestedFileName(r, "yaml"), yamlNow(), "application/x-yaml");
  $("#copy-yaml").onclick = async () => {
    try {
      await navigator.clipboard.writeText(yamlNow());
      $("#copy-yaml").textContent = "Copied ✓";
    } catch {
      $("#copy-yaml").textContent = "Copy failed: select the preview";
    }
  };
  refresh();
  if (focus === "submit") requestAnimationFrame(() => $("#submit-section").scrollIntoView({ behavior: "smooth", block: "start" }));
}
