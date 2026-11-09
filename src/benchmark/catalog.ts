import snapshot from "./gpu-catalog.json";

/** Specs kept from a catalog file for pre-filling the results form; any of them may be missing. */
export interface GpuSpecs {
  memoryGb?: number;
  /** GPU memory type, e.g. GDDR7, or the shared system memory of a handheld (LPDDR5). */
  memoryType?: string;
  /** Graphics memory is system RAM (handhelds, integrated GPUs). */
  memoryShared?: boolean;
  architecture?: string;
  boostMhz?: number;
  tdpW?: number;
  /** A handheld's platform: maker, CPU, RAM speed (MT/s), shipped OS and screen. */
  oem?: string;
  cpu?: string;
  ramMts?: number;
  osShipped?: string;
  display?: string;
}

export interface CatalogGpu extends GpuSpecs {
  id: string;
  name: string;
  vendor: string;
  /** desktop, laptop, handheld or igpu (the upstream folder). */
  formFactor: string;
  /** The reference file this product builds on, when it has one. */
  base?: string;
}

/**
 * Dated snapshot of the upstream catalog (data/gpus/<form_factor>/<vendor>/*.yaml in
 * MattyStacks/open-gpu-benchmarks). Refresh with `npm run refresh-catalog`.
 */
export const CATALOG_SNAPSHOT_DATE: string = snapshot.snapshotDate;
export const GPU_CATALOG: readonly CatalogGpu[] = snapshot.gpus;

/**
 * Upstream reference files (data/gpus/reference/<vendor>/<id>.yaml): the shared specs of one GPU
 * chip and memory size, e.g. rtx_5090_laptop_24gb. Results never use them; they're the `base:` a
 * product builds on, and its id starts with them. Used to build the id of a GPU that isn't listed.
 */
export interface ReferenceGpu extends GpuSpecs {
  id: string;
  vendor: string;
  name: string;
}
export const GPU_REFERENCES: readonly ReferenceGpu[] = snapshot.references;

/** Dropdown groups, in order: upstream form factors with the names people know them by. */
export const FORM_FACTOR_GROUPS: readonly { formFactor: string; label: string }[] = [
  { formFactor: "desktop", label: "Desktop cards and PCs" },
  { formFactor: "laptop", label: "Laptop GPUs" },
  { formFactor: "handheld", label: "Handheld PCs" },
  { formFactor: "igpu", label: "Integrated graphics" },
];

/** How a product reads in the GPU list: its maker first for a handheld ("Valve Steam Deck LCD (16 GB)"). */
export function catalogLabel(g: CatalogGpu): string {
  const name = g.oem && !g.name.toLowerCase().startsWith(g.oem.toLowerCase()) ? `${g.oem} ${g.name}` : g.name;
  return g.memoryGb && !/\b\d+\s*GB\b/i.test(name) ? `${name} (${g.memoryGb} GB)` : name;
}

/** The catalog grouped by form factor for the GPU list, in FORM_FACTOR_GROUPS order, empty groups left out. */
export function catalogGroups(gpus: readonly CatalogGpu[] = GPU_CATALOG): { label: string; gpus: CatalogGpu[] }[] {
  const known = FORM_FACTOR_GROUPS.map((f) => f.formFactor);
  const groups = FORM_FACTOR_GROUPS.map((f) => ({ label: f.label, gpus: gpus.filter((g) => g.formFactor === f.formFactor) }));
  const other = gpus.filter((g) => !known.includes(g.formFactor));
  if (other.length) groups.push({ label: "Other", gpus: other });
  for (const g of groups) g.gpus.sort((a, b) => catalogLabel(a).localeCompare(catalogLabel(b)));
  return groups.filter((g) => g.gpus.length);
}

/** Sentinel for "my GPU is not in the catalog": blocks submission, never a gpu_id. */
export const NOT_LISTED = "__not_listed__";

