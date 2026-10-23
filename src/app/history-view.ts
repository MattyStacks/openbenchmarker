import { BENCHMARK_VERSION, findGpu } from "../benchmark/catalog";
import { download, suggestedFileName, toCsv, toJson, toYaml } from "../benchmark/exporter";
import { VERDICT_LABEL, diagnose } from "../benchmark/diagnose";
import { round1 } from "../benchmark/metrics";
import { getScoreTest } from "../benchmark/presets";
import { sharedRunFrom } from "../benchmark/share-codec";
import type { BenchResult } from "../benchmark/types";
import { $, esc } from "./dom";
import {
  canShare,
  deviceLine,
  facetValues,
  filterRuns,
  gpuLine,
  mixesMajors,
  sortRuns,
  submissionStatus,
  type FacetKey,
  type Filters,
  type SortKey,
} from "./result-display";
import { openResult } from "./results-view";
import { clearUnfinished, removeUnfinished, unfinishedCombos, type UnfinishedCombo } from "./run-guard";
import { shareRun } from "./share";
import { showView } from "./shell";
import { allResults, clearResults, reloadResults, removeResult } from "./store";

// ---------------------------------------------------------------------------
// My Results (localStorage only): a card list, phone first. Filters and sort live in memory.
// ---------------------------------------------------------------------------
const PAGE = 40;
const FACETS: { key: FacetKey; label: string }[] = [
  { key: "resolution", label: "Resolution" },
  { key: "preset", label: "Preset" },
  { key: "version", label: "Version" },
  { key: "device", label: "Device" },
];

const state: { filters: Filters; sort: SortKey; shown: number } = { filters: {}, sort: "newest", shown: PAGE };

const major = (v: string) => String(v ?? "").split(".")[0];
const fmtMs = (x: number) => `${x.toFixed(2)} ms`;

function badges(r: BenchResult): string {
  const old = major(r.benchmarkVersion) !== major(BENCHMARK_VERSION);
  return `<span class="badge${old ? " old" : ""}">v${esc(r.benchmarkVersion)}</span>${r.valid ? "" : `<span class="badge bad">Invalid</span>`}`;
}

function card(r: BenchResult): string {
  const st = submissionStatus(r);
  const dev = deviceLine(r);
  const gpu = gpuLine(r);
  const test = getScoreTest(r.scoreTest);
  const statusHtml =
    st.kind === "ready"
      ? `<span class="rc-status good">✓ Ready to submit</span>`
      : st.kind === "next-step"
        ? `<span class="rc-status">${esc(st.text)}</span>`
        : st.kind === "invalid"
          ? `<span class="rc-status bad">${esc(st.text)}</span>`
          : "";
  const yamlOk = st.kind === "ready";
  return `<article class="run-card${r.valid ? "" : " invalid"}" data-id="${esc(r.id)}">
    <details class="rc-main">
      <summary>
        <div class="rc-head">
          ${r.score !== undefined ? `<b class="rc-fps">${r.score}</b><span class="rc-unit">${esc(test?.name ?? "Score")}</span>` : `<b class="rc-fps">${round1(r.avgFps).toFixed(1)}</b><span class="rc-unit">avg FPS</span>`}
          <span class="rc-badges">${badges(r)}</span>
        </div>
        <div class="rc-sub">${r.score !== undefined ? `${round1(r.avgFps).toFixed(1)} avg · ` : ""}${round1(r.p1Low).toFixed(1)} 1% low · ${esc(r.resolution)} · ${esc(r.preset)} · ${r.durationS} s</div>
        ${dev || gpu ? `<div class="rc-dev">${esc([dev, gpu].filter(Boolean).join(" · "))}</div>` : ""}
        <div class="rc-meta"><span>${esc(r.date)} ${esc(r.time)}</span>${statusHtml}</div>
      </summary>
      <div class="rc-details"></div>
    </details>
    <div class="rc-actions">
      ${canShare(r) ? `<button type="button" class="btn btn-primary" data-act="share">Share</button>` : `<span class="rc-spacer"></span>`}
      <span data-challenge-slot></span>
      <details class="menu">
        <summary class="btn" aria-label="More actions for this result">⋯</summary>
        <div class="menu-list">
          <a href="#/result/${encodeURIComponent(r.id)}">Open full result</a>
          <button type="button" data-act="json">Export JSON</button>
          <button type="button" data-act="csv">Export CSV</button>
          ${yamlOk ? `<button type="button" data-act="yaml">Download YAML</button><button type="button" data-act="submit">Submit…</button>` : ""}
          <button type="button" class="danger" data-act="delete">Delete</button>
        </div>
      </details>
    </div>
  </article>`;
}

