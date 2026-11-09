// Real-GPU regression check: runs scripts/profile-run.mjs over a preset × resolution matrix on this
// machine and compares each config with this machine's baseline in docs/performance/baselines/.
// A scheduling change tuned on one machine must not starve another (3.1.0 fed a Windows RTX 5080
// only 25-55% of the time while a Linux 2080 Ti looked fine), so run it on every test machine.
//
// Machine setup lives in an untracked .perf-machine.json (or PERF_MACHINE_FILE), never in the repo:
//   { "id": "win11-rtx5080-edge",                 // baseline file name
//     "url": "http://localhost:5179",             // a running dev server (npm run dev -- --port 5179)
//     "launch": "…",                              // optional shell command run before each config,
//                                                 //   e.g. start the browser with --remote-debugging-port
//     "launchWaitMs": 5000,
//     "env": { "PW_CDP_URL": "http://127.0.0.1:9333", "BENCH_HEADED": "1",
//              "GPU_BUSY_CMD": "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits" } }
//
//   node scripts/perf-matrix.mjs            compare with the baseline (exit 1 on a regression)
//   node scripts/perf-matrix.mjs --record   write the baseline from this run
//   PERF_CONFIGS="Low/720p,Ultra/4K"        run a subset
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const machine = JSON.parse(readFileSync(process.env.PERF_MACHINE_FILE || join(root, ".perf-machine.json"), "utf8"));
const record = process.argv.includes("--record");
const baselineFile = join(root, "docs/performance/baselines", `${machine.id}.json`);
const DEFAULT_CONFIGS = ["Low/720p", "Low/4K", "Medium/4K", "High/4K", "Ultra/4K", "Extreme/4K"];
const configs = (process.env.PERF_CONFIGS?.split(",") ?? DEFAULT_CONFIGS).map((c) => c.trim()).filter(Boolean);
/** Allowed drop from the baseline: FPS share, timer coverage and OS GPU busy in points. */
const TOLERANCE = { fps: 0.05, timer: 0.03, os: 3 };

async function measure(config) {
  const [preset, res] = config.split("/");
  if (machine.launch) {
    execSync(machine.launch, { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, machine.launchWaitMs ?? 5000));
  }
  const out = join(tmpdir(), `perf-matrix-${process.pid}.jsonl`);
  rmSync(out, { force: true });
  const run = spawnSync(process.execPath, [join(root, "scripts/profile-run.mjs")], {
    env: { ...process.env, ...machine.env, BENCH_URL: machine.url, BENCH_PRESET: preset, BENCH_RES: res, BENCH_REPEATS: "1", BENCH_OUT: out, BENCH_LABEL: config },
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (run.status !== 0 || !existsSync(out)) throw new Error(`${config}: profile run failed`);
  const r = JSON.parse(readFileSync(out, "utf8").trim().split("\n").at(-1));
  rmSync(out, { force: true });
  return {
    fps: Math.round(r.renderFps * 10) / 10,
    timerCoverage: r.timerCoverage == null ? null : Math.round(r.timerCoverage * 1000) / 1000,
    osGpuBusy: r.osGpuBusySteady ? Math.round(r.osGpuBusySteady.mean * 10) / 10 : null,
    version: r.result?.benchmarkVersion,
    renderer: r.renderer,
  };
}

const results = {};
for (const config of configs) {
  results[config] = await measure(config);
  const m = results[config];
  console.log(`${config.padEnd(11)} ${String(m.fps).padStart(8)} FPS  timer ${m.timerCoverage ?? "–"}  OS GPU ${m.osGpuBusy ?? "–"}%`);
}

if (record) {
  mkdirSync(dirname(baselineFile), { recursive: true });
  const first = Object.values(results)[0];
  writeFileSync(baselineFile, JSON.stringify({ machine: machine.id, renderer: first?.renderer, version: first?.version, recorded: new Date().toISOString().slice(0, 10), configs: results }, null, 2) + "\n");
  console.log(`Baseline written: ${baselineFile}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const failures = [];
for (const [config, m] of Object.entries(results)) {
  const b = baseline.configs[config];
  if (!b) { console.log(`${config}: no baseline, not compared`); continue; }
  if (m.fps < b.fps * (1 - TOLERANCE.fps)) failures.push(`${config}: ${m.fps} FPS vs baseline ${b.fps}`);
  if (b.timerCoverage != null && m.timerCoverage != null && m.timerCoverage < b.timerCoverage - TOLERANCE.timer) failures.push(`${config}: GPU timer coverage ${m.timerCoverage} vs baseline ${b.timerCoverage}`);
  if (b.osGpuBusy != null && m.osGpuBusy != null && m.osGpuBusy < b.osGpuBusy - TOLERANCE.os) failures.push(`${config}: OS GPU busy ${m.osGpuBusy}% vs baseline ${b.osGpuBusy}%`);
}
if (failures.length) {
  console.error(`\nRegressions against ${baselineFile}:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nNo regressions against ${machine.id} (${baseline.version}, ${baseline.recorded}).`);
