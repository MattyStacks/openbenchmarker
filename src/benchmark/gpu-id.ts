import { GPU_REFERENCES } from "./catalog";

// ---------------------------------------------------------------------------
// Building the catalog id of a GPU that isn't listed yet, from what the lookup command printed
// (pasted by the user; the page never reads the system). Ids follow the upstream catalog rules
// (data/gpus/README.md): lowercase letters, digits and single underscores, one <n>gb token, and
// desktop and laptop ids start with their reference ("base") id. For a product whose exact model
// isn't known, this tool uses `reference` (proposed upstream in docs/upstream-submission-changes.md):
//   laptop                        <base>_reference             rtx_5090_laptop_24gb_reference
//   desktop, chip vendor's card   <base>_fe | _reference | _le rtx_5080_16gb_fe
//   desktop, brand and line       <base>_<brand>_<line>        rtx_5080_16gb_gigabyte_gaming_oc
//   desktop, brand only           <base>_<brand>_reference     rtx_5080_16gb_gigabyte_reference
//   desktop, brand unknown        <base>_reference             rtx_5080_16gb_reference
// ---------------------------------------------------------------------------

export type GpuFormFactor = "desktop" | "laptop";
export type GpuVendor = "nvidia" | "amd" | "intel";

export interface DetectedGpu {
  /** As the system names it, e.g. "NVIDIA GeForce RTX 5090 Laptop GPU". */
  name: string;
  vramGb: number | null;
  /** PCI subsystem vendor, 4 lowercase hex digits: the board's maker (a laptop's OEM), or "". */
  board: string;
}

export interface GpuInfo {
  formFactor: GpuFormFactor | null;
  /** Discrete GPUs first, then by VRAM. */
  gpus: DetectedGpu[];
}

/** Upstream gpu_id rule: lowercase letters, digits and single underscores, with exactly one memory token. */
export function isCatalogIdShape(id: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id) && id.split("_").filter((t) => /^\d+gb$/.test(t)).length === 1;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const IGNORED = /basic (display|render)|remote|virtual|parsec|displaylink|mirror|indirect/i;
/** Integrated GPUs, which share system memory: never preferred over a discrete one. */
const INTEGRATED = /\b(uhd|iris|hd graphics)\b|intel\(r\) graphics|radeon\(tm\) graphics|^amd radeon graphics|arc\(tm\) 1[34]0[vt]|\barc 1[34]0[vt]\b|radeon \d{3}m\b/i;

/**
 * The GPUs and computer type in pasted output: this tool's GPU command ("Computer type: laptop",
 * "GPU: <name> (<n> GB) [board 17aa]"), its older form, or raw nvidia-smi CSV. Extra lines are ignored.
 */
export function parseGpuInfo(text: string): GpuInfo {
  let formFactor: GpuFormFactor | null = null;
  const gpus: DetectedGpu[] = [];
  for (const raw of String(text ?? "").split(/\r?\n|;/)) {
    const line = raw.trim();
    const t = /computer type:\s*(laptop|desktop)/i.exec(line);
    if (t) {
      formFactor = t[1].toLowerCase() as GpuFormFactor;
      continue;
    }
    const labelled = /^(?:GPU[^:]*:)?\s*(.*?\S)\s*\((\d+|\?)\s*GB\)\s*(?:\[board\s+([0-9a-f]{4}|\?)\])?$/i.exec(line);
    const smi = labelled ? null : /^(?:GPU[^:]*:)?\s*(.*?\S),\s*(\d+)\s*MiB\b/i.exec(line);
    const m = labelled ?? smi;
    if (!m || /:$/.test(m[1]) || IGNORED.test(m[1])) continue;
    const v = m[2] === "?" ? null : Number(m[2]);
    const vramGb = v === null ? null : smi ? Math.round(v / 1024) : v;
    const board = m[3] && m[3] !== "?" && m[3] !== "0000" ? m[3].toLowerCase() : "";
    if (!gpus.some((g) => g.name === m[1])) gpus.push({ name: m[1], vramGb: vramGb || null, board });
  }
  const rank = (g: DetectedGpu) => (INTEGRATED.test(g.name) ? 0 : 1);
  gpus.sort((a, b) => rank(b) - rank(a) || (b.vramGb ?? 0) - (a.vramGb ?? 0));
  return { formFactor, gpus };
}