/** Filled when a card opens, so 100+ cards don't each run the diagnosis. */
function details(r: BenchResult): string {
  const v = r.diag ? diagnose(r).verdict : null;
  const s = r.system ?? {};
  const sys: [string, string][] = [
    ["GPU (catalog)", s.gpuId ? (findGpu(s.gpuId)?.name ?? s.gpuId) : ""],
    ["OS", s.os],
    ["OS version", s.osDetail],
    ["CPU", s.cpu],
    ["Memory", s.memoryGb ? `${s.memoryGb} GB${s.memoryType ? ` ${s.memoryType}` : ""}` : ""],
    ["GPU driver", s.driver],
  ].filter(([, x]) => (x ?? "").trim()) as [string, string][];
  return `<dl class="hints">
      <dt>5% low</dt><dd>${round1(r.p5Low).toFixed(1)} FPS</dd>
      <dt>Worst frame</dt><dd>${fmtMs(r.worstMs)}</dd>
      <dt>Frames timed</dt><dd>${r.frameCount}</dd>
      <dt>Timing</dt><dd>${r.timing === "gpu-timer" ? "GPU timer queries" : r.timing === "batch-avg" ? "batch averages" : "n/a"}</dd>
      <dt>Graphics API</dt><dd>${esc(r.graphicsApi)}</dd>
      <dt>Loop busy</dt><dd>${Math.round(r.loopBusy * 100)}%</dd>
      ${v ? `<dt>What limited it</dt><dd><span class="limit-tag v-${v}">${esc(VERDICT_LABEL[v])}</span></dd>` : ""}
      ${r.valid ? "" : `<dt>Why invalid</dt><dd>${esc(r.invalidReason)}</dd>`}
      ${sys.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join("")}
    </dl>`;
}

function dnfCard(c: UnfinishedCombo): string {
  return `<article class="run-card dnf" data-dnf-res="${esc(c.resolution)}" data-dnf-preset="${esc(c.preset)}">
    <div class="rc-head"><b class="rc-dnf">${esc(c.resolution)} · ${esc(c.preset)}</b><span class="rc-badges"><span class="badge warn">Didn't finish</span></span></div>
    ${c.count > 1 ? `<div class="rc-sub">${c.count} times on this device</div>` : ""}
    <div class="rc-meta"><span>${esc(c.lastAt.slice(0, 10))}</span><span class="rc-status">Your browser likely ran out of memory. Try a lower resolution.</span></div>
    <div class="rc-actions"><span class="rc-spacer"></span><button type="button" class="btn" data-act="dnf-remove">Remove</button></div>
  </article>`;
}

function toolbar(all: readonly BenchResult[]): string {
  const groups = FACETS.map(({ key, label }) => {
    const values = facetValues(all, key);
    if (values.length < 2) return "";
    return `<div class="chip-group" role="group" aria-label="${label}"><span class="chip-label">${label}</span>${values
      .map((v) => `<button type="button" class="chip" data-facet="${key}" data-value="${esc(v)}" aria-pressed="${state.filters[key] === v}">${esc(v)}</button>`)
      .join("")}</div>`;
  }).join("");
  return `<div class="hist-toolbar">
    <label class="sort"><span>Sort</span><select id="hist-sort"><option value="newest"${state.sort === "newest" ? " selected" : ""}>Newest first</option><option value="fps"${state.sort === "fps" ? " selected" : ""}>Highest FPS</option></select></label>
    ${groups ? `<div class="chips">${groups}</div>` : ""}
  </div>`;
}

