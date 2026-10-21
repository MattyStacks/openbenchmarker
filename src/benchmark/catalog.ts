import snapshot from "./gpu-catalog.json";

export interface CatalogGpu {
  id: string;
  name: string;
  vendor: string;
  formFactor: string;
}

/**
 * Dated snapshot of the upstream catalog (data/gpus/<form_factor>/<vendor>/*.yaml in
 * MattyStacks/open-gpu-benchmarks). Refresh with `npm run refresh-catalog`.
 */
export const CATALOG_SNAPSHOT_DATE: string = snapshot.snapshotDate;
export const GPU_CATALOG: readonly CatalogGpu[] = snapshot.gpus;

/** Sentinel for "my GPU is not in the catalog": blocks submission, never a gpu_id. */
export const NOT_LISTED = "__not_listed__";

export const UPSTREAM_REPO = "https://github.com/MattyStacks/open-gpu-benchmarks";
export const UPSTREAM_ISSUES = `${UPSTREAM_REPO}/issues/new/choose`;
export const UPSTREAM_TEMPLATES = `${UPSTREAM_REPO}/tree/main/templates`;

export const BENCHMARKS = [{ gameId: "openbenchmarker_neon_flythrough", name: "OpenBenchmarker Neon Flythrough" }] as const;
export const BENCHMARK = BENCHMARKS[0];
/**
 * 2.1.0: pipelined batches (two queued on the GPU via fences) instead of draining the GPU after
 * every batch, so GPU-limited runs keep the GPU busy; adds score runs and diagnostics. Same scene
 * and presets as 2.0.0, but GPU-limited FPS can be a few percent higher.
 * 2.0.0: new Neon Flythrough scene (procedural tower archetypes, sky-lane traffic, drone swarms,
 * rain streaks, height fog, skyline, a new 96 s 3D flight path) and reworked presets. The
 * workload is different, so 2.x scores aren't comparable with 1.x. Measurement is unchanged.
 * 1.1.0: no per-frame readback, Avg FPS is throughput. Not comparable with 1.0.0 scores.
 */
export const BENCHMARK_VERSION = "2.1.0";

export function findGpu(id: string): CatalogGpu | undefined {
  return GPU_CATALOG.find((g) => g.id === id);
}
