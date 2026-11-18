import { GPU_REFERENCES } from "./catalog";

// ---------------------------------------------------------------------------
// Building the catalog id of a GPU that isn't listed yet, from what the lookup command printed
// (pasted by the user; the page never reads the system). Ids follow the upstream catalog rules
// (data/gpus/README.md): lowercase letters, digits and single underscores, one <n>gb token, and
// desktop and laptop ids start with their reference ("base") id, and a handheld names its device first. For a product whose exact model
// isn't known, this tool uses `reference` (proposed upstream in docs/upstream-submission-changes.md):
//   laptop                        <base>_reference             rtx_5090_laptop_24gb_reference
//   desktop, chip vendor's card   <base>_fe | _reference | _le rtx_5080_16gb_fe
//   desktop, brand and line       <base>_<brand>_<line>        rtx_5080_16gb_gigabyte_gaming_oc
//   desktop, brand only           <base>_<brand>_reference     rtx_5080_16gb_gigabyte_reference
//   desktop, brand unknown        <base>_reference             rtx_5080_16gb_reference
//   handheld                      <device>_<chip>_<ram>gb      rog_ally_z1_extreme_16gb
//   integrated (shared memory)    <chip>_shared_reference      arc_140v_shared_reference, radeon_780m_shared_reference
// A handheld's memory token is its system RAM, which the GPU shares. Any other GPU that shares
// system memory has no size of its own: `shared` takes the token's place, its catalog file is an
// igpu file, and the RAM goes with each run (docs/upstream-submission-changes.md, section 7).
// Integrated chips with no reference file are named as sold, without the company: iris_xe,
// uhd_620, radeon_780m, radeon_vega_8; Intel's older HD Graphics are intel_hd_4000, since hd_ is
// AMD's Radeon HD in the catalog.
// ---------------------------------------------------------------------------

export type GpuFormFactor = "desktop" | "laptop" | "handheld";
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

/** The word in place of the <n>gb token for an integrated GPU, which shares system memory. */
export const SHARED_TOKEN = "shared";

/** Upstream gpu_id rule: lowercase letters, digits and single underscores, with exactly one memory token (`16gb`, or `shared`). */
export function isCatalogIdShape(id: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id) && id.split("_").filter((t) => /^\d+gb$/.test(t) || t === SHARED_TOKEN).length === 1;
}

/** A reference for a chip that shares system memory (arc_140v, z1_extreme): outside a handheld, its ID says `shared`. */
export function isSharedReference(id: string): boolean {
  return !!GPU_REFERENCES.find((r) => r.id === id)?.memoryShared;
}

/**
 * A discrete GPU's reference with no memory size in its id, because the chip was sold with more
 * than one (hd_7790: 1 GB and 2 GB). Its products add the size after it: hd_7790_2gb_<brand>_<line>,
 * with `base: hd_7790`. Not shared-memory chips (z1_extreme, arc_140v): they have no VRAM to add.
 */
