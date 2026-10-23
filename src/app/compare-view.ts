import { decodeShare, extractShareCode, sharedRunFrom, type SharedRun } from "../benchmark/share-codec";
import type { BenchResult } from "../benchmark/types";
import { otherRunsFor } from "./compare";
import { allResults } from "./store";
import { sharePayload } from "./share";
import { compareRuns, deviceSummary } from "./compare";
import { esc } from "./dom";
import { settingsLabel } from "./share";
import { lapChartSvg, stabilityPct } from "./stress-view";

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
  // The other run may be someone else's or one of your own earlier runs, so the words stay neutral.
  shared: { colA: "Compared with", colB: "This run", a: "the other run", b: "This run" },
  link: { colA: "Shared run", colB: "Compared run", a: "the shared run", b: "The compared run" },
  mine: { colA: "Shared run", colB: "Your saved run", a: "the shared run", b: "Your saved run" },
  self: { colA: "Other run", colB: "This run", a: "the other run", b: "This run" },
} satisfies Record<string, PanelLabels>;

function column(r: SharedRun, heading: string, faster: boolean): string {
  return `<div class="cmp-col${faster ? " faster" : ""}">
    <span class="cmp-label">${esc(heading)}</span>
    <b class="cmp-fps">${r.avgFps.toFixed(1)}</b><span class="cmp-unit">avg FPS</span>
    <dl class="cmp-facts">
      ${r.stress ? `<dt>Stability</dt><dd>${stabilityPct(r)}</dd>` : ""}
      <dt>1% low</dt><dd>${r.p1Low.toFixed(1)}</dd>
      <dt>5% low</dt><dd>${r.p5Low.toFixed(1)}</dd>
      <dt>Worst frame</dt><dd>${r.worstMs.toFixed(2)} ms</dd>
      <dt>Settings</dt><dd>${esc(settingsLabel(r))}</dd>
      <dt>Device</dt><dd>${esc(deviceSummary(r)) || "unknown"}</dd>
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
    ${
      a.stress || b.stress
        ? `<div class="cmp-laps">${([[a, labels.colA], [b, labels.colB]] as const)
            .map(([r, col]) => (r.stress ? lapChartSvg(r.stress.laps, `${col}: average FPS per lap`) : ""))
            .join("")}</div>`
        : ""
    }
    ${c.notes.length ? `<ul class="cmp-notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <p class="muted tiny">Each run was measured in its own browser and shared on the honor system.</p>
    ${extra}
  </section>`;
}

/** The run a pasted link or code stands for (a comparison link's compared run), or null. */
export function runFromPasted(text: string): SharedRun | null {
  const d = decodeShare(extractShareCode(text));
  return d.ok ? d.payload.runs[d.payload.type === "comparison" ? 1 : 0] : null;
}

/**
 * "Compare this run": paste someone's link or code, or pick one of your own runs. The panel opens in
 * place. Used on the results page and under a My Results card or table row.
 */
export function compareBoxHtml(mine: BenchResult): string {
  const others = otherRunsFor(allResults(), mine);
  return `<div class="compare-box" data-compare-for="${esc(mine.id)}">
    <h2 class="cmp-title">Compare this run</h2>
    <form class="have-code-form" data-cmp-paste>
      <label class="visually-hidden" for="cmp-paste-${esc(mine.id)}">Shared link or code</label>
      <input id="cmp-paste-${esc(mine.id)}" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a shared link or code" />
      <button type="submit" class="btn">Compare</button>
    </form>
    ${
      others.length
        ? `<form class="have-code-form" data-cmp-pick><label class="visually-hidden" for="cmp-pick-${esc(mine.id)}">One of your runs</label>
      <select id="cmp-pick-${esc(mine.id)}" name="other">${others
        .map(({ run: o, sameSettings }) => {
          const so = sharedRunFrom(o);
          return `<option value="${esc(o.id)}">${esc(o.date)} ${esc(o.time)} · ${o.avgFps.toFixed(1)} FPS · ${esc(deviceSummary(so).replace(/^[^\w]+/, ""))}${sameSettings ? "" : ` · ${esc(settingsLabel(so))} (different settings)`}</option>`;
        })
        .join("")}</select><button type="submit" class="btn">Compare</button></form>`
        : `<p class="muted tiny">Your other saved runs show up here too, e.g. the same test in another browser.</p>`
    }
    <p class="cmp-error" role="alert" hidden></p>
    <div data-cmp-panel></div>
  </div>`;
}

/** Delegated handling for every compare box inside root. */
export function bindCompareBoxes(root: HTMLElement): void {
  root.addEventListener("submit", (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-cmp-paste], [data-cmp-pick]");
    const box = form?.closest<HTMLElement>(".compare-box");
    if (!form || !box) return;
    e.preventDefault();
    const mine = allResults().find((r) => r.id === box.dataset.compareFor);
    if (!mine) return;
    const err = box.querySelector<HTMLElement>(".cmp-error")!;
    const fd = new FormData(form);
    let other: SharedRun | null = null;
    const labels: PanelLabels = LABELS.shared;
    if (form.matches("[data-cmp-paste]")) {
      other = runFromPasted(String(fd.get("code") ?? ""));
      if (!other) {
        err.hidden = false;
        err.textContent = "This link or code looks damaged or edited. Paste the whole link, or ask for it again.";
        return;
      }
    } else {
      const o = allResults().find((r) => r.id === fd.get("other"));
      if (o) other = sharedRunFrom(o);
    }
    err.hidden = true;
    if (!other) return;
    const me = sharedRunFrom(mine);
    const canShareBoth = mine.valid;
    const shareBtn = canShareBoth ? `<div class="row"><button type="button" class="btn" data-cmp-share>Share the comparison</button><span class="share-status" role="status" data-cmp-status></span></div>` : "";
    const panel = box.querySelector<HTMLElement>("[data-cmp-panel]")!;
    panel.innerHTML = comparePanelHtml(other, me, labels, shareBtn);
    const theirs = other;
    panel.querySelector("[data-cmp-share]")?.addEventListener("click", () => {
      const status = panel.querySelector<HTMLElement>("[data-cmp-status]");
      void sharePayload({ type: "comparison", runs: [theirs, me] }).done.then((o) => {
        if (status) status.textContent = o === "shared" ? "Shared ✓" : o === "copied" ? "Link and text copied ✓" : o === "failed" ? "Couldn't share here." : "";
      });
    });
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
