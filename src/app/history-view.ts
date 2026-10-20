import { BENCHMARK_VERSION } from "../benchmark/catalog";
import { download, toCsv } from "../benchmark/exporter";
import { round1 } from "../benchmark/metrics";
import type { BenchResult } from "../benchmark/types";
import { missingLabels, validateSubmission } from "../benchmark/validate";
import { $, esc } from "./dom";
import { showView } from "./shell";
import { allResults, reloadResults, removeResult } from "./store";

// ---------------------------------------------------------------------------
// History ("My Results", localStorage only)
// ---------------------------------------------------------------------------
function statusOf(r: BenchResult): { cls: string; text: string } {
  if (!r.valid) return { cls: "bad", text: `Invalid: ${r.invalidReason}` };
  const errs = validateSubmission(r);
  if (errs.length) return { cls: "warn", text: `Local only — missing: ${missingLabels(errs).join(", ")}` };
  return { cls: "good", text: "Ready to submit" };
}

/** Scores are only comparable within one major benchmark version. */
const major = (v: string) => String(v ?? "").split(".")[0];

export function renderHistory(): void {
  showView("history");
  const history = reloadResults();
  const view = $("#view-history");
  const mixed = history.some((r) => major(r.benchmarkVersion) !== major(BENCHMARK_VERSION));
  view.innerHTML = `
    <div class="results-head"><h1 class="sign">My Results</h1><p class="muted">Stored only in this browser (localStorage). Clearing site data deletes them.</p></div>
    ${
      history.length
        ? `${mixed ? `<p class="muted small-print">Scores from different major versions (e.g. 1.x and ${esc(BENCHMARK_VERSION)}) measure different workloads and aren't comparable.</p>` : ""}
        <div class="row"><button class="btn" id="hist-csv">Export all as CSV</button></div>
        <div class="table-wrap"><table class="history">
          <thead><tr><th>Date</th><th>Version</th><th>Resolution</th><th>Preset</th><th>Avg FPS</th><th>1% Low</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>${history
            .map((r) => {
              const s = statusOf(r);
              const old = major(r.benchmarkVersion) !== major(BENCHMARK_VERSION);
              return `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td class="num${old ? " ver-old" : ""}">v${esc(r.benchmarkVersion)}</td><td>${esc(r.resolution)}</td><td>${esc(r.preset)}</td><td class="num">${round1(r.avgFps).toFixed(1)}</td><td class="num">${round1(r.p1Low).toFixed(1)}</td>
              <td><span class="status ${s.cls}">${esc(s.text)}</span></td>
              <td class="actions"><a class="btn btn-sm" href="#/result/${encodeURIComponent(r.id)}">Open</a><button class="btn btn-sm" data-del="${esc(r.id)}">Delete</button></td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : `<p>No runs yet. <a href="#/">Run the benchmark</a>.</p>`
    }`;
  view.querySelector("#hist-csv")?.addEventListener("click", () => download("openbenchmarker_results.csv", toCsv(allResults()), "text/csv"));
  view.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Delete this result from this browser?")) return;
      removeResult(b.dataset.del!);
      renderHistory();
    }),
  );
}
