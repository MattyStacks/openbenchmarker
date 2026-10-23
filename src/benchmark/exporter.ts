import { BENCHMARK, UPSTREAM_REPO } from "./catalog";
import { diagnose, isMaskedRenderer } from "./diagnose";
import { round1 } from "./metrics";
import { WARMUP_SECONDS } from "./presets";
import { SYSTEM_FIELDS, type SystemField } from "./fields";
import type { BenchResult } from "./types";
import { PROOF_METHOD, validateSubmission } from "./validate";

const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct1 = (x: number) => Math.round(x * 1000) / 10;

/** Run details nested under the result item: settings actually rendered and the diagnosis signals. */
function runDetailLines(r: BenchResult): string[] {
  const lines: string[] = [];
  if (r.score !== undefined && r.scoreTest) lines.push(`    score: ${r.score}`, `    score_test: ${r.scoreTest}`);
  lines.push(
    `    worst_frame_ms: ${r2(r.worstMs)}`,
    `    render_width: ${r.width}`,
    `    render_height: ${r.height}`,
    `    warmup_s: ${WARMUP_SECONDS}`,
    `    timing_method: ${r.timing ?? "unknown"}`,
  );
  const d = r.diag;
  if (!d) return lines;
  const dx = diagnose(r);
  lines.push(
    `    rendered_with:`,
    `      bloom: ${d.features.bloom}`,
    `      msaa: ${d.features.msaa}`,
    `      shadow_map: ${d.features.shadowMap}`,
    `      reflections: ${d.features.reflections}`,
    `      volumetrics: ${d.features.volumetrics ?? 0}`,
    `    diagnostics:`,
    `      limit: ${dx.verdict}`,
    `      limit_estimated: ${dx.estimated}`,
  );
  if (d.gpuBusy !== null) lines.push(`      gpu_busy_pct: ${pct1(d.gpuBusy)}`);
  if (d.gpuMs !== null) lines.push(`      gpu_ms_per_frame: ${r2(d.gpuMs)}`);
  lines.push(
    `      frame_ms: ${r2(d.frameMs)}`,
    `      cpu_ms_per_frame: ${r2(d.cpuMs)}`,
    `      scene_update_ms_per_frame: ${r2(d.updateMs)}`,
    `      gpu_wait_ms_per_frame: ${r2(d.syncMs)}`,
    `      loop_busy_pct: ${pct1(r.loopBusy)}`,
    `      main_thread_stalls: ${d.stalls}`,
    `      stall_ms: ${Math.round(d.stallMs)}`,
    `      hitches: ${d.hitches}`,
    `      frame_time_std_ms: ${r2(d.frameStdMs)}`,
  );
  return lines;
}

/** Read from the browser by the run, never entered by the user; kept apart from system:. */
function detectedLines(r: BenchResult): string[] {
  const d = r.diag;
  if (!d) return [];
  const lines = [`detected: # read from the browser by the run, not entered by the submitter`];
  // Masked strings (Brave reports "Brave") would only mislead; leave them out.
  if (!isMaskedRenderer(d.renderer)) lines.push(`  webgl_renderer: ${q(d.renderer)}`, `  webgl_vendor: ${q(d.vendor)}`);
  if (d.backend) lines.push(`  angle_backend: ${q(d.backend)}`);
  if (d.cpuThreads !== null) lines.push(`  cpu_threads: ${d.cpuThreads}`);
  if (d.onBattery !== null) lines.push(`  on_battery: ${d.onBattery}`);
  lines.push(`  browser: ${q(d.browser)}`);
  return lines;
}

function yamlScalar(f: SystemField, v: string): string {
  if (f.kind === "digits") return String(Number(v));
  if (f.kind === "yesno") return String(v === "yes");
  return f.kind === "choice" ? v : q(v);
}

