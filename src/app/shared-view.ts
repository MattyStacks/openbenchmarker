import { BENCHMARK_VERSION, BENCHMARKS } from "../benchmark/catalog";
import { getScoreTest } from "../benchmark/presets";
import { decodeShare, type SharedRun } from "../benchmark/share-codec";
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

export function renderShared(payload: string): void {
  showView("shared");
  const view = $("#view-shared");
  const d = decodeShare(decodeURIComponent(payload));
  if (!d.ok) {
    view.innerHTML = `<div class="results-head"><h1 class="sign">Shared result</h1></div>
      <div class="banner-invalid" role="alert">${
        d.reason === "newer-version"
          ? "<b>This link was made by a newer version of the site.</b> Reload the page to get the latest version, then open the link again."
          : "<b>This link looks damaged or edited.</b> Part of it may have been cut off when it was copied. Ask for the link again, or open it from the original message."
      }</div>
      <div class="row"><a class="btn btn-primary" href="#/">Run the benchmark</a></div>`;
    return;
  }
  const { type, runs } = d.payload;
  const first = runs[0];
  view.innerHTML = `
    <div class="results-head">
      <h1 class="sign">${type === "comparison" ? "Shared comparison" : "Shared result"}</h1>
      <p class="muted">Neon Flythrough · ${esc(settingsLabel(first))}</p>
    </div>
    ${runs.map((r, i) => runBlock(r, runs.length > 1 ? `Run ${i + 1}` : "")).join("")}
    <p class="honor-note">Shared on the honor system. Measured in the sharer's browser; nothing is stored or verified. <a href="#/about">How sharing works →</a></p>
    <div class="shared-cta">
      <button type="button" class="btn btn-primary btn-start" id="shared-run">Run the same test <span aria-hidden="true">▶</span></button>
      <p class="muted tiny">Opens the benchmark with ${esc(settingsLabel(first))} selected. Your result stays in your browser unless you share it.</p>
    </div>`;
  $("#shared-run").addEventListener("click", () => prefillFromShare(first));
}