/**
 * The chip part of a reference id, for each reading of the name: "NVIDIA GeForce RTX 5090 Laptop
 * GPU" → rtx_5090_laptop, "AMD Radeon RX 7600M XT" → rx_7600m_xt, "Intel(R) Arc(TM) B580
 * Graphics" → arc_b580. lspci names use the [bracketed] part, and "Radeon RX 9070/9070 XT/9070 GRE"
 * gives one reading per model.
 */
export function chipTokens(name: string): string[] {
  const bracket = /\[([^\]]+)\]/.exec(name);
  const base = (bracket ? bracket[1] : name)
    .replace(/\((?:R|TM)\)|[®™]/gi, " ")
    .replace(/\(\s*\d+\s*GB\s*\)/gi, " ")
    .replace(/\b(nvidia|geforce|amd|ati|radeon|intel|graphics|gpu|corporation)\b/gi, " ");
  const parts = base.split("/").map((p) => p.trim()).filter((p) => /\d/.test(p));
  if (!parts.length) return [];
  // "RX 9070/9070 XT/9070 GRE": later models repeat only the number, so they take the first one's prefix.
  const prefix = /^(.*?)(?=\S*\d)/.exec(parts[0])?.[1] ?? "";
  const tokens = parts.map((p, i) =>
    slug(i > 0 && /^\d/.test(p) ? `${prefix}${p}` : p)
      // NVIDIA's mobile chips are "Laptop" in the catalog (lspci says "Mobile").
      .replace(/_mobile\b/, "_laptop"),
  );
  return [...new Set(tokens)].filter(Boolean);
}

export interface ReferenceMatch {
  /** The reference the product builds on, when one fits exactly. */
  base: string | null;
  /** Every reference for this chip (other memory sizes, or several chips in an lspci name). */
  options: string[];
  /** The base to use when no reference exists yet: chip and memory, e.g. rtx_6090_32gb. */
  fallback: string | null;
}

const REF_IDS = new Set(GPU_REFERENCES.map((r) => r.id));

/** The reference ids that fit a detected GPU. */
export function referenceMatches(gpu: Pick<DetectedGpu, "name" | "vramGb">): ReferenceMatch {
  const tokens = chipTokens(gpu.name);
  const options = GPU_REFERENCES.map((r) => r.id).filter((id) => tokens.some((t) => id === t || new RegExp(`^${t}_\\d+gb$`).test(id)));
  // Several readings that all fit (lspci's "9070/9070 XT/9070 GRE" at 16 GB) leave it to the user.
  const exact = gpu.vramGb ? tokens.map((t) => `${t}_${gpu.vramGb}gb`).filter((id) => REF_IDS.has(id)) : [];
  const base = exact.length === 1 ? exact[0] : !exact.length && options.length === 1 ? options[0] : null;
  const fallback = tokens.length && gpu.vramGb ? `${tokens[0]}_${gpu.vramGb}gb` : null;
  return { base, options, fallback };
}

export interface BoardBrand {
  token: string;
  label: string;
}

/** Board makers, by PCI subsystem vendor id where it's known. */
export const BOARD_BRANDS: readonly (BoardBrand & { pci?: string })[] = [
  { token: "asus", label: "ASUS", pci: "1043" },
  { token: "msi", label: "MSI", pci: "1462" },
  { token: "gigabyte", label: "Gigabyte", pci: "1458" },
  { token: "sapphire", label: "Sapphire", pci: "1da2" },
  { token: "asrock", label: "ASRock", pci: "1849" },
  { token: "powercolor", label: "PowerColor", pci: "148c" },
  { token: "xfx", label: "XFX", pci: "1682" },
  { token: "zotac", label: "Zotac", pci: "19da" },
  { token: "pny", label: "PNY", pci: "196e" },
  { token: "palit", label: "Palit", pci: "1569" },
  { token: "gainward", label: "Gainward", pci: "10b0" },
  { token: "evga", label: "EVGA", pci: "3842" },
  { token: "galax", label: "Galax / KFA2", pci: "1b4c" },
  { token: "colorful", label: "Colorful", pci: "7377" },
  { token: "acer", label: "Acer", pci: "1025" },
  { token: "inno3d", label: "Inno3D" },
  { token: "sparkle", label: "Sparkle" },
];

/** The word for a card made by the GPU's own vendor (upstream rule). */
export const OWN_CARD: Record<GpuVendor, { token: string; label: string; pci: string }> = {
  nvidia: { token: "fe", label: "Founders Edition", pci: "10de" },
  amd: { token: "reference", label: "AMD reference card", pci: "1002" },
  intel: { token: "le", label: "Limited Edition", pci: "8086" },
};