/** Upstream submission YAML (block style only). Throws if the result does not validate. */
export function toYaml(r: BenchResult): string {
  const errors = validateSubmission(r);
  if (errors.length) throw new Error(`Not submittable: ${errors.join("; ")}`);
  const s = r.system;
  const lines = [
    `# Captured by Open GPU Benchmarker ${r.benchmarkVersion} (https://opengpubenchmarker.com/), benchmark "${BENCHMARK.name}".`,
    `# Timed in the browser: Avg FPS = frames / wall-clock; lows from ${r.timing === "gpu-timer" ? "GPU timer queries" : "per-batch frame times"}. Hardware fields under system: were entered by the submitter; detected: was read from the browser.`,
    `# Save as data/community/${s.gpuId}/${suggestedFileName(r, "yaml")} in a PR to ${UPSTREAM_REPO}`,
    `# Submitted data is public under CC BY 4.0 (data/LICENSE) and cannot be taken back.`,
    `gpu_id: ${s.gpuId}`,
    `game_id: ${r.gameId}`,
    `date: ${q(r.date)}`,
    `version: ${q(r.benchmarkVersion)}`,
    `frame_generation: false`,
    ...(s.overclocked === "yes" || s.overclocked === "no" ? [`overclocked: ${s.overclocked === "yes"}`] : []),
    `result:`,
    `  - resolution: ${q(r.resolution)}`,
    `    time: ${q(r.time)}`,
    `    graphics_preset: ${q(r.preset)}`,
    `    avg_fps: ${round1(r.avgFps)}`,
    `    p1_low: ${round1(r.p1Low)}`,
    `    p5_low: ${round1(r.p5Low)}`,
    `    duration: ${r.durationS}`,
    `    frame_count: ${r.frameCount}`,
    ...runDetailLines(r),
    `system:`,
  ];
  // Blank optional fields are omitted entirely; a suggested value says so in a comment.
  for (const f of SYSTEM_FIELDS) {
    if (f.section !== "system") continue;
    const v = (s[f.key] ?? "").trim();
    if (v) lines.push(`  ${f.yaml}: ${yamlScalar(f, v)}${r.suggested?.includes(f.key) ? " # assumed, not confirmed" : ""}`);
  }
  lines.push(`  graphics_api: ${r.graphicsApi} # recorded from the WebGL context the run used`);
  lines.push(...detectedLines(r));
  lines.push(`proof:`, `  method: ${PROOF_METHOD} # captured by Open GPU Benchmarker (in-browser per-frame timing)`);
  return lines.join("\n") + "\n";
}

/** Entry for upstream data/games.yaml, added in the same PR (never guesses store IDs). */
export function gamesYamlEntry(year: number): string {
  return [
    `  - id: ${BENCHMARK.gameId}`,
    `    name: ${BENCHMARK.name}`,
    `    type: synthetic`,
    `    year: ${year}`,
    `    url: https://opengpubenchmarker.com/`,
    `    notes: Browser WebGL2 benchmark; fixed-path neon city flythrough with per-frame timing.`,
  ].join("\n");
}