export const UPSTREAM_REPO = "https://github.com/MattyStacks/open-gpu-benchmarks";
export const UPSTREAM_ISSUES = `${UPSTREAM_REPO}/issues/new/choose`;
export const UPSTREAM_TEMPLATES = `${UPSTREAM_REPO}/tree/main/templates`;
export const UPSTREAM_CATALOG_README = `${UPSTREAM_REPO}/blob/main/data/gpus/README.md#picking-the-id`;
export const DATA_LICENSE = `${UPSTREAM_REPO}/blob/main/data/LICENSE`;
export const CC_BY_DEED = "https://creativecommons.org/licenses/by/4.0/";
export const OGB_SITE = "https://opengpubenchmarks.com/";

/**
 * A prefilled (blank) GitHub issue asking for a GPU to be added to the catalog. The browser-reported
 * name is only a labelled starting point for the request; it never goes into a result. Nothing is
 * sent until the user clicks the link and submits the issue on GitHub themselves.
 */
export function gpuRequestUrl(gpuLabel: string | null | undefined): string {
  const label = (gpuLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  const body = [
    "**GPU to add:** <!-- the exact product: brand, model and memory, e.g. MSI GeForce RTX 5060 Ti 16 GB Ventus 2X OC -->",
    "",
    "**Form factor:** desktop / laptop / handheld <!-- keep one -->",
    "",
    "**Product or spec page:** <!-- optional link, helps get the details right -->",
    "",
    `**Reported by the browser (starting point, edit as needed):** ${label || "not shown by the browser"}`,
    "",
    "---",
    "Requested from Open GPU Benchmarker (https://opengpubenchmarker.com/). This is a catalog request only; it contains no benchmark result.",
  ].join("\n");
  const title = `GPU catalog request: ${label || "my GPU"}`;
  return `${UPSTREAM_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export const BENCHMARKS = [{ gameId: "openbenchmarker_neon_flythrough", name: "OpenBenchmarker Neon Flythrough" }] as const;
export const BENCHMARK = BENCHMARKS[0];
/**
 * 2.2.0: presets rebalanced for more GPU load (roughly 2x on a fast GPU at 4K): volumetric haze
 * (High+), more rain, bloom on Low, MSAA 8 on Medium and High (not reflections: they redraw the whole scene, so at high FPS the browser's GPU process became the limit), MSAA 8 and full
 * reflections on Ultra, an 8192 shadow map on Extreme, softer bloom on High+, a darker exposure overall and darker still on Extreme (denser neon). Not comparable with 2.1.0 scores.
 * 2.1.0: pipelined batches (two queued on the GPU via fences) instead of draining the GPU after
 * every batch, so GPU-limited runs keep the GPU busy; adds score runs and diagnostics. Same scene
 * and presets as 2.0.0, but GPU-limited FPS can be a few percent higher.
 * 2.0.0: new Neon Flythrough scene (procedural tower archetypes, sky-lane traffic, drone swarms,
 * rain streaks, height fog, skyline, a new 96 s 3D flight path) and reworked presets. The
 * workload is different, so 2.x scores aren't comparable with 1.x. Measurement is unchanged.
 * 1.1.0: no per-frame readback, Avg FPS is throughput. Not comparable with 1.0.0 scores.
 * 4.0.0: back to 2.2.0's presets and render loop (main thread, three batches queued). 3.x's
 * render worker starved fast GPUs on Windows (a 5080 ran at 25-55% GPU busy) and its 64-step haze
 * on every preset made Low too heavy for phones. The canvas now updates every other display
 * refresh: on every refresh, Edge 157 stalled at 4K (5080 High: 80 FPS instead of ~150). Same
 * frames as 2.2.0; not comparable with 3.x scores, and the new major keeps them apart.
 * 3.x (3.0.0-3.1.0): 64-step volumetric lighting on every preset, rendering in a worker with
 * display-paced previews. Withdrawn by 4.0.0.
 */
export const BENCHMARK_VERSION = "4.0.0";

export function findGpu(id: string): CatalogGpu | undefined {
  return GPU_CATALOG.find((g) => g.id === id);
}
