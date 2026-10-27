import type { BenchResult, SystemInfo } from "./types";

// ---------------------------------------------------------------------------
// System information fields: one registry that the results form, validate.ts, the exporters and
// the storage migration all read. Adding a YAML/JSON field is one entry here plus tests (README:
// "How to add a field"). Names, types and allowed values mirror upstream
// templates/community_submission.yaml and scripts/checks.py.
// ---------------------------------------------------------------------------

/**
 * text: free text, quoted in YAML. digits: a whole number, unquoted in YAML. signed: a whole number
 * with an optional + or -, unquoted in YAML ("+150" is written 150).
 * choice: one of `options`, written bare. yesno: "yes"/"no"/"" written as a YAML boolean.
 */
export type FieldKind = "text" | "digits" | "signed" | "choice" | "yesno";

export interface SystemField {
  key: keyof SystemInfo;
  /** Upstream YAML key; also the CSV column. */
  yaml: string;
  /**
   * "top" fields sit at the top of the YAML (gpu_id, overclocked); "system" fields under system:;
   * "overclock" fields under overclock:, only when overclocked is yes (otherwise kept but ignored).
   */
  section: "top" | "system" | "overclock";
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Shown only for Linux (and flagged if filled on windows). */
  linux?: boolean;
  placeholder?: string;
  help?: string;
  inputmode?: "numeric";
  /** Message (starting with a short label and ": ") when a non-blank value is wrong, else null. */
  validate?: (v: string) => string | null;
  /**
   * A best-guess value for details a browser can't read, or null. Applied once, when a result is
   * created or an older result first loads without the field; always marked in `suggested`, and
   * the user can change or clear it.
   */
  suggest?: (r: Pick<BenchResult, "device" | "mobile">) => string | null;
  /** Copied from the user's last filled-in result onto a new run: details that rarely change between runs. */
  carry?: boolean;
  /** Describes the GPU itself, so it isn't carried when the browser reports a different GPU. */
  gpuSpecific?: boolean;
}

export const MAX_MEMORY_GB = 65536;
/** Upstream MAX_MEMORY_CHANNELS. */
export const MAX_MEMORY_CHANNELS = 32;
/** Best guess for phones and tablets: flagship phone memory runs as four 16-bit channels. */
export const ASSUMED_HANDHELD_CHANNELS = "4";

/** Same rule as runClass/isHandheld in src/app/result-display.ts (kept DOM-free here). */
export function isHandheldRun(r: Pick<BenchResult, "device" | "mobile">): boolean {
  const t = r.device?.deviceType;
  return t === "phone" || t === "tablet" || r.mobile === true;
}

const wholeNumber = (v: string, max: number) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max;
const signedNumber = (v: string, max: number) => /^[+-]?\d+$/.test(v) && Math.abs(Number(v)) <= max;

/** Bounds for the overclock details, loose enough for any card (also proposed upstream). */
export const MAX_CORE_OFFSET_MHZ = 3000;
export const MAX_MEMORY_OFFSET_MHZ = 10000;
export const MAX_POWER_LIMIT_PCT = 300;

/**
 * CSV column order. The system: fields are in upstream YAML order; the two top-level fields
 * (gpu_id first, overclocked after frame_generation) are placed by toYaml itself.
 */