function renderList(): void {
  const all = allResults();
  const list = sortRuns(filterRuns(all, state.filters), state.sort);
  const filtered = Object.values(state.filters).some(Boolean);
  const dnf = unfinishedCombos().filter(
    (c) => !state.filters.version && !state.filters.device && (!state.filters.resolution || c.resolution === state.filters.resolution) && (!state.filters.preset || c.preset === state.filters.preset),
  );
  const shown = list.slice(0, state.shown);
  $("#hist-list").innerHTML = `
    ${filtered ? `<p class="muted small-print">Showing ${list.length} of ${all.length}. <button type="button" class="linklike" data-act="clear-filters">Clear filters</button></p>` : ""}
    ${mixesMajors(list) ? `<p class="muted small-print">1.x and 2.x measure different workloads, so their FPS can't be compared.</p>` : ""}
    ${list.length || dnf.length ? "" : `<p>No runs match these filters. <button type="button" class="linklike" data-act="clear-filters">Clear filters</button></p>`}
    <div class="run-cards">${dnf.map(dnfCard).join("")}${shown.map(card).join("")}</div>
    ${list.length > shown.length ? `<button type="button" class="btn show-more" data-act="more">Show more (${list.length - shown.length} left)</button>` : ""}`;
}

export function renderHistory(): void {
  showView("history");
  const all = reloadResults();
  const view = $("#view-history");
  const dnf = unfinishedCombos();
  if (!all.length && !dnf.length) {
    view.innerHTML = `<div class="results-head"><h1 class="sign">My Results</h1></div>
      <div class="empty-state"><p><b>No runs yet.</b> Results you run are saved here, in this browser only.</p><a class="btn btn-primary btn-start" href="#/">Start benchmark <span aria-hidden="true">▶</span></a></div>`;
    return;
  }
  view.innerHTML = `
    <div class="results-head"><h1 class="sign">My Results</h1><p class="muted">Stored only in this browser. Nothing is uploaded unless you share, export or submit a result.</p></div>
    ${all.length ? toolbar(all) : ""}
    <div id="hist-list"></div>
    <div class="hist-footer">
      ${all.length ? `<button type="button" class="btn" data-act="csv-all">Export all as CSV</button>` : ""}
      <button type="button" class="btn danger" data-act="clear-all">Clear my saved results</button>
    </div>`;
  renderList();
  if (view.dataset.bound) return;
  view.dataset.bound = "1";
  view.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.id !== "hist-sort") return;
    state.sort = el.value as SortKey;
    state.shown = PAGE;
    renderList();
  });
  // Opening a card fills its details; opening one menu closes the others. (toggle doesn't bubble.)
  view.addEventListener(
    "toggle",
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.open) return;
      if (d.classList.contains("rc-main")) {
        const r = allResults().find((x) => x.id === d.closest<HTMLElement>(".run-card")?.dataset.id);
        const box = d.querySelector(".rc-details");
        if (r && box && !box.innerHTML) box.innerHTML = details(r);
      } else if (d.classList.contains("menu")) view.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => m !== d && (m.open = false));
    },
    true,
  );
  view.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLButtonElement>(".chip");
    if (chip) {
      const k = chip.dataset.facet as FacetKey;
      state.filters[k] = state.filters[k] === chip.dataset.value ? undefined : chip.dataset.value;
      state.shown = PAGE;
      view.querySelectorAll<HTMLButtonElement>(`.chip[data-facet="${k}"]`).forEach((c) => c.setAttribute("aria-pressed", String(state.filters[k] === c.dataset.value)));
      renderList();
      return;
    }
    const btn = t.closest<HTMLElement>("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act!;
    const cardEl = btn.closest<HTMLElement>(".run-card");
    const r = cardEl?.dataset.id ? allResults().find((x) => x.id === cardEl.dataset.id) : undefined;
    btn.closest<HTMLDetailsElement>("details.menu")?.removeAttribute("open");
    if (act === "share" && r) {
      // Built and handed to the share sheet inside the tap (Safari needs that).
      void shareRun(sharedRunFrom(r)).done.then((o) => {
        if (o === "cancelled") return;
        btn.textContent = o === "shared" ? "Shared ✓" : o === "copied" ? "Link copied ✓" : "Open it to share";
        setTimeout(() => (btn.textContent = "Share"), 2500);
      });
    } else if (act === "json" && r) download(suggestedFileName(r, "json"), toJson(r), "application/json");
    else if (act === "csv" && r) download(suggestedFileName(r, "csv"), toCsv([r]), "text/csv");
    else if (act === "yaml" && r && submissionStatus(r).kind === "ready") download(suggestedFileName(r, "yaml"), toYaml(r), "application/x-yaml");
    else if (act === "submit" && r) openResult(r.id, "submit");
    else if (act === "delete" && r) {
      if (!confirm("Delete this result from this browser?")) return;
      removeResult(r.id);
      renderHistory();
    } else if (act === "dnf-remove" && cardEl) {
      removeUnfinished(cardEl.dataset.dnfRes!, cardEl.dataset.dnfPreset!);
      renderHistory();
    } else if (act === "more") {
      state.shown += PAGE;
      renderList();
    } else if (act === "clear-filters") {
      state.filters = {};
      state.shown = PAGE;
      renderHistory();
    } else if (act === "csv-all") download("openbenchmarker_results.csv", toCsv(allResults()), "text/csv");
    else if (act === "clear-all") {
      const n = allResults().length;
      if (!confirm(`Delete all ${n} saved result${n === 1 ? "" : "s"} from this browser? This can't be undone. Results you already shared or submitted aren't affected.`)) return;
      clearResults();
      clearUnfinished();
      state.filters = {};
      renderHistory();
    }
  });
}
