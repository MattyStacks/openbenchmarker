import { DURATIONS, PRESETS, RESOLUTIONS, SCORE_TESTS, getResolution, type PresetId, type ResolutionId } from "../benchmark/presets";
import { $, esc } from "./dom";
import { startRun } from "./run";
import { app } from "./shell";
import { loadConfig, saveConfig, type RunConfig } from "./store";

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

// Home: configuration (visible immediately, no reveal step)
export function buildConfigForm(): void {
  const cfg = loadConfig();
  $("#cfg-resolution").innerHTML = RESOLUTIONS.map((r) => radio("resolution", r.id, r.id === cfg.resolution, esc(r.id), `${r.width}×${r.height}`)).join("");
  $("#cfg-preset").innerHTML = PRESETS.map((p) => radio("preset", p.id, p.id === cfg.preset, p.id, PRESET_HINT[p.id])).join("");
  $("#cfg-duration").innerHTML = DURATIONS.map((d) => radio("duration", d, d === cfg.duration, `${d} s`)).join("");
  $<HTMLFormElement>("#config").addEventListener("submit", (e) => {
    e.preventDefault();
    if (app.running) return;
    const fd = new FormData(e.target as HTMLFormElement);
    const c: RunConfig = {
      resolution: fd.get("resolution") as ResolutionId,
      preset: fd.get("preset") as PresetId,
      duration: Number(fd.get("duration")),
    };
    saveConfig(c);
    void startRun(c);
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
    void startRun({ resolution: t.resolution, preset: t.preset, duration: t.duration, scoreTest: t.id });
  });
}