export const SYSTEM_FIELDS: readonly SystemField[] = [
  { key: "gpuId", yaml: "gpu_id", section: "top", label: "GPU", kind: "choice", required: true, carry: true, gpuSpecific: true },
  { key: "os", yaml: "os", section: "system", label: "OS", kind: "choice", required: true, carry: true },
  { key: "osDetail", yaml: "os_detail", section: "system", label: "OS version", kind: "text", placeholder: "e.g. Windows 11 Pro 24H2", carry: true },
  { key: "cpu", yaml: "cpu", section: "system", label: "CPU", kind: "text", placeholder: "e.g. AMD Ryzen 7 7800X3D", carry: true },
  {
    key: "memoryGb",
    yaml: "memory_gb",
    section: "system",
    label: "Memory (GB, digits only)",
    kind: "digits",
    placeholder: "e.g. 32",
    inputmode: "numeric",
    validate: (v) => (wholeNumber(v, MAX_MEMORY_GB) ? null : `Memory: '${v}' must be a whole number of GB (digits only)`),
    carry: true,
  },
  { key: "memoryType", yaml: "memory_type", section: "system", label: "Memory type", kind: "text", placeholder: "e.g. DDR5-6000", carry: true },
  {
    key: "memoryChannels",
    yaml: "memory_channels",
    section: "system",
    label: "Memory channels",
    kind: "digits",
    placeholder: "e.g. 2",
    inputmode: "numeric",
    help: "Number of memory channels in use, e.g. 2 for two sticks of RAM in dual channel.",
    validate: (v) => (wholeNumber(v, MAX_MEMORY_CHANNELS) ? null : `Memory channels: '${v}' must be a whole number from 1 to ${MAX_MEMORY_CHANNELS} (2 for dual channel)`),
    // Browsers can't see how memory is wired. Phones and tablets get a marked best guess, so the
    // saved result is already complete when phone runs become submittable.
    suggest: (r) => (isHandheldRun(r) ? ASSUMED_HANDHELD_CHANNELS : null),
    carry: true,
  },
  { key: "driver", yaml: "driver", section: "system", label: "GPU driver", kind: "text", placeholder: "e.g. 561.09", carry: true, gpuSpecific: true },
  { key: "distro", yaml: "distro", section: "system", label: "Distro", kind: "text", placeholder: "e.g. Fedora", linux: true, carry: true },
  { key: "kernel", yaml: "kernel", section: "system", label: "Kernel", kind: "text", placeholder: "e.g. 6.11.4", linux: true },
  { key: "mesa", yaml: "mesa", section: "system", label: "Mesa", kind: "text", placeholder: "e.g. 24.2.5", linux: true },
  { key: "proton", yaml: "proton", section: "system", label: "Proton", kind: "text", placeholder: "e.g. GE-Proton9-20", linux: true },
  {
    key: "overclocked",
    yaml: "overclocked",
    section: "top",
    label: "Overclocked",
    kind: "yesno",
    validate: (v) => (v === "yes" || v === "no" ? null : `Overclocked: '${v}' must be yes, no or blank`),
    carry: true,
    gpuSpecific: true,
  },
  // What was raised, as set in MSI Afterburner or the vendor's tuning tool. Shown and submitted only
  // when overclocked is yes. Not in upstream yet: proposed in docs/upstream-submission-changes.md.
  {
    key: "ocCoreMhz",
    yaml: "core_clock_offset_mhz",
    section: "overclock",
    label: "Core clock offset (MHz)",
    kind: "signed",
    placeholder: "e.g. +150",
    help: "How far you moved the core clock slider from stock, e.g. +150. Leave blank if unchanged.",
    validate: (v) => (signedNumber(v, MAX_CORE_OFFSET_MHZ) ? null : `Core clock offset: '${v}' must be a whole number of MHz from -${MAX_CORE_OFFSET_MHZ} to +${MAX_CORE_OFFSET_MHZ}`),
    carry: true,
    gpuSpecific: true,
  },
  {
    key: "ocMemoryMhz",
    yaml: "memory_clock_offset_mhz",
    section: "overclock",
    label: "Memory clock offset (MHz)",
    kind: "signed",
    placeholder: "e.g. +1000",
    help: "How far you moved the memory clock slider from stock, as your tuning tool shows it, e.g. +1000. Leave blank if unchanged.",
    validate: (v) => (signedNumber(v, MAX_MEMORY_OFFSET_MHZ) ? null : `Memory clock offset: '${v}' must be a whole number of MHz from -${MAX_MEMORY_OFFSET_MHZ} to +${MAX_MEMORY_OFFSET_MHZ}`),
    carry: true,
    gpuSpecific: true,
  },
  {
    key: "ocPowerPct",
    yaml: "power_limit_pct",
    section: "overclock",
    label: "Power limit (%)",
    kind: "digits",
    placeholder: "e.g. 110",
    inputmode: "numeric",
    help: "The power limit slider, where 100 is stock, e.g. 110. Leave blank if unchanged.",
    validate: (v) => (wholeNumber(v, MAX_POWER_LIMIT_PCT) ? null : `Power limit: '${v}' must be a whole number of percent from 1 to ${MAX_POWER_LIMIT_PCT} (100 is stock)`),
    carry: true,
    gpuSpecific: true,
  },
];

