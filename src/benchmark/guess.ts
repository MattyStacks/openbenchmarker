import { GPU_CATALOG, GPU_REFERENCES, NOT_LISTED, findGpu, type CatalogGpu, type ReferenceGpu } from "./catalog";
import { isMaskedRenderer } from "./diagnose";
import { buildGpuId, chipTokens, type GpuFormFactor } from "./gpu-id";
import type { BenchResult, SystemInfo, SystemProbe } from "./types";

// ---------------------------------------------------------------------------
// Best guesses for the results form, from what the browser reported during the run: the WebGL
// renderer, the OS, UA Client Hints, memory, screen and battery (src/app/probe.ts). Pure, so the
// rules are unit-tested. Every guess is marked as suggested with where it came from, and the user
// can change or clear it. Nothing here reads the system: browsers only expose these few signals.
// ---------------------------------------------------------------------------

export interface Guess {
  values: Partial<SystemInfo>;
  why: Partial<Record<keyof SystemInfo, string>>;
  /** The catalog product the browser named outright (Valve's machines), if any. */
  device: CatalogGpu | null;
  /** The GPU name read from the renderer, e.g. "NVIDIA GeForce RTX 5080"; "" when masked. */
  gpuName: string;
}

/** A machine the renderer names outright, and the specs that come with it. */
interface DeviceRule {
  id: string;
  test: RegExp;
  cpu?: string;
  memoryChannels?: string;
  /** Linux only: the distro it ships with. */
  distro?: string;
}

// Mesa names Valve's GPUs after the machine, so the renderer string says what the device is.
// The CPU names are what /proc/cpuinfo reports on each. A Steam Deck OLED reports the same GPU
// codename as the LCD, so it's guessed as the LCD (the only Steam Deck in the catalog) until the
// catalog lists the OLED.
const DEVICE_RULES: readonly DeviceRule[] = [
  { id: "steam_machine_8gb_valve", test: /steam machine|\bfremont\b/i, cpu: "AMD Custom CPU 1772", distro: "SteamOS" },
  // The Steam Deck's APU runs its LPDDR5 as four 32-bit channels.
  { id: "steam_deck_lcd_16gb", test: /vangogh|custom gpu 0405|steam deck/i, cpu: "AMD Custom APU 0405", memoryChannels: "4", distro: "SteamOS" },
];

/**
 * The GPU's own name from a WebGL renderer string, without the ANGLE wrapper, device id, backend or
 * driver details: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0,
 * D3D11)" gives "NVIDIA GeForce RTX 5080"; "ANGLE (AMD, AMD Steam Machine (radeonsi navi33 ACO),
 * OpenGL ES 3.2)" gives "AMD Steam Machine". Firefox's ", or similar" stays, so callers can tell
 * it's approximate. "" when the browser hides it.
 */