const CSV_FIELDS: [string, (r: BenchResult) => string | number][] = [
  ["status", (r) => (validateSubmission(r).length ? (r.valid ? "incomplete" : "invalid") : "complete")],
  ["invalid_reason", (r) => r.invalidReason],
  ["game_id", (r) => r.gameId],
  ["benchmark_version", (r) => r.benchmarkVersion],
  ["date", (r) => r.date],
  ["time", (r) => r.time],
  ["resolution", (r) => r.resolution],
  ["width", (r) => r.width],
  ["height", (r) => r.height],
  ["graphics_preset", (r) => r.preset],
  ["duration_s", (r) => r.durationS],
  ["graphics_api", (r) => r.graphicsApi],
  ["avg_fps", (r) => round1(r.avgFps)],
  ["p1_low", (r) => round1(r.p1Low)],
  ["p5_low", (r) => round1(r.p5Low)],
  ["worst_frame_ms", (r) => Math.round(r.worstMs * 100) / 100],
  ["frame_count", (r) => r.frameCount],
  ["timing", (r) => r.timing ?? ""],
  ["score_test", (r) => r.scoreTest ?? ""],
  ["score", (r) => r.score ?? ""],
  ["limit", (r) => (r.diag ? diagnose(r).verdict : "")],
  ["gpu_busy_pct", (r) => (r.diag?.gpuBusy != null ? pct1(r.diag.gpuBusy) : "")],
  ["gpu_ms_per_frame", (r) => (r.diag?.gpuMs != null ? r2(r.diag.gpuMs) : "")],
  ["frame_ms", (r) => (r.diag ? r2(r.diag.frameMs) : "")],
  ["cpu_ms_per_frame", (r) => (r.diag ? r2(r.diag.cpuMs) : "")],
  ["scene_update_ms_per_frame", (r) => (r.diag ? r2(r.diag.updateMs) : "")],
  ["gpu_wait_ms_per_frame", (r) => (r.diag ? r2(r.diag.syncMs) : "")],
  ["loop_busy_pct", (r) => pct1(r.loopBusy ?? 0)],
  ["main_thread_stalls", (r) => r.diag?.stalls ?? ""],
  ["stall_ms", (r) => (r.diag ? Math.round(r.diag.stallMs) : "")],
  ["hitches", (r) => r.diag?.hitches ?? ""],
  ["frame_time_std_ms", (r) => (r.diag ? r2(r.diag.frameStdMs) : "")],
  ["heap_growth_mb", (r) => (r.diag?.heapGrowthMb != null ? Math.round(r.diag.heapGrowthMb) : "")],
  ["bloom", (r) => (r.diag ? String(r.diag.features.bloom) : "")],
  ["msaa", (r) => r.diag?.features.msaa ?? ""],
  ["shadow_map", (r) => r.diag?.features.shadowMap ?? ""],
  ["reflections", (r) => r.diag?.features.reflections ?? ""],
  ["volumetrics", (r) => r.diag?.features.volumetrics ?? ""],
  ["fallback_reason", (r) => r.diag?.features.fallbackReason ?? ""],
  ["detected_webgl_renderer", (r) => (r.diag && !isMaskedRenderer(r.diag.renderer) ? r.diag.renderer : "")],
  ["detected_webgl_vendor", (r) => (r.diag && !isMaskedRenderer(r.diag.renderer) ? r.diag.vendor : "")],
  ["detected_angle_backend", (r) => r.diag?.backend ?? ""],
  ["detected_cpu_threads", (r) => r.diag?.cpuThreads ?? ""],
  ["detected_on_battery", (r) => (r.diag?.onBattery != null ? String(r.diag.onBattery) : "")],
  ["detected_browser", (r) => r.diag?.browser ?? ""],
  ...SYSTEM_FIELDS.map((f): [string, (r: BenchResult) => string] => [f.yaml, (r) => r.system?.[f.key] ?? ""]),
  ["suggested_fields", (r) => (r.suggested ?? []).map((k) => SYSTEM_FIELDS.find((f) => f.key === k)?.yaml ?? k).join(" ")],
];

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(results: BenchResult[]): string {
  const rows = [CSV_FIELDS.map(([h]) => h).join(",")];
  for (const r of results) rows.push(CSV_FIELDS.map(([, f]) => csvCell(f(r))).join(","));
  return rows.join("\n") + "\n";
}

/** JSON export; always available, with completeness stated inside. */
export function toJson(r: BenchResult): string {
  const errors = validateSubmission(r);
  const diagnosis = r.diag ? diagnose(r) : undefined;
  // The compared-with run belongs to someone else (or another session): not part of this export.
  const { challenge: _compared, ...own } = r;
  void _compared;
  return JSON.stringify({ ...own, diagnosis, submittable: errors.length === 0, blockingIssues: errors }, null, 2) + "\n";
}

export function suggestedFileName(r: BenchResult, ext: "yaml" | "json" | "csv"): string {
  return `result_${r.date.replace(/-/g, "")}_${r.gameId}.${ext}`;
}

export function download(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