export function fieldFor(key: string): SystemField | undefined {
  return SYSTEM_FIELDS.find((f) => f.key === key);
}

export const LINUX_ONLY_FIELDS = SYSTEM_FIELDS.filter((f) => f.linux).map((f) => f.key);

export const OVERCLOCK_FIELDS = SYSTEM_FIELDS.filter((f) => f.section === "overclock");

/** Whether a field counts (validated, exported): overclock details only when overclocked is yes. */
export function fieldApplies(f: SystemField, s: Pick<SystemInfo, "overclocked">): boolean {
  return f.section !== "overclock" || s.overclocked === "yes";
}

export function emptySystem(): SystemInfo {
  return Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, ""])) as unknown as SystemInfo;
}

/**
 * Starting values for a brand-new run, passed to completeSystem as if saved: overclocked starts at
 * "no", since most runs are at stock clocks. A plain default, not a suggestion; the user can pick
 * yes or blank.
 */
export const NEW_RUN_SYSTEM: Readonly<Partial<SystemInfo>> = { overclocked: "no" };

/**
 * The result a new run copies its carried fields from: the newest desktop/laptop result where the
 * user filled in something carried (overclocked alone doesn't count: new runs start at "no").
 * `history` is newest first, as the store keeps it.
 */
export function carrySource(history: readonly BenchResult[]): BenchResult | undefined {
  return history.find(
    (r) => !isHandheldRun(r) && SYSTEM_FIELDS.some((f) => f.carry && f.key !== "overclocked" && String(r.system?.[f.key] ?? "").trim()),
  );
}

/**
 * The carried fields of `src`, as the user left them (a cleared field stays blank), for a new run.
 * If the browser reported a different GPU on the two runs (a new card, or a laptop that ran on its
 * other GPU), the GPU's own fields aren't carried.
 */
export function carriedSystem(src: Pick<BenchResult, "system" | "device"> | undefined, next: Pick<BenchResult, "device">): Partial<SystemInfo> {
  if (!src) return {};
  const a = src.device?.gpuLabel;
  const b = next.device?.gpuLabel;
  const sameGpu = !a || !b || a === b;
  const out: Partial<SystemInfo> = {};
  for (const f of SYSTEM_FIELDS) {
    const v = src.system?.[f.key];
    if (f.carry && (sameGpu || !f.gpuSpecific) && typeof v === "string") out[f.key] = v;
  }
  return out;
}

/**
 * The saved `system` with every known field present. Unknown keys are kept (a newer version may
 * have written them); missing ones become "" unless a suggestion applies. A field that is present
 * but "" was cleared by the user and stays cleared.
 */
export function completeSystem(
  r: Pick<BenchResult, "device" | "mobile" | "suggested">,
  raw: Partial<Record<string, unknown>> | null | undefined,
): { system: SystemInfo; suggested: (keyof SystemInfo)[] } {
  const src = raw && typeof raw === "object" ? raw : {};
  const system = { ...emptySystem(), ...(src as Partial<SystemInfo>) };
  const suggested = (r.suggested ?? []).filter((k) => fieldFor(k));
  for (const f of SYSTEM_FIELDS) {
    const v = src[f.key];
    if (v === undefined || v === null) {
      const guess = f.suggest?.(r) ?? null;
      if (guess !== null) {
        system[f.key] = guess;
        if (!suggested.includes(f.key)) suggested.push(f.key);
      }
    } else if (typeof v !== "string") system[f.key] = String(v);
  }
  return { system, suggested };
}
