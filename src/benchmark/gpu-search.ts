import { GPU_CATALOG, GPU_REFERENCES, catalogLabel, type CatalogGpu, type ReferenceGpu } from "./catalog";
import { referenceFormFactor } from "./guess";
import type { GpuFormFactor } from "./gpu-id";

// ---------------------------------------------------------------------------
// The searchable GPU list: catalog products ("in the dataset") and reference chips ("known GPU,
// not in the dataset yet"), so almost any GPU can be found by typing a few characters of its name.
// Pure, so the ranking is unit-tested.
// ---------------------------------------------------------------------------

export type GpuOption =
  | { kind: "product"; id: string; label: string; detail: string; product: CatalogGpu }
  | { kind: "reference"; id: string; label: string; detail: string; ref: ReferenceGpu; formFactor: GpuFormFactor };

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
 * Options matching every word typed, best first: catalog products before reference chips, then
 * the ones where the typed words start the name, then shorter (more exact) names. Empty query:
 * the catalog products.
 */
export function searchGpus(query: string, limit = 12): GpuOption[] {
  const words = searchWords(query);
  const options = gpuOptions();
  if (!words.length) return options.filter((o) => o.kind === "product").slice(0, limit);
  const scored: { o: GpuOption; score: number }[] = [];
  for (const o of options) {
    const hay = searchWords(`${o.label} ${o.id} ${o.kind === "product" ? (o.product.oem ?? "") : ""}`);
    // Each typed word must start some word of the option ("50" finds 5080 and 5090; "xt" finds XT).
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    const exactWords = words.filter((w) => hay.includes(w)).length;
    const first = searchWords(o.label)[0]?.startsWith(words[0]) ? 1 : 0;
    scored.push({ o, score: (o.kind === "product" ? 1000 : 0) + exactWords * 50 + first * 20 - o.label.length });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.o);
}