/** Who made a desktop card, from its PCI subsystem vendor: a board brand, the GPU vendor itself ("own"), or unknown. */
export function boardOf(board: string): { brand: string } | { own: true } | null {
  if (!board) return null;
  if (Object.values(OWN_CARD).some((o) => o.pci === board)) return { own: true };
  const b = BOARD_BRANDS.find((x) => x.pci === board);
  return b ? { brand: b.token } : null;
}

/** The GPU vendor of a reference or product id. */
export function vendorOf(id: string): GpuVendor | null {
  const ref = GPU_REFERENCES.find((r) => id === r.id || id.startsWith(`${r.id}_`));
  if (ref && (ref.vendor === "nvidia" || ref.vendor === "amd" || ref.vendor === "intel")) return ref.vendor;
  if (/^(rtx|gtx|gt|titan|quadro)_/.test(id)) return "nvidia";
  if (/^(rx|hd|r[579]|radeon|vega|w\d)/.test(id)) return "amd";
  if (/^arc_/.test(id)) return "intel";
  return null;
}

export interface IdChoice {
  base: string;
  formFactor: GpuFormFactor;
  /** Desktop only: "" not sure, "own" the GPU vendor's own card, or a board brand token. */
  maker?: string;
  /** Desktop only, with a brand: the product line from the box, e.g. "Gaming OC". */
  line?: string;
}

/** The product id, per the convention at the top of this file. */
export function buildGpuId({ base, formFactor, maker = "", line = "" }: IdChoice): string {
  if (formFactor === "laptop") return `${base}_reference`;
  if (maker === "own") {
    const v = vendorOf(base);
    return `${base}_${v ? OWN_CARD[v].token : "reference"}`;
  }
  const l = slug(line);
  if (maker) return `${base}_${maker}_${l || "reference"}`;
  return `${base}_reference`;
}

/** A name for the product, e.g. "Gigabyte GeForce RTX 5080 Gaming OC", from the system's name for the GPU. */
export function productName(gpuName: string, { base, formFactor, maker = "", line = "" }: IdChoice): string {
  const clean = gpuName
    .replace(/^.*\[([^\]]+)\].*$/, "$1")
    .replace(/\((?:R|TM)\)|[®™]/gi, "")
    .replace(/\(\s*\d+\s*GB\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (formFactor === "laptop") return clean;
  if (maker === "own") {
    const v = vendorOf(base);
    return v ? `${clean} ${OWN_CARD[v].label}` : clean;
  }
  const brand = BOARD_BRANDS.find((b) => b.token === maker)?.label.split(" /")[0];
  return [brand, clean, line.trim()].filter(Boolean).join(" ");
}

export interface CatalogFile {
  path: string;
  yaml: string;
}

const yq = (s: string) => JSON.stringify(s);

/**
 * The upstream catalog file for a product that isn't listed yet: the required fields, plus `base:`
 * when its reference exists and the board partner when the id names one. Null when the id doesn't
 * follow the rules or its vendor can't be told.
 */
export function catalogFile(id: string, name: string, formFactor: GpuFormFactor): CatalogFile | null {
  if (!isCatalogIdShape(id)) return null;
  const vendor = vendorOf(id);
  if (!vendor) return null;
  const capacity = Number(/(?:^|_)(\d+)gb(?:_|$)/.exec(id)![1]);
  const base = GPU_REFERENCES.map((r) => r.id)
    .filter((r) => id.startsWith(`${r}_`))
    .sort((a, b) => b.length - a.length)[0];
  const rest = base ? id.slice(base.length + 1) : "";
  const partner = formFactor === "desktop" ? BOARD_BRANDS.find((b) => rest === b.token || rest.startsWith(`${b.token}_`))?.label.split(" /")[0] : undefined;
  const yaml = [
    `id: ${id}`,
    ...(base ? [`base: ${base}`] : []),
    `identity:`,
    `  name: ${yq(name.trim() || id)}`,
    `  gpu_vendor: ${vendor}`,
    ...(partner ? [`  board_partner: ${partner}`] : []),
    `classification:`,
    `  form_factor: ${formFactor}`,
    `memory:`,
    `  capacity_gb: ${capacity}`,
  ].join("\n");
  return { path: `data/gpus/${formFactor}/${vendor}/${id}.yaml`, yaml: `${yaml}\n` };
}
