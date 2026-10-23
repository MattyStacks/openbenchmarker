import type { BenchResult, SystemInfo } from "./types";

// ---------------------------------------------------------------------------
// System information fields: one registry that the results form, validate.ts, the exporters and
// the storage migration all read. Adding a YAML/JSON field is one entry here plus tests (README:
// "How to add a field"). Names, types and allowed values mirror upstream
// templates/community_submission.yaml and scripts/checks.py.
// ---------------------------------------------------------------------------

/**
 * text: free text, quoted in YAML. digits: a whole number, unquoted in YAML.
 * choice: one of `options`, written bare. yesno: "yes"/"no"/"" written as a YAML boolean.
 */
export type FieldKind = "text" | "digits" | "choice" | "yesno";

export interface SystemField {
  key: keyof SystemInfo;
  /** Upstream YAML key; also the CSV column. */
  yaml: string;
  /** "top" fields sit at the top of the YAML (gpu_id, overclocked); "system" fields under system:. */
  section: "top" | "system";
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

/**
 * CSV column order. The system: fields are in upstream YAML order; the two top-level fields
 * (gpu_id first, overclocked after frame_generation) are placed by toYaml itself.
 */
export const SYSTEM_FIELDS: readonly SystemField[] = [
  { key: "gpuId", yaml: "gpu_id", section: "top", label: "GPU", kind: "choice", required: true },
  { key: "os", yaml: "os", section: "system", label: "OS", kind: "choice", required: true },
  { key: "osDetail", yaml: "os_detail", section: "system", label: "OS version", kind: "text", placeholder: "e.g. Windows 11 Pro 24H2" },
  { key: "cpu", yaml: "cpu", section: "system", label: "CPU", kind: "text", placeholder: "e.g. AMD Ryzen 7 7800X3D" },
  {
    key: "memoryGb",
    yaml: "memory_gb",
    section: "system",
    label: "Memory (GB, digits only)",
    kind: "digits",
    placeholder: "e.g. 32",
    inputmode: "numeric",
    validate: (v) => (wholeNumber(v, MAX_MEMORY_GB) ? null : `Memory: '${v}' must be a whole number of GB (digits only)`),
  },
  { key: "memoryType", yaml: "memory_type", section: "system", label: "Memory type", kind: "text", placeholder: "e.g. DDR5-6000" },
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
  },
  { key: "driver", yaml: "driver", section: "system", label: "GPU driver", kind: "text", placeholder: "e.g. 561.09" },
  { key: "distro", yaml: "distro", section: "system", label: "Distro", kind: "text", placeholder: "e.g. Fedora", linux: true },
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
  },
];

export function fieldFor(key: string): SystemField | undefined {
  return SYSTEM_FIELDS.find((f) => f.key === key);
}

export const LINUX_ONLY_FIELDS = SYSTEM_FIELDS.filter((f) => f.linux).map((f) => f.key);

export function emptySystem(): SystemInfo {
  return Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, ""])) as unknown as SystemInfo;
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