export function isSizelessReference(id: string): boolean {
  const ref = GPU_REFERENCES.find((r) => r.id === id);
  return !!ref && !ref.memoryShared && !id.split("_").some((t) => /^\d+gb$/.test(t));
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * Integrated graphics with no reference file, from the name the system or browser gives it: its
 * chip ("Intel(R) Iris(R) Xe Graphics" → iris_xe, "Intel(R) UHD Graphics 620" → uhd_620, "AMD
 * Radeon 780M" → radeon_780m, "AMD Radeon(TM) Vega 8 Graphics" → radeon_vega_8, "Intel(R) HD
 * Graphics 4000" → intel_hd_4000), "" when the name doesn't say which chip ("AMD Radeon(TM)
 * Graphics", "Intel(R) UHD Graphics"), or null when it isn't integrated graphics.
 */
function integratedName(name: string): string | null {
  const bracket = /\[([^\]]+)\][^[]*$/.exec(name);
  const n = ` ${(bracket ? bracket[1] : name)
    .replace(/\((?:R|TM)\)|[®™]/gi, " ")
    .replace(/\b(intel|amd|corporation|graphics|gpu)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()} `;
  const named =
    /^ (uhd|iris(?: plus| pro)?) (\d{3,4}) $/.exec(n) ??
    /^ (iris xe) $/.exec(n) ??
    // AMD's integrated chips end in M or S (Radeon 780M, 8060S); discrete ones say RX, Pro or HD.
    /^ (radeon) (\d{3,4}[ms]) $/.exec(n);
  if (named) return slug(named.slice(1).join(" "));
  // Vega 3 to 11 are integrated; the discrete ones are RX Vega 56 and 64.
  const vega = /^ (?:radeon )?vega ([1-9]|1[01]) $/.exec(n);
  if (vega) return `radeon_vega_${vega[1]}`;
  const hd = /^ hd (\d{3,4}) $/.exec(n);
  if (hd && /intel/i.test(name)) return `intel_hd_${hd[1]}`;
  // Named only by family: Radeon Graphics (a Ryzen APU), Intel Graphics, UHD Graphics, Arc Graphics (Meteor Lake).
  if (/^ (radeon|uhd|hd|iris|iris plus|arc)? $/.test(n) && /intel|amd|radeon|uhd|iris/i.test(name)) return "";
  return null;
}

/** The chip of integrated graphics with no reference file (radeon_780m), or "" (see integratedName). */
export function integratedChip(name: string): string {
  return integratedName(name) || "";
}

/** Integrated graphics whose name doesn't say which chip it is: "AMD Radeon(TM) Graphics". */
export function isUnnamedIntegrated(name: string): boolean {
  return integratedName(name) === "";
}

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
    const t = /computer type:\s*(laptop|desktop|handheld)/i.exec(line);
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
  const rank = (g: DetectedGpu) => (INTEGRATED.test(g.name) || integratedName(g.name) !== null ? 0 : 1);
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
    .replace(/\(\s*\d+\s*GB\s*\)|\b\d+\s*GB\b/gi, " ")
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

/** The longest reference id inside a product id: at the start (cards, laptops) or after a handheld's device name. */
export function referenceIn(id: string): string | undefined {
  const t = `_${id}_`;
  return GPU_REFERENCES.map((r) => r.id)
    .filter((r) => t.includes(`_${r}_`))
    .sort((a, b) => Number(id.startsWith(`${b}_`) || id === b) - Number(id.startsWith(`${a}_`) || id === a) || b.length - a.length)[0];
}

/** Valve's PCI subsystem vendor id. */
export const VALVE_PCI = "1e44";

/**
 * A catalog product the lookup output names outright, even though its GPU name doesn't: Valve's
 * machines show up as plain AMD chips ("Navi 33 [Radeon Graphics]", "VanGogh [AMD Custom GPU 0405]").
 */
export function knownProduct(g: Pick<DetectedGpu, "name" | "vramGb" | "board">): string | null {
  if (/navi ?33/i.test(g.name) && g.board === VALVE_PCI) return "steam_machine_8gb_valve";
  if (/vangogh|custom gpu 0405/i.test(g.name)) return "steam_deck_lcd_16gb";
  return null;
}

/** The GPU vendor of a reference or product id. */
export function vendorOf(id: string): GpuVendor | null {
  const refId = referenceIn(id);
  // A handheld's id carries its RAM, not the chip's memory, so also match the chip without its memory token.
  const chipOnly = (r: string) => r.replace(/_\d+gb(?=_|$)/, "");
  const ref = refId
    ? GPU_REFERENCES.find((r) => r.id === refId)
    : GPU_REFERENCES.filter((r) => `_${id}_`.includes(`_${chipOnly(r.id)}_`)).sort((a, b) => chipOnly(b.id).length - chipOnly(a.id).length)[0];
  if (ref && (ref.vendor === "nvidia" || ref.vendor === "amd" || ref.vendor === "intel")) return ref.vendor;
  if (/^(rtx|gtx|gt|titan|quadro)_/.test(id)) return "nvidia";
  // Intel's integrated graphics (iris_xe, uhd_620, intel_hd_4000), before AMD's hd_.
  if (/^(uhd|iris|intel)_/.test(id)) return "intel";
  if (/^(rx|hd|r[579]|radeon|vega|w\d)/.test(id)) return "amd";
  if (/^arc_/.test(id)) return "intel";
  return null;
}

export interface IdChoice {
  base: string;
  formFactor: GpuFormFactor;
  /** Desktop only: "" not sure, "own" the GPU vendor's own card, or a board brand token. */
  maker?: string;
  /** Desktop, with a brand: the product line from the box, e.g. "Gaming OC". Handheld: the device, e.g. "ROG Ally X". */
  line?: string;
  /** Handheld only: system RAM in GB, which the GPU shares (the id's memory token). */
  ramGb?: number | null;
  /** Integrated graphics with no reference file (radeon_780m): shared memory, like a shared reference. */
  shared?: boolean;
}

/** A handheld's id: device, chip, RAM. The chip's own memory token, if any, gives way to the RAM. */
function handheldId(base: string, line: string, ramGb: number | null | undefined): string {
  const chip = ramGb ? base.replace(/_\d+gb(?=_|$)/, "") : base;
  return [slug(line), chip, ramGb ? `${ramGb}gb` : ""].filter(Boolean).join("_");
}

/** The product id, per the convention at the top of this file. */
export function buildGpuId({ base, formFactor, maker = "", line = "", ramGb, shared }: IdChoice): string {
  if (formFactor === "handheld") return handheldId(base, line, ramGb);
  // Integrated, in a laptop or a desktop PC: the chip, shared, and like laptops no maker or model.
  if (shared || isSharedReference(base)) return `${base}_${SHARED_TOKEN}_reference`;
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
export function productName(gpuName: string, { base, formFactor, maker = "", line = "", ramGb, shared }: IdChoice): string {
  const clean = gpuName
    .replace(/^.*\[([^\]]+)\].*$/, "$1")
    .replace(/\((?:R|TM)\)|[®™]/gi, "")
    .replace(/\(\s*\d+\s*GB\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (formFactor === "laptop" || (formFactor !== "handheld" && (shared || isSharedReference(base)))) return clean;
  if (formFactor === "handheld") return [line.trim() || clean, ramGb ? `${ramGb} GB` : ""].filter(Boolean).join(" ");
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
  // An integrated GPU's file: form factor igpu, shared memory and no capacity (the RAM is on each run).
  const shared = id.split("_").includes(SHARED_TOKEN);
  const fileFormFactor = shared ? "igpu" : formFactor;
  const found = referenceIn(id);
  // Cards, laptops and integrated GPUs start with their reference; a handheld names its device first.
  const base = found && (fileFormFactor === "handheld" || id.startsWith(`${found}_`)) ? found : undefined;
  const rest = base && id.startsWith(`${base}_`) ? id.slice(base.length + 1) : "";
  const partner = fileFormFactor === "desktop" ? BOARD_BRANDS.find((b) => rest === b.token || rest.startsWith(`${b.token}_`))?.label.split(" /")[0] : undefined;
  const yaml = [
    `id: ${id}`,
    ...(base ? [`base: ${base}`] : []),
    `identity:`,
    `  name: ${yq(name.trim() || id)}`,
    `  gpu_vendor: ${vendor}`,
    ...(partner ? [`  board_partner: ${partner}`] : []),
    `classification:`,
    `  form_factor: ${fileFormFactor}`,
    `memory:`,
    ...(shared ? [] : [`  capacity_gb: ${Number(/(?:^|_)(\d+)gb(?:_|$)/.exec(id)![1])}`]),
    ...(shared || fileFormFactor === "handheld" ? [`  shared: true`] : []),
  ].join("\n");
  return { path: `data/gpus/${fileFormFactor}/${vendor}/${id}.yaml`, yaml: `${yaml}\n` };
}
