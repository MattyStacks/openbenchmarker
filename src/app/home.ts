import { DURATIONS, PRESETS, RESOLUTIONS, SCORE_TESTS, getResolution, type PresetId, type ResolutionId } from "../benchmark/presets";
import { $, esc } from "./dom";
import { MOBILE } from "./env";
import { startRun } from "./run";
import { didNotFinish, leftoverMessage, needsHighResWarning, type InProgressRun } from "./run-guard";
import type { SharedRun } from "../benchmark/share-codec";
import { clearPending, pendingCode, pendingRun, setPending } from "./challenge";
import { deviceSummary } from "./compare";
import { runFromPasted } from "./compare-view";
import { encodeShare, shareBlocker, sharedRunFrom } from "../benchmark/share-codec";
import { browserLabel, settingsLabel } from "./share";
import { app } from "./shell";
import { allResults, loadConfig, saveConfig, type RunConfig } from "./store";

/** Short load hints under each preset name (display only). */
const PRESET_HINT: Record<PresetId, string> = {
  Low: "iGPU",
  Medium: "entry",
  High: "mid-range",
  Ultra: "high-end",
  Extreme: "flagship",
};

const radio = (name: string, value: string | number, checked: boolean, label: string, sub = "") =>
  `<label><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""}/><span>${label}${sub ? `<small>${sub}</small>` : ""}</span></label>`;

