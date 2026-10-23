import type { SharedRun } from "../benchmark/share-codec";
import { browserOs, compareRuns } from "./compare";
import { esc } from "./dom";
import { settingsLabel } from "./share";

// ---------------------------------------------------------------------------
// The side-by-side panel, used on the result page (a comparison you set up), shared comparison
// links, "Compare with mine" and My Results' "Compare with another of my runs". Neutral wording.
// ---------------------------------------------------------------------------

export interface PanelLabels {
  /** Column headings, e.g. "Shared run" / "Your run". */
  colA: string;
  colB: string;
  /** Names inside the verdict, e.g. "the shared run" / "Your run". */
  a: string;
  b: string;
}

export const LABELS = {
  shared: { colA: "Shared run", colB: "Your run", a: "the shared run", b: "Your run" },
  link: { colA: "Shared run", colB: "Compared run", a: "the shared run", b: "The compared run" },
  mine: { colA: "Shared run", colB: "Your saved run", a: "the shared run", b: "Your saved run" },
  self: { colA: "Other run", colB: "This run", a: "the other run", b: "This run" },
} satisfies Record<string, PanelLabels>;

function column(r: SharedRun, heading: string, faster: boolean): string {
  return `<div class="cmp-col${faster ? " faster" : ""}">
    <span class="cmp-label">${esc(heading)}</span>
    <b class="cmp-fps">${r.avgFps.toFixed(1)}</b><span class="cmp-unit">avg FPS</span>
    <dl class="cmp-facts">
      <dt>1% low</dt><dd>${r.p1Low.toFixed(1)}</dd>
      <dt>Settings</dt><dd>${esc(settingsLabel(r))}</dd>
      <dt>Browser</dt><dd>${esc(browserOs(r)) || "unknown"}</dd>
      <dt>GPU <em>(browser)</em></dt><dd>${r.device.gpuLabel ? esc(r.device.gpuLabel) : "hidden"}</dd>
      <dt>Version</dt><dd>v${esc(r.benchmarkVersion)}</dd>
      <dt>Date</dt><dd>${esc(r.date)}</dd>
    </dl>
  </div>`;
}

/** Two runs side by side with the verdict and notes. `extra` goes at the bottom (actions). */
export function comparePanelHtml(a: SharedRun, b: SharedRun, labels: PanelLabels, extra = ""): string {
  const c = compareRuns(a, b, { a: labels.a, b: labels.b });
  const fasterB = c.pct !== null && c.pct >= 0.5;
  const fasterA = c.pct !== null && c.pct <= -0.5;
  return `<section class="compare-panel" aria-label="Side by side">
    <h2 class="cmp-title">Side by side</h2>
    ${c.verdict ? `<p class="cmp-verdict">${esc(c.verdict)}</p>` : ""}
    <div class="cmp-cols">${column(a, labels.colA, fasterA)}${column(b, labels.colB, fasterB)}</div>
    ${c.notes.length ? `<ul class="cmp-notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <p class="muted tiny">Each run was measured in its own browser and shared on the honor system.</p>
    ${extra}
  </section>`;
}
