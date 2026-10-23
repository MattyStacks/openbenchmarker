import { BENCHMARK_VERSION, BENCHMARKS, OGB_SITE } from "../benchmark/catalog";
import { getScoreTest } from "../benchmark/presets";
import { decodeShare, encodeShare, extractShareCode, sharedRunFrom, type SharedRun } from "../benchmark/share-codec";
import { setPending } from "./challenge";
import { matchLocal } from "./compare";
import { LABELS, comparePanelHtml } from "./compare-view";
import { allResults } from "./store";
import { $, esc } from "./dom";
import { prefillFromShare } from "./home";
import { deviceLabel, settingsLabel } from "./share";
import { showView } from "./shell";

// ---------------------------------------------------------------------------
// Shared link view (#/r/<payload>): read-only, decoded entirely in this browser.
// Every decoded string goes through esc() before it reaches the page.
// ---------------------------------------------------------------------------
const major = (v: string) => v.split(".")[0];

function runBlock(r: SharedRun, label = ""): string {
  const name = BENCHMARKS.find((b) => b.gameId === r.gameId)?.name ?? r.gameId;
  const test = getScoreTest(r.scoreTest);
  return `<section class="shared-run">
    ${label ? `<h2 class="shared-label">${esc(label)}</h2>` : ""}
    <div class="score-cards">
      ${
        r.score !== undefined
          ? `<div class="score hero-score"><span>${esc(test?.name ?? "Score")}</span><b>${r.score}</b><span class="score-test">${r.avgFps.toFixed(1)} FPS × 100</span></div>
        <div class="score"><span>Average FPS</span><b>${r.avgFps.toFixed(1)}</b></div>`
          : `<div class="score hero-score"><span>Average FPS</span><b>${r.avgFps.toFixed(1)}</b></div>`
      }
      <div class="score"><span>1% Low FPS</span><b>${r.p1Low.toFixed(1)}</b></div>
      <div class="score small"><span>5% Low FPS</span><b>${r.p5Low.toFixed(1)}</b></div>
      <div class="score small"><span>Worst frame</span><b>${r.worstMs.toFixed(2)} ms</b></div>
      <div class="score small"><span>Frames timed</span><b>${r.frameCount}</b></div>
      <div class="score small"><span>Run settings</span><b class="settings">${test ? `${esc(test.name)} · ` : ""}${esc(r.resolution)} (${r.width}×${r.height}) · ${esc(r.preset)} · ${r.durationS} s · ${esc(r.graphicsApi)}</b></div>
    </div>
    <dl class="hints shared-facts">
      <dt>Benchmark</dt><dd>${esc(name)} v${esc(r.benchmarkVersion)}</dd>
      <dt>Run date</dt><dd>${esc(r.date)}</dd>
      <dt>GPU <em>(reported by the browser)</em></dt><dd>${r.device.gpuLabel ? esc(r.device.gpuLabel) : "hidden by the browser"}</dd>
      <dt>Browser and device</dt><dd>${esc(deviceLabel(r.device))}</dd>
      <dt>Timing</dt><dd>${r.timing === "gpu-timer" ? "GPU timer queries" : r.timing === "batch-avg" ? "batch averages (no GPU timer)" : "n/a"}</dd>
    </dl>
    ${
      major(r.benchmarkVersion) !== major(BENCHMARK_VERSION)
        ? `<p class="muted">Made with v${esc(r.benchmarkVersion)}. Today's benchmark is v${esc(BENCHMARK_VERSION)}, a different workload, so the numbers aren't comparable.</p>`
        : ""
    }
  </section>`;
}

/** "Have a code?": open a share code (or a pasted link) without a link. Nothing is sent anywhere. */
export function haveCodeHtml(open = false): string {
  return `<details class="have-code"${open ? " open" : ""}>
    <summary>Have a code?</summary>
    <form class="have-code-form" data-have-code>
      <label class="visually-hidden" for="have-code-input">Share code or link</label>
      <input id="have-code-input" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a code or link, e.g. AQAC…" />
      <button type="submit" class="btn">Open</button>
    </form>
    <p class="muted tiny">A code is the end of a share link. It's read in this browser; nothing is sent anywhere.</p>
  </details>`;
}

/** The same, always visible (My Results): one row, label, input and Open. */
export function codeRowHtml(): string {
  return `<form class="code-row" data-have-code>
    <label for="code-row-input">Open a shared result</label>
    <div class="have-code-form">
      <input id="code-row-input" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a shared link or code" />
      <button type="submit" class="btn">Open</button>
    </div>
  </form>`;
}

/** Delegated: any [data-have-code] form inside root. */
export function bindHaveCode(root: HTMLElement): void {
  root.addEventListener("submit", (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-have-code]");
    if (!form) return;
    e.preventDefault();
    const code = extractShareCode(String(new FormData(form).get("code") ?? ""));
    location.hash = `#/r/${code || "-"}`;
  });
}