function setRadio(name: string, value: string | number): void {
  const el = document.querySelector<HTMLInputElement>(`#config input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

/** Device memory in GB (Chromium only, rounded and capped by the browser). A hint, never a gate. */
function deviceMemoryGb(): number | null {
  const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof m === "number" && m > 0 ? m : null;
}

/** One-tap confirmation before a heavy 1440p/4K run on a phone or tablet. */
function confirmHighRes(cfg: RunConfig): Promise<"run" | "switch" | "cancel"> {
  const dlg = $<HTMLDialogElement>("#highres-confirm");
  $("#highres-body").textContent = "1440p and 4K at heavier presets need a lot of memory and may crash the browser on some phones. 1080p is a safe bet.";
  const mem = deviceMemoryGb();
  const hint = $("#highres-hint");
  hint.hidden = mem === null || mem > 4;
  hint.textContent = mem !== null ? `This device reports about ${mem} GB of memory.` : "";
  $("#highres-title").textContent = `${cfg.resolution} · ${cfg.preset} might crash on a phone`;
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "run" || dlg.returnValue === "switch" ? dlg.returnValue : "cancel"), { once: true });
    dlg.returnValue = "";
    dlg.showModal();
    $<HTMLButtonElement>("#highres-switch").focus();
  });
}

/** Every run starts here: the phone warning (if needed), then the run. A pending comparison rides along. */
async function launch(cfg: RunConfig): Promise<void> {
  if (app.running) return;
  const compareWith = pendingCode();
  if (compareWith) cfg = { ...cfg, challenge: compareWith };
  const finished = allResults().filter((r) => r.valid).map((r) => ({ resolution: r.resolutionId, preset: r.preset }));
  if (needsHighResWarning(cfg.resolution, cfg.preset, MOBILE, finished)) {
    const choice = await confirmHighRes(cfg);
    if (choice === "cancel") return;
    if (choice === "switch") {
      cfg = { resolution: "1080p", preset: cfg.preset, duration: cfg.duration, ...(cfg.challenge ? { challenge: cfg.challenge } : {}) };
      setRadio("resolution", "1080p");
      saveConfig(cfg);
    }
  }
  void startRun(cfg);
}

/** Settings of the shared result the user chose to run ("Run the same test"); null otherwise. */
let shareTarget: { resolution: string; preset: string; duration: number } | null = null;

/** "Run the same test" from a shared link: select its settings and bring the form into view. */
export function prefillFromShare(r: SharedRun): void {
  shareTarget = { resolution: r.resolution, preset: r.preset, duration: r.durationS };
  setRadio("resolution", r.resolution);
  setRadio("preset", r.preset);
  setRadio("duration", r.durationS);
  location.hash = "#/";
  refreshRunHints();
  const scoreBtn = r.score !== undefined ? document.querySelector<HTMLElement>(`#score-runs [data-test="${r.scoreTest}"]`) : null;
  document.querySelectorAll("#score-runs .is-target").forEach((b) => b.classList.remove("is-target"));
  scoreBtn?.classList.add("is-target");
  requestAnimationFrame(() => (scoreBtn ?? $("#config")).scrollIntoView({ behavior: "smooth", block: "start" }));
}

/** "Didn't finish on this device last time" hints for the selected combo and the score runs. */
function refreshRunHints(): void {
  const form = $<HTMLFormElement>("#config");
  const fd = new FormData(form);
  const res = String(fd.get("resolution") ?? "");
  const preset = String(fd.get("preset") ?? "");
  const target = $("#cfg-target");
  target.hidden = !shareTarget;
  if (shareTarget) {
    const want = `${shareTarget.resolution} · ${shareTarget.preset} · ${shareTarget.duration} s`;
    const same = shareTarget.resolution === res && shareTarget.preset === preset && String(shareTarget.duration) === String(fd.get("duration"));
    target.classList.toggle("differs", !same);
    // The comparison banner already says which settings are selected; only flag a mismatch then.
    if (same && pendingRun()) target.hidden = true;
    target.textContent = same
      ? `Same settings as the shared result (${want}).`
      : `Not like-for-like: the shared result used ${want}. Your result won't compare directly.`;
  }
  const banner = $("#compare-banner");
  const cmp = pendingRun();
  banner.hidden = !cmp;
  if (cmp) {
    const who = [browserLabel(cmp.device), cmp.device.gpuLabel].filter(Boolean).join(" · ");
    banner.innerHTML = `<p><b>Comparing with ${cmp.avgFps.toFixed(1)} FPS avg</b> · ${esc(who)} (${esc(settingsLabel(cmp))}). Press Start when you're ready; you'll see both runs side by side.</p><button type="button" class="linklike" data-stop-compare>Stop comparing</button>`;
  }
  const note = $("#cfg-dnf");
  const dnf = didNotFinish(res, preset);
  note.hidden = !dnf;
  note.textContent = dnf ? `${res} · ${preset}: didn't finish on this device last time. You can still run it.` : "";
  document.querySelectorAll<HTMLElement>("#score-runs [data-test]").forEach((btn) => {
    const t = SCORE_TESTS.find((x) => x.id === btn.dataset.test);
    btn.querySelector(".dnf")?.remove();
    if (t && didNotFinish(t.resolution, t.preset)) btn.insertAdjacentHTML("beforeend", `<small class="dnf">Didn't finish on this device last time</small>`);
  });
}

function showLeftoverNotice(r: InProgressRun): void {
  const msg = leftoverMessage(r);
  const box = $("#run-notice");
  box.innerHTML = `<p><b>${esc(msg.title)}</b></p><p>${esc(msg.body)}</p><div class="row">${
    msg.suggest ? `<button type="button" class="btn btn-primary" data-act="safer">Run at ${esc(msg.suggest)}</button>` : ""
  }${pendingCode() ? `<button type="button" class="btn" data-act="back-compare">Back to the comparison</button>` : ""}<button type="button" class="btn" data-act="dismiss">Dismiss</button></div>`;
  box.hidden = false;
  box.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    box.hidden = true;
    if (act === "safer" && msg.suggest) {
      const cfg: RunConfig = { resolution: msg.suggest, preset: r.preset, duration: r.duration };
      setRadio("resolution", cfg.resolution);
      saveConfig(cfg);
      void launch(cfg);
    } else if (act === "back-compare") {
      const code = pendingCode();
      if (code) location.hash = `#/r/${code}`;
    }
  });
}