export function rendererGpuName(renderer: string | null | undefined): string {
  let s = (renderer ?? "").trim();
  if (!s || isMaskedRenderer(s)) return "";
  const angle = /^ANGLE \((.*)\)$/.exec(s);
  if (angle) {
    // Split on commas outside parentheses: [vendor, device, backend].
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of angle[1]) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    parts.push(cur.trim());
    s = parts.length > 1 ? parts[1] : parts[0];
    // "Vulkan 1.4.350 (AMD Steam Machine (RADV NAVI33) (0x00007481))": the device is inside.
    const wrapped = /^(?:Vulkan|OpenGL(?: ES)?|Metal)[\d. ]*\((.*)\)$/i.exec(s);
    if (wrapped) s = wrapped[1];
  }
  return s
    .replace(/\s*\(0x[0-9a-f]+\)/gi, "")
    .replace(/\s+(?:Direct3D\d*|D3D\d+)\b.*$/i, "")
    .replace(/\s*\((?:radeonsi|RADV|LLVM|DRM|iris|crocus|zink|nouveau|llvmpipe)\b[^)]*\)/gi, "")
    .replace(/\s+Mesa \d.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mesa's version, when the renderer or version string carries it ("... Mesa 24.2.5"). */
export function mesaVersion(text: string | null | undefined): string {
  return /\bMesa (\d+\.\d+(?:\.\d+)?)/i.exec(text ?? "")?.[1] ?? "";
}

/** desktop, laptop or handheld for a reference chip, from its upstream id. */
export function referenceFormFactor(r: Pick<ReferenceGpu, "id" | "memoryShared">): GpuFormFactor {
  // Mobile chips: rtx_4070_laptop, rx_7600m, rx_6800s, r9_m290x, arc_a370m; shared-memory chips (Arc 140V, Radeon 780M) ship in laptops too.
  const tokens = r.id.split("_");
  if (tokens.includes("laptop") || tokens.some((t) => /^a?\d{3,4}[ms]$|^m\d{3,4}x?$/.test(t))) return "laptop";
  return r.memoryShared ? "laptop" : "desktop";
}

/** References whose chip matches a GPU name ("NVIDIA GeForce RTX 5060 Ti" → both 5060 Ti memory sizes). */
export function referencesFor(name: string): ReferenceGpu[] {
  const tokens = chipTokens(name);
  return GPU_REFERENCES.filter((r) => tokens.some((t) => r.id === t || new RegExp(`^${t}_\\d+gb$`).test(r.id)));
}

/** Catalog products built on those references (an exact product the browser can't tell apart from its siblings). */
function productsFor(refs: readonly ReferenceGpu[]): CatalogGpu[] {
  const ids = new Set(refs.map((r) => r.id));
  return GPU_CATALOG.filter((g) => g.base && ids.has(g.base));
}

/** Windows 11 from UA Client Hints (platformVersion 13 or more); Windows 10 below. "" when unknown. */
export function windowsVersion(platformVersion: string | null | undefined): string {
  const major = Number((platformVersion ?? "").split(".")[0]);
  if (!platformVersion || !Number.isFinite(major)) return "";
  return major >= 13 ? "Windows 11" : major > 0 ? "Windows 10" : "";
}

type GuessInput = Pick<BenchResult, "device" | "diag" | "probe" | "mobile">;

const FROM_BROWSER = "from your browser";

/** Best guesses for every field the browser gives a clue about. Fields with no clue are left out. */
export function guessSystem(r: GuessInput): Guess {
  const values: Partial<SystemInfo> = {};
  const why: Partial<Record<keyof SystemInfo, string>> = {};
  const set = (k: keyof SystemInfo, v: string | undefined | null, reason: string) => {
    if (v) {
      values[k] = v;
      why[k] = reason;
    }
  };
  const renderer = r.diag?.renderer ?? "";
  const gpuName = rendererGpuName(renderer) || r.device?.gpuLabel || "";
  const approximate = /, or similar$/i.test(gpuName);
  const os = r.device?.os;
  const p: SystemProbe | undefined = r.probe;

  if (os === "windows" || os === "linux") set("os", os, FROM_BROWSER);
  if (os === "windows") set("osDetail", windowsVersion(p?.platformVersion), "from your browser: add the release");

  // 1. A machine the renderer names outright.
  const rule = DEVICE_RULES.find((d) => d.test.test(renderer) || d.test.test(gpuName));
  const device = rule ? (findGpu(rule.id) ?? null) : null;
  if (rule && device) {
    const spec = `${device.name} spec`;
    set("gpuId", device.id, FROM_BROWSER);
    set("cpu", rule.cpu, spec);
    // Soldered memory is part of the device; the Steam Machine's RAM can be swapped, so it isn't.
    if (device.formFactor === "handheld" && device.memoryShared) {
      set("memoryGb", device.memoryGb ? String(device.memoryGb) : "", spec);
      set("memoryType", device.memoryType && device.ramMts ? `${device.memoryType}-${device.ramMts}` : "", spec);
      set("memoryChannels", rule.memoryChannels, spec);
    }
    if (os === "linux" && rule.distro) {
      set("distro", rule.distro, spec);
      set("osDetail", rule.distro, spec);
    }
  } else if (gpuName && !approximate) {
    // 2. A GPU the catalog lists, or a known chip it doesn't list yet.
    const refs = referencesFor(gpuName);
    const products = productsFor(refs);
    // The browser can't see the board maker: one listed product for this chip is the best guess.
    if (products.length === 1) set("gpuId", products[0].id, "from your browser: check it's your exact card");
    else if (refs.length) {
      const ref = refs.length === 1 ? refs[0] : null;
      const formFactor: GpuFormFactor = /laptop/i.test(gpuName) || p?.battery?.charging === false ? "laptop" : ref ? referenceFormFactor(ref) : "desktop";
      set("gpuId", NOT_LISTED, FROM_BROWSER);
      set("gpuName", ref ? `${ref.name}${ref.memoryGb && formFactor !== "handheld" ? ` ${ref.memoryGb} GB` : ""}` : gpuName, FROM_BROWSER);
      set("gpuFormFactor", formFactor, FROM_BROWSER);
      // One memory size: the id is complete. Several (8 and 16 GB): the user picks it.
      if (ref && formFactor !== "handheld") set("gpuIdRequested", buildGpuId({ base: ref.id, formFactor }), "built from the GPU your browser reports");
    }
  }

  // 3. Mesa, where the browser shows it (not Chromium; some Firefox builds on Linux).
  const mesa = os === "linux" ? mesaVersion(renderer) : "";
  if (mesa) {
    set("mesa", mesa, FROM_BROWSER);
    set("driver", `Mesa ${mesa}`, FROM_BROWSER);
  }

  // 4. Memory: Chromium reports a rounded-down power of two. Too rough to beat a device's spec.
  if (!values.memoryGb && p?.deviceMemoryGb && p.deviceMemoryGb >= 4 && !r.mobile) {
    set("memoryGb", String(p.deviceMemoryGb), "browser rounds down: check it");
  }
  return { values, why, device, gpuName };
}

/**
 * Applies the guesses to a result once: only to blank fields (the user's own values and carried
 * details win), marking each one suggested with its reason. Later loads leave it alone, so a guess
 * the user cleared stays cleared.
 */
export function applyGuesses<T extends BenchResult>(r: T): T {
  if (r.guessed) return r;
  const g = guessSystem(r);
  const system = { ...r.system };
  const suggested = new Set(r.suggested ?? []);
  const why = { ...(r.suggestedWhy ?? {}) };
  // A GPU already chosen keeps its own details; guesses only fill around it.
  const gpuChosen = !!system.gpuId.trim();
  for (const [k, v] of Object.entries(g.values) as [keyof SystemInfo, string][]) {
    if (system[k]?.trim()) continue;
    if (gpuChosen && (k === "gpuId" || k === "gpuName" || k === "gpuIdRequested" || k === "gpuFormFactor")) continue;
    system[k] = v;
    suggested.add(k);
    why[k] = g.why[k] ?? "suggested";
  }
  return {
    ...r,
    system,
    guessed: true,
    ...(suggested.size ? { suggested: [...suggested] } : {}),
    ...(Object.keys(why).length ? { suggestedWhy: why } : {}),
  };
}
