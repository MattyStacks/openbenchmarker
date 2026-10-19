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

export const BENCHMARKS = [{ gameId: "opengpu_neon_flythrough", name: "OpenGPU Neon Flythrough" }] as const;
export const BENCHMARK = BENCHMARKS[0];
export const BENCHMARK_VERSION = "1.0.0";

export function findGpu(id: string): CatalogGpu | undefined {
  return GPU_CATALOG.find((g) => g.id === id);
}
