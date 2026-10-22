import { isMaskedRenderer } from "../benchmark/diagnose";
import type { BrowserId, DeviceContext, DeviceType, OsId } from "../benchmark/types";

/**
 * Device detection for display and sharing only. Pure: every function takes
 * plain inputs so it can be unit-tested in Node (Vitest `environment: "node"`).
 * Results never fill `SystemInfo` and are never submitted.
 */

export interface BrandEntry {
  brand: string;
  version: string;
}

export interface DeviceInputs {
  ua: string;
  brands?: BrandEntry[] | null;
  /** From `navigator.brave.isBrave()` (async in the browser); sync callers pass `"brave" in navigator`. */
  isBrave?: boolean;
  /** `navigator.platform`, or high-entropy `platform` when available. */
  platform?: string;
  maxTouchPoints?: number;
  renderer?: string;
  vendor?: string;
}

const majorOf = (v: string | undefined): number | null => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

function brandEntry(brands: BrandEntry[] | null | undefined, re: RegExp): BrandEntry | undefined {
  return brands?.find((b) => re.test(b.brand));
}

function uaMajor(ua: string, re: RegExp): number | null {
  const m = re.exec(ua);
  return m ? majorOf(m[1]) : null;
}

/** Browser + major version. Brands win; Brave needs its flag (its UA says Chrome); UA is the fallback. */
export function parseBrowser(ua: string, brands?: BrandEntry[] | null, isBrave?: boolean): { browser: BrowserId; browserMajor: number | null } {
  const chromeMajor = () => uaMajor(ua, /Chrome\/(\d+)/) ?? uaMajor(ua, /CriOS\/(\d+)/) ?? majorOf(brandEntry(brands, /Chromium|Chrome/i)?.version);
  if (isBrave) return { browser: "brave", browserMajor: chromeMajor() };
  const edge = brandEntry(brands, /Microsoft Edge/i);
  if (edge) return { browser: "edge", browserMajor: majorOf(edge.version) };
  const operaBrand = brandEntry(brands, /^Opera/i);
  if (operaBrand) return { browser: "opera", browserMajor: majorOf(operaBrand.version) };
  const braveBrand = brandEntry(brands, /^Brave/i);
  if (braveBrand) return { browser: "brave", browserMajor: majorOf(braveBrand.version) ?? chromeMajor() };
  const samsungBrand = brandEntry(brands, /Samsung/i);
  if (samsungBrand) return { browser: "samsung", browserMajor: majorOf(samsungBrand.version) };
  const vivaldiBrand = brandEntry(brands, /Vivaldi/i);
  if (vivaldiBrand) return { browser: "vivaldi", browserMajor: majorOf(vivaldiBrand.version) ?? chromeMajor() };

  if (/SamsungBrowser\//.test(ua)) return { browser: "samsung", browserMajor: uaMajor(ua, /SamsungBrowser\/(\d+)/) };
  if (/Edg(iOS|A)?\//.test(ua)) return { browser: "edge", browserMajor: uaMajor(ua, /Edg(?:iOS|A)?\/(\d+)/) };
  if (/OPR\/|Opera/.test(ua)) return { browser: "opera", browserMajor: uaMajor(ua, /OPR\/(\d+)/) ?? uaMajor(ua, /Version\/(\d+)/) };
  if (/Vivaldi\//.test(ua)) return { browser: "vivaldi", browserMajor: uaMajor(ua, /Vivaldi\/(\d+)/) };
  if (/FxiOS\//.test(ua)) return { browser: "firefox", browserMajor: uaMajor(ua, /FxiOS\/(\d+)/) };
  if (/Firefox\//.test(ua)) return { browser: "firefox", browserMajor: uaMajor(ua, /Firefox\/(\d+)/) };
  if (/CriOS\//.test(ua)) return { browser: "chrome", browserMajor: uaMajor(ua, /CriOS\/(\d+)/) };
  if (/Chrome\//.test(ua)) return { browser: "chrome", browserMajor: chromeMajor() };
  if (/Safari\//.test(ua)) return { browser: "safari", browserMajor: uaMajor(ua, /Version\/(\d+)/) };
  return { browser: "other", browserMajor: null };
}

export function parseOs(ua: string, platform = "", maxTouchPoints = 0): OsId {
  const p = platform || "";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS Safari reports a desktop Mac UA; touch points are the only signal.
  if ((/Macintosh/.test(ua) || /Mac OS X/.test(ua)) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua) || /^Android$/i.test(p)) return "android";
  if (/CrOS/.test(ua) || /Chrome OS/i.test(p)) return "chromeos";
  if (/Windows/.test(ua) || /^Win/i.test(p)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua) || /^Mac/i.test(p)) return "macos";
  if (/Linux/.test(ua) || /Linux/i.test(p)) return "linux";
  return "other";
}

export function parseDeviceType(ua: string, os: OsId, maxTouchPoints = 0): DeviceType {
  if (/iPad/.test(ua)) return "tablet";
  if ((/Macintosh/.test(ua) || /Mac OS X/.test(ua)) && maxTouchPoints > 1 && os === "ios") return "tablet";
  if (/iPhone|iPod/.test(ua)) return "phone";
  if (os === "android") return /Mobile/.test(ua) ? "phone" : "tablet";
  if (os === "ios") return "phone";
  if (os === "windows" || os === "macos" || os === "linux" || os === "chromeos") return "desktop";
  if (/Mobile/.test(ua)) return "phone";
  if (/Tablet/.test(ua)) return "tablet";
  return "unknown";
}

const BACKEND_TAIL = /^(?:D3D\d+|Vulkan|OpenGL(?: ES)?(?: \d+(?:\.\d+)*)?|Metal|Direct3D\d+)$/i;

/**
 * Normalize a WebGL renderer string into a short label, always understood as
 * "reported by the browser". Strips ANGLE wrapper, hex device ids, backend /
 * shader-model suffixes and duplicate vendor prefixes. Max ~40 chars.
 * Returns null when masked or unusable (Brave farbling, "unavailable", ...).
 */
export function normalizeGpuLabel(renderer: string | null | undefined, vendor?: string | null): string | null {
  let s = (renderer ?? "").trim();
  if (!s || isMaskedRenderer(s)) return null;
  const angle = /^ANGLE \((.*)\)$/.exec(s);
  if (angle) {
    const parts = angle[1].split(",").map((x) => x.trim()).filter(Boolean);
    while (parts.length > 1 && BACKEND_TAIL.test(parts[parts.length - 1])) parts.pop();
    // Parts are typically [vendor, "GPU (0x..) Backend ...", backend]; pick the longest GPU part.
    s = parts.length ? parts.reduce((a, b) => (b.length > a.length ? b : a)) : "";
    s = s.replace(/\s*\((?:0x[0-9a-fA-F]+|\d+)\)\s*/g, " ").trim();
    s = s.replace(/\s+(?:Direct3D\d+|D3D\d+|Vulkan|OpenGL(?: ES)?|Metal)\b.*$/i, "").trim();
    s = s.replace(/\s+vs_\d+_\d+.*$/i, "").trim();
  } else {
    s = s.replace(/\s*\((?:0x[0-9a-fA-F]+)\)\s*/g, " ").trim();
  }
  // Strip a duplicated leading vendor, e.g. "NVIDIA NVIDIA GeForce ..." or vendor repeated from `vendor`.
  const words = s.split(/\s+/);
  if (words.length > 1 && words[0].toLowerCase() === words[1].toLowerCase()) s = words.slice(1).join(" ");
  const v = (vendor ?? "").replace(/^Google Inc\. \(|\)$/g, "").trim();
  if (v && s.toLowerCase().startsWith(`${v.toLowerCase()} ${v.toLowerCase()} `)) s = s.slice(v.length + 1);
  s = s.replace(/\s+/g, " ").replace(/[\s,;]+$/, "").trim();
  if (!s || isMaskedRenderer(s)) return null;
  if (s.length > 40) {
    const cut = s.slice(0, 40);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 20 ? cut.slice(0, sp) : cut).trim();
  }
  return s || null;
}

export function deviceContextFrom(inputs: DeviceInputs): DeviceContext {
  const { browser, browserMajor } = parseBrowser(inputs.ua ?? "", inputs.brands, inputs.isBrave);
  const os = parseOs(inputs.ua ?? "", inputs.platform ?? "", inputs.maxTouchPoints ?? 0);
  return {
    browser,
    browserMajor,
    os,
    deviceType: parseDeviceType(inputs.ua ?? "", os, inputs.maxTouchPoints ?? 0),
    webkitEngine: os === "ios",
    gpuLabel: normalizeGpuLabel(inputs.renderer, inputs.vendor),
  };
}

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  brave?: { isBrave?: () => Promise<boolean> };
  userAgentData?: {
    brands?: BrandEntry[];
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
  };
}

function readNavigator(): NavigatorLike {
  return navigator as unknown as NavigatorLike;
}

/** Sync browser read: uses `"brave" in navigator` for Brave, like the existing BRAVE check. */
export function detectDeviceContext(renderer?: string, vendor?: string): DeviceContext {
  try {
    const nav = readNavigator();
    return deviceContextFrom({
      ua: nav.userAgent ?? "",
      brands: nav.userAgentData?.brands ?? null,
      isBrave: "brave" in navigator,
      platform: nav.userAgentData?.platform ?? nav.platform ?? "",
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      renderer,
      vendor,
    });
  } catch {
    return deviceContextFrom({ ua: "", renderer, vendor });
  }
}

/** Async read: awaits `navigator.brave.isBrave()` and high-entropy platform when available. */
export async function detectDeviceContextAsync(renderer?: string, vendor?: string): Promise<DeviceContext> {
  try {
    const nav = readNavigator();
    let isBrave = "brave" in navigator;
    try {
      if (nav.brave?.isBrave) isBrave = await nav.brave.isBrave();
    } catch { /* keep sync hint */ }
    let platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    let brands = nav.userAgentData?.brands ?? null;
    try {
      const hi = await nav.userAgentData?.getHighEntropyValues?.(["platform", "brands"]);
      if (hi) {
        if (typeof hi.platform === "string" && hi.platform) platform = hi.platform;
        if (Array.isArray(hi.brands)) brands = hi.brands as BrandEntry[];
      }
    } catch { /* high-entropy hints are optional */ }
    return deviceContextFrom({ ua: nav.userAgent ?? "", brands, isBrave, platform, maxTouchPoints: nav.maxTouchPoints ?? 0, renderer, vendor });
  } catch {
    return detectDeviceContext(renderer, vendor);
  }
}