/** Viewer's saved runs that match, as a picker + panel. Local only. */
function compareWithMine(view: HTMLElement, target: SharedRun): void {
  const matches = matchLocal(allResults(), target);
  const slot = view.querySelector<HTMLElement>("[data-mine-slot]");
  const btn = view.querySelector<HTMLButtonElement>("[data-compare-mine]");
  if (!slot || !btn) return;
  if (!matches.length) {
    btn.addEventListener("click", () => {
      btn.hidden = true;
      slot.innerHTML = `<p class="muted">You don't have a saved run at ${esc(settingsLabel(target))} (v${esc(target.benchmarkVersion.split(".")[0])}.x) in this browser yet. Run the same test to compare.</p>`;
    });
    return;
  }
  const show = (id: string) => {
    const mine = matches.find((m) => m.id === id) ?? matches[0];
    const picker =
      matches.length > 1
        ? `<label class="field cmp-pick"><span>Your saved run</span><select data-mine-pick>${matches
            .map((m) => `<option value="${esc(m.id)}"${m.id === mine.id ? " selected" : ""}>${esc(m.date)} ${esc(m.time)} · ${m.avgFps.toFixed(1)} FPS · ${m.durationS} s</option>`)
            .join("")}</select></label>`
        : "";
    slot.innerHTML = picker + comparePanelHtml(target, sharedRunFrom(mine), LABELS.mine);
    slot.querySelector<HTMLSelectElement>("[data-mine-pick]")?.addEventListener("change", (e) => show((e.target as HTMLSelectElement).value));
  };
  btn.addEventListener("click", () => {
    btn.hidden = true;
    show(matches[0].id);
    slot.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** "Set up the same test": settings selected and the comparison pending; nothing starts. */
function setUp(target: SharedRun): void {
  setPending(encodeShare({ type: "challenge", runs: [target] }));
  prefillFromShare(target);
}

export function renderShared(payload: string): void {
  showView("shared");
  const view = $("#view-shared");
  const d = decodeShare(decodeURIComponent(payload));
  if (!d.ok) {
    view.innerHTML = `<div class="results-head"><h1 class="sign">Shared result</h1></div>
      <div class="banner-invalid" role="alert">${
        d.reason === "newer-version"
          ? "<b>This link was made by a newer version of the site.</b> Reload the page to get the latest version, then open the link again."
          : "<b>This link or code looks damaged or edited.</b> Part of it may have been cut off when it was copied. Ask for it again, or open it from the original message."
      }</div>
      ${haveCodeHtml(true)}
      <div class="row"><a class="btn btn-primary" href="#/">Run the benchmark</a></div>`;
    bindHaveCode(view);
    return;
  }
  const { type, runs } = d.payload;
  const first = runs[0];
  const mineBtn = `<button type="button" class="btn" data-compare-mine>Compare with mine</button>`;
  const honor = `<p class="honor-note">Shared on the honor system. Measured in the sharer's browser; nothing is stored or verified. <a href="#/about/sharing">How sharing works →</a></p>`;
  const explore = `<p class="explore-link"><a href="${OGB_SITE}" target="_blank" rel="noopener">Explore results on Open GPU Benchmarks →</a></p>`;
  if (type === "comparison") {
    view.innerHTML = `
      <div class="results-head"><h1 class="sign">Shared comparison</h1><p class="muted">Neon Flythrough · two runs side by side</p></div>
      ${comparePanelHtml(runs[0], runs[1], LABELS.link)}
      <details class="result-details"><summary>Both runs in full</summary>${runBlock(runs[0], "Shared run")}${runBlock(runs[1], "Compared run")}</details>
      ${honor}
      ${explore}
      <div class="shared-cta">
        <button type="button" class="btn btn-primary btn-start" data-setup>Run the same test &amp; compare <span aria-hidden="true">▶</span></button>
        <p class="muted tiny">Selects ${esc(settingsLabel(first))} so your run can sit next to the shared run, on any device or browser. Nothing starts until you press Start.</p>
        ${mineBtn}
      </div>
      <div data-mine-slot></div>`;
  } else if (type === "challenge") {
    view.innerHTML = `
      <div class="results-head"><h1 class="sign">Compare with this run</h1><p class="muted">Neon Flythrough · ${esc(settingsLabel(first))}</p></div>
      ${runBlock(first)}
      ${honor}
      ${explore}
      <div class="shared-cta">
        <button type="button" class="btn btn-primary btn-start" data-setup>Run the same test &amp; compare <span aria-hidden="true">▶</span></button>
        <p class="muted tiny">Selects ${esc(settingsLabel(first))}. Press Start when you're ready, on any device or browser, and you'll see both runs side by side. Your result stays in your browser unless you share it.</p>
        ${mineBtn}
      </div>
      <div data-mine-slot></div>`;
  } else {
    view.innerHTML = `
      <div class="results-head"><h1 class="sign">Shared result</h1><p class="muted">Neon Flythrough · ${esc(settingsLabel(first))}</p></div>
      ${runBlock(first)}
      ${honor}
      ${explore}
      <div class="shared-cta">
        <button type="button" class="btn btn-primary btn-start" data-setup>Run the same test &amp; compare <span aria-hidden="true">▶</span></button>
        <p class="muted tiny">Selects ${esc(settingsLabel(first))}. Press Start when you're ready, on any device or browser, and you'll see both runs side by side. Your result stays in your browser unless you share it.</p>
        ${mineBtn}
      </div>
      <div data-mine-slot></div>`;
  }
  view.querySelector("[data-setup]")?.addEventListener("click", () => setUp(first));
  compareWithMine(view, first);
}
