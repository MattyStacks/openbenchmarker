import { shareBlocker, sharedRunFrom } from "../benchmark/share-codec";
import type { BenchResult, DeviceContext } from "../benchmark/types";
import { missingLabels, validateSubmission } from "../benchmark/validate";
import { browserLabel, osLabel } from "./share";

// ---------------------------------------------------------------------------
// How a result is shown, decided by the device that RAN it (never the viewing device).
// Pure: no DOM, so the rules are unit-tested.
// ---------------------------------------------------------------------------

/** phone/tablet from the saved device context; "mobile" when only the old mobile flag says so. */
export type RunClass = "phone" | "tablet" | "mobile" | "desktop" | "unknown";

export function runClass(r: BenchResult): RunClass {
  const t = r.device?.deviceType;
  if (t === "phone" || t === "tablet") return t;
  if (r.mobile === true) return "mobile";
  if (t === "desktop" || r.mobile === false) return "desktop";
  return "unknown";
}

/** Phone and tablet runs can't be submitted (the catalog lists desktop and laptop GPUs, and the OS must be windows or linux). */
export function isHandheld(c: RunClass): boolean {
  return c === "phone" || c === "tablet" || c === "mobile";
}

function handheldName(c: RunClass, d: DeviceContext | undefined): string {
  if (d?.os === "ios") return c === "tablet" ? "iPad" : "iPhone";
  if (d?.os === "android") return c === "tablet" ? "Android tablet" : "Android phone";
  return c === "tablet" ? "Tablet" : "Phone";
}

/** "📱 iPhone · Safari 27", "🖥 Edge 141 · Windows", or "" when nothing is known. */
export function deviceLine(r: BenchResult): string {
  const c = runClass(r);
  const d = r.device;
  const knownBrowser = d && d.browser !== "other" ? browserLabel(d) : "";
  if (isHandheld(c)) return ["📱 " + handheldName(c, d), knownBrowser].filter(Boolean).join(" · ");
  const os = d && d.os !== "other" ? osLabel(d) : "";
  const parts = [knownBrowser, os].filter(Boolean);
  if (!parts.length) return "";
  return `${c === "desktop" ? "🖥 " : ""}${parts.join(" · ")}`;
}

/** The browser-reported GPU, when the browser gave a usable one. */
export function gpuLine(r: BenchResult): string {
  return r.device?.gpuLabel ?? "";
}

export type SubmissionStatus =
  | { kind: "invalid"; text: string }
  | { kind: "handheld"; text: "" }
  | { kind: "ready"; text: string }
  | { kind: "next-step"; text: string; missing: string[] };

/**
 * Submission status for display. Handheld runs get none at all (never "missing" or "incomplete").
 * Desktop and unknown runs show missing fields as the next step, not as an error.
 */
export function submissionStatus(r: BenchResult): SubmissionStatus {
  if (!r.valid) return { kind: "invalid", text: `Invalid: ${r.invalidReason || "unknown reason"}` };
  if (isHandheld(runClass(r))) return { kind: "handheld", text: "" };
  const errs = validateSubmission(r);
  if (!errs.length) return { kind: "ready", text: "Ready to submit" };
  return { kind: "next-step", text: "Add your system details to submit", missing: missingLabels(errs) };
}

export function canShare(r: BenchResult): boolean {
  return r.valid && !shareBlocker(sharedRunFrom(r));
}

// ----- My Results: filters and sort -----
export type SortKey = "newest" | "fps";
export type FacetKey = "resolution" | "preset" | "version" | "device";
export type Filters = Partial<Record<FacetKey, string>>;

const majorOf = (v: string) => `${String(v ?? "").split(".")[0]}.x`;
const deviceFacet = (r: BenchResult): string => {
  const c = runClass(r);
  return c === "phone" || c === "mobile" ? "Phone" : c === "tablet" ? "Tablet" : c === "desktop" ? "Desktop" : "Unknown";
};

export function facetOf(r: BenchResult, k: FacetKey): string {
  if (k === "resolution") return r.resolutionId ?? r.resolution;
  if (k === "preset") return r.preset;
  if (k === "version") return majorOf(r.benchmarkVersion);
  return deviceFacet(r);
}

const FACET_ORDER: Record<FacetKey, string[]> = {
  resolution: ["720p", "1080p", "1440p", "4K"],
  preset: ["Low", "Medium", "High", "Ultra", "Extreme"],
  version: [],
  device: ["Phone", "Tablet", "Desktop", "Unknown"],
};

/** Distinct values present in the data, in a natural order (versions newest first). */
export function facetValues(list: readonly BenchResult[], k: FacetKey): string[] {
  const seen = new Set(list.map((r) => facetOf(r, k)));
  const order = FACET_ORDER[k];
  return [...seen].sort((a, b) =>
    k === "version" ? parseInt(b, 10) - parseInt(a, 10) : (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
}

export function filterRuns(list: readonly BenchResult[], f: Filters): BenchResult[] {
  const keys = (Object.keys(f) as FacetKey[]).filter((k) => f[k]);
  return keys.length ? list.filter((r) => keys.every((k) => facetOf(r, k) === f[k])) : [...list];
}

const stamp = (r: BenchResult) => `${r.date ?? ""} ${r.time ?? ""}`;

export function sortRuns(list: readonly BenchResult[], by: SortKey): BenchResult[] {
  const out = [...list];
  if (by === "fps") out.sort((a, b) => b.avgFps - a.avgFps || stamp(b).localeCompare(stamp(a)));
  else out.sort((a, b) => stamp(b).localeCompare(stamp(a)));
  return out;
}

/** True when the list mixes major versions, whose FPS can't be compared. */
export function mixesMajors(list: readonly BenchResult[]): boolean {
  return new Set(list.map((r) => majorOf(r.benchmarkVersion))).size > 1;
}
