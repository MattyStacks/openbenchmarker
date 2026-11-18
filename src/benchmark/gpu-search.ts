import { GPU_CATALOG, GPU_REFERENCES, catalogLabel, type CatalogGpu, type ReferenceGpu } from "./catalog";
import { referenceFormFactor, rendererGpuName } from "./guess";
import { integratedChip, productName, type GpuFormFactor } from "./gpu-id";

// ---------------------------------------------------------------------------
// The searchable GPU list: catalog products ("in the dataset"), reference chips ("known GPU, not in
// the dataset yet") and common integrated GPUs with no reference file, so almost any GPU can be
// found by typing a few characters of its name.
// Pure, so the ranking is unit-tested.
// ---------------------------------------------------------------------------

export type GpuOption =
  | { kind: "product"; id: string; label: string; detail: string; product: CatalogGpu }
  | { kind: "reference"; id: string; label: string; detail: string; ref: ReferenceGpu; formFactor: GpuFormFactor }
  /** Integrated graphics with no reference file: `id` is its chip (radeon_780m), and its ID says shared. */
  | { kind: "integrated"; id: string; label: string; detail: string; formFactor: GpuFormFactor };

/**
 * Common integrated GPUs that have no reference file, named as the system names them. Each name
 * gives its chip through integratedChip (radeon_780m, iris_xe, uhd_620, intel_hd_4000).
 */
export const INTEGRATED_GPUS: readonly string[] = [
  ...["610M", "660M", "680M", "740M", "760M", "780M", "840M", "860M", "880M", "890M", "8050S", "8060S"].map((n) => `AMD Radeon ${n}`),
  ...[3, 6, 7, 8, 9, 10, 11].map((n) => `AMD Radeon Vega ${n} Graphics`),
  "Intel Iris Xe Graphics",
  ...[640, 645, 650, 655].map((n) => `Intel Iris Plus Graphics ${n}`),
  ...[600, 605, 610, 615, 617, 620, 630, 710, 730, 750, 770].map((n) => `Intel UHD Graphics ${n}`),
  ...[4000, 4400, 4600, 5500, 520, 530, 620, 630].map((n) => `Intel HD Graphics ${n}`),
];

const INTEGRATED_DETAIL = "Integrated · shared memory";

function integratedOption(label: string, chip = integratedChip(label)): GpuOption {
  return { kind: "integrated", id: chip, label, detail: INTEGRATED_DETAIL, formFactor: "laptop" };
}

const VENDOR: Record<string, string> = { nvidia: "NVIDIA", amd: "AMD", intel: "Intel" };
const FF_WORD: Record<string, string> = { desktop: "Desktop", laptop: "Laptop", handheld: "Handheld PC", igpu: "Integrated" };

function specLine(s: { architecture?: string; memoryGb?: number; memoryType?: string; memoryShared?: boolean; boostMhz?: number; tdpW?: number }): string {
  return [
    s.architecture,
    s.memoryGb ? `${s.memoryGb} GB${s.memoryType ? ` ${s.memoryType}` : ""}${s.memoryShared ? " shared" : ""}` : s.memoryShared ? "shared memory" : "",
    s.boostMhz ? `${s.boostMhz} MHz boost` : "",
    s.tdpW ? `${s.tdpW} W` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "GeForce RTX 5080 16 GB": a reference's name with its memory size, which tells sizes apart. */
export function referenceLabel(r: ReferenceGpu): string {
  const name = /^(GeForce|Radeon|Arc|Ryzen|Core)/i.test(r.name) && VENDOR[r.vendor] ? `${VENDOR[r.vendor]} ${r.name}` : r.name;
  return r.memoryGb && !/\b\d+\s*GB\b/i.test(name) ? `${name} ${r.memoryGb} GB` : name;
}

let all: GpuOption[] | null = null;
export function gpuOptions(): GpuOption[] {
  all ??= [
    ...GPU_CATALOG.map(
      (g): GpuOption => ({ kind: "product", id: g.id, label: catalogLabel(g), detail: [FF_WORD[g.formFactor] ?? g.formFactor, specLine(g)].filter(Boolean).join(" · "), product: g }),
    ),
    ...GPU_REFERENCES.map((r): GpuOption => {
      const formFactor = referenceFormFactor(r);
      return { kind: "reference", id: r.id, label: referenceLabel(r), detail: [FF_WORD[formFactor], specLine(r)].filter(Boolean).join(" · "), ref: r, formFactor };
    }),
    ...INTEGRATED_GPUS.map((name) => integratedOption(name)),
  ];
  return all;
}

/** Lowercase words, with letters and digits split apart ("rtx5080" → "rtx 5080") and ids' underscores as spaces. */
export function searchWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[_\-/(),.®™]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z]{2,})/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A GPU's name as the browser or a driver shows it, down to the words a catalog name has:
 * "Mesa Intel(R) Arc(TM) A770 Graphics (DG2)" or "NVIDIA GeForce RTX 2080 Ti/PCIe/SSE2" can be
 * pasted straight into the search.
 */
function queryName(query: string): string {
  return (rendererGpuName(query) || query).replace(/\((?:R|TM)\)|[®™]/gi, " ").replace(/\b(graphics|gpu|corporation)\b/gi, " ");
}

/**
 * Options matching every word typed, best first: catalog products before reference chips, then
 * the ones where the typed words start the name, then shorter (more exact) names. Empty query:
 * the catalog products.
 */
export function searchGpus(query: string, limit = 12): GpuOption[] {
  const words = searchWords(queryName(query));
  const options = gpuOptions();
  if (!words.length) return options.filter((o) => o.kind === "product").slice(0, limit);
  const scored: { o: GpuOption; score: number }[] = [];
  for (const o of options) {
    const hay = searchWords(`${o.label} ${o.id} ${o.kind === "product" ? (o.product.oem ?? "") : ""}`);
    // Each typed word must start some word of the option ("50" finds 5080 and 5090; "xt" finds XT).
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    const exactWords = words.filter((w) => hay.includes(w)).length;
    const first = searchWords(o.label)[0]?.startsWith(words[0]) ? 1 : 0;
    // The typed words together, in order ("vega 8" in Radeon Vega 8, not RX Vega 56 8 GB).
    const inOrder = words.length > 1 && ` ${searchWords(o.label).join(" ")} `.includes(` ${words.join(" ")} `) ? 1 : 0;
    scored.push({ o, score: (o.kind === "product" ? 1000 : 0) + exactWords * 50 + inOrder * 30 + first * 20 - o.label.length });
  }
  const found = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.o);
  // Integrated graphics the list doesn't have, typed by name ("Radeon 660M"): offered all the same.
  const chip = integratedChip(queryName(query).replace(/\s+/g, " ").trim());
  if (chip && !found.some((o) => o.id === chip)) found.push(integratedOption(productName(rendererGpuName(query) || query, { base: chip, formFactor: "laptop", shared: true }), chip));
  return found.slice(0, limit);
}