/** Home "Compare" entry: your saved runs (shareable ones) for the picker, newest first. */
function refreshCompareEntry(): void {
  const runs = allResults().filter((r) => r.valid && !shareBlocker(sharedRunFrom(r)));
  const pick = $<HTMLFormElement>("#cmp-entry-pick");
  pick.hidden = runs.length === 0;
  $<HTMLSelectElement>("#cmp-entry-run").innerHTML = runs
    .map((r) => {
      const s = sharedRunFrom(r);
      return `<option value="${esc(r.id)}">Mine: ${esc(r.date)} ${esc(r.time)} · ${r.avgFps.toFixed(1)} FPS · ${esc(settingsLabel(s))} · ${esc(deviceSummary(s).replace(/^[^\w]+/, ""))}</option>`;
    })
    .join("");
}

/** Set up a comparison with a run: same settings selected, banner shown, nothing started. */
function compareWith(run: SharedRun): void {
  setPending(encodeShare({ type: "challenge", runs: [run] }));
  prefillFromShare(run);
}

function bindCompareEntry(): void {
  const err = $("#cmp-entry-error");
  $<HTMLFormElement>("#cmp-entry-paste").addEventListener("submit", (e) => {
    e.preventDefault();
    const run = runFromPasted(String(new FormData(e.target as HTMLFormElement).get("code") ?? ""));
    err.hidden = !!run;
    err.textContent = run ? "" : "This link or code looks damaged or edited. Paste the whole link, or ask for it again.";
    if (run) compareWith(run);
  });
  $<HTMLFormElement>("#cmp-entry-pick").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = allResults().find((x) => x.id === new FormData(e.target as HTMLFormElement).get("run"));
    err.hidden = true;
    if (r) compareWith(sharedRunFrom(r));
  });
  window.addEventListener("hashchange", refreshCompareEntry);
  refreshCompareEntry();
}

// Home: configuration (visible immediately, no reveal step)
export function buildConfigForm(leftover: InProgressRun | null = null): void {
  const cfg = loadConfig();
  // Don't preselect the settings that just crashed: start from the safer resolution instead.
  if (leftover && !leftover.scoreTest && leftover.resolution === cfg.resolution) {
    const safer = leftoverMessage(leftover).suggest;
    if (safer) {
      cfg.resolution = safer;
      saveConfig(cfg);
    }
  }
  $("#cfg-resolution").innerHTML = RESOLUTIONS.map((r) => radio("resolution", r.id, r.id === cfg.resolution, esc(r.id), `${r.width}×${r.height}`)).join("");
  $("#cfg-preset").innerHTML = PRESETS.map((p) => radio("preset", p.id, p.id === cfg.preset, p.id, PRESET_HINT[p.id])).join("");
  $("#cfg-duration").innerHTML = DURATIONS.map((d) => radio("duration", d, d === cfg.duration, `${d} s`)).join("");
  const form = $<HTMLFormElement>("#config");
  form.addEventListener("change", refreshRunHints);
  form.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-stop-compare]")) return;
    clearPending();
    shareTarget = null;
    refreshRunHints();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (app.running) return;
    const fd = new FormData(e.target as HTMLFormElement);
    const c: RunConfig = {
      resolution: fd.get("resolution") as ResolutionId,
      preset: fd.get("preset") as PresetId,
      duration: Number(fd.get("duration")),
    };
    saveConfig(c);
    void launch(c);
  });

  const scoreRuns = $("#score-runs");
  scoreRuns.innerHTML = SCORE_TESTS.map((t) => {
    const r = getResolution(t.resolution)!;
    return `<button type="button" class="btn btn-score" data-test="${t.id}"><b>${esc(t.name)}</b><small>${t.preset} · ${t.resolution} (${r.width}×${r.height}) · ${t.duration} s</small></button>`;
  }).join("");
  scoreRuns.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-test]");
    const t = SCORE_TESTS.find((x) => x.id === btn?.dataset.test);
    if (!t || app.running) return;
    void launch({ resolution: t.resolution, preset: t.preset, duration: t.duration, scoreTest: t.id });
  });

  bindCompareEntry();
  // A finished run clears its combo's hint; refresh whenever the page comes back home.
  window.addEventListener("hashchange", refreshRunHints);
  refreshRunHints();
  if (leftover) showLeftoverNotice(leftover);
}
