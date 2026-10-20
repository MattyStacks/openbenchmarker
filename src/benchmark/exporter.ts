import { BENCHMARK, UPSTREAM_REPO } from "./catalog";
import { round1 } from "./metrics";
import type { BenchResult, SystemInfo } from "./types";
import { PROOF_METHOD, validateSubmission } from "./validate";

const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars

/** Optional system fields in upstream order; blank ones are omitted entirely. */
const OPTIONAL_TEXT: [keyof SystemInfo, string][] = [
  ["osDetail", "os_detail"],
  ["cpu", "cpu"],
  ["memoryType", "memory_type"],
  ["driver", "driver"],
  ["distro", "distro"],
  ["kernel", "kernel"],
  ["mesa", "mesa"],
  ["proton", "proton"],
];

/** Upstream submission YAML (block style only). Throws if the result does not validate. */
export function toYaml(r: BenchResult): string {
  const errors = validateSubmission(r);
  if (errors.length) throw new Error(`Not submittable: ${errors.join("; ")}`);
  const s = r.system;
  const lines = [
    `# Captured by OpenBenchmarker ${r.benchmarkVersion} (https://openbenchmarker.com/), benchmark "${BENCHMARK.name}".`,
    `# Timed in the browser: Avg FPS = frames / wall-clock; lows from ${r.timing === "gpu-timer" ? "GPU timer queries" : "per-batch frame times"}. Hardware fields were entered by the submitter.`,
    `# Save as data/community/${s.gpuId}/${suggestedFileName(r, "yaml")} in a PR to ${UPSTREAM_REPO}`,
    `# Submitted data is public under CC BY 4.0 (data/LICENSE) and cannot be taken back.`,
    `gpu_id: ${s.gpuId}`,
    `game_id: ${r.gameId}`,
    `date: ${q(r.date)}`,
    `version: ${q(r.benchmarkVersion)}`,
    `frame_generation: false`,
    `result:`,
    `  - resolution: ${q(r.resolution)}`,
    `    time: ${q(r.time)}`,
    `    graphics_preset: ${q(r.preset)}`,
    `    avg_fps: ${round1(r.avgFps)}`,
    `    p1_low: ${round1(r.p1Low)}`,
    `    p5_low: ${round1(r.p5Low)}`,
    `    duration: ${r.durationS}`,
    `    frame_count: ${r.frameCount}`,
    `system:`,
    `  os: ${s.os}`,
  ];
  for (const [key, yamlKey] of OPTIONAL_TEXT) {
    const v = (s[key] ?? "").trim();
    if (v) lines.push(`  ${yamlKey}: ${q(v)}`);
    if (key === "cpu" && s.memoryGb.trim()) lines.push(`  memory_gb: ${Number(s.memoryGb.trim())}`);
  }
  lines.push(`  graphics_api: ${r.graphicsApi} # recorded from the WebGL context the run used`);
  lines.push(`proof:`, `  method: ${PROOF_METHOD} # captured by OpenBenchmarker (in-browser per-frame timing)`);
  return lines.join("\n") + "\n";
}

/** Entry for upstream data/games.yaml, added in the same PR (never guesses store IDs). */
export function gamesYamlEntry(year: number): string {
  return [
    `  - id: ${BENCHMARK.gameId}`,
    `    name: ${BENCHMARK.name}`,
    `    type: synthetic`,
    `    year: ${year}`,
    `    url: https://openbenchmarker.com/`,
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
  ["gpu_id", (r) => r.system.gpuId],
  ["os", (r) => r.system.os],
  ["os_detail", (r) => r.system.osDetail],
  ["cpu", (r) => r.system.cpu],
  ["memory_gb", (r) => r.system.memoryGb],
  ["memory_type", (r) => r.system.memoryType],
  ["driver", (r) => r.system.driver],
  ["distro", (r) => r.system.distro],
  ["kernel", (r) => r.system.kernel],
  ["mesa", (r) => r.system.mesa],
  ["proton", (r) => r.system.proton],
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
  return JSON.stringify({ ...r, submittable: errors.length === 0, blockingIssues: errors }, null, 2) + "\n";
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
