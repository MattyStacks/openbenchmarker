import { BENCHMARKS, NOT_LISTED, UPSTREAM_ISSUES, findGpu } from "./catalog";
import { RESOLUTIONS, getPreset, standardResolution } from "./presets";
import { LINUX_ONLY_FIELDS, type BenchResult } from "./types";

/** Mirrors upstream proof.method for this tool. */
export const PROOF_METHOD = "other";
export const RESULT_OSES = ["windows", "linux"] as const;
const GRAPHICS_APIS = ["WebGL2", "WebGL1"];
const MAX_MEMORY_GB = 65536;

function finitePositive(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/**
 * Fail-closed submission check, mirroring upstream templates/community_submission.yaml
 * and scripts/checks.py. Every message starts with a short field label and ": ".
 * An empty array is the only "OK".
 */
export function validateSubmission(r: BenchResult | null | undefined): string[] {
  if (!r || typeof r !== "object") return ["Result: missing"];
  const errors: string[] = [];
  const s = r.system ?? ({} as BenchResult["system"]);

  if (!r.valid) errors.push(`Run: invalid (${r.invalidReason || "unknown reason"}); invalid runs can be saved locally but never submitted`);
  if (r.mobile) errors.push("Device: mobile runs aren't accepted for submission yet; local save and JSON/CSV still work");

  const gpuId = (s.gpuId ?? "").trim();
  if (!gpuId) errors.push("GPU: choose your exact GPU from the catalog");
  else if (gpuId === NOT_LISTED)
    errors.push(`GPU: not in the catalog yet; open an issue or PR to add it (${UPSTREAM_ISSUES}), then submit once it exists`);
  else if (!findGpu(gpuId)) errors.push(`GPU: '${gpuId}' is not a catalog gpu_id; free-text GPU names are not accepted`);

  if (!BENCHMARKS.some((b) => b.gameId === r.gameId)) errors.push(`Benchmark: game_id '${r.gameId}' is not this tool's benchmark`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) errors.push("Date: run date missing or not YYYY-MM-DD");
  if (!(r.resolution ?? "").trim()) errors.push("Resolution: missing");
  else if (!standardResolution(r.resolution, r.width, r.height))
    errors.push(`Resolution: '${r.resolution}' (${r.width}×${r.height}) isn't one of ${RESOLUTIONS.map((x) => x.id).join(", ")}; only these can be submitted`);
  if (!getPreset(r.preset)) errors.push(`Preset: '${r.preset}' is not a known graphics preset`);
  if (!finitePositive(r.avgFps)) errors.push("Avg FPS: missing or not a positive number");
  if (!finitePositive(r.p1Low)) errors.push("1% Low: missing or not a positive number (this tool times every frame, so it is required)");
  else if (finitePositive(r.avgFps) && r.p1Low > r.avgFps) errors.push("1% Low: higher than Avg FPS is impossible");
  if (!GRAPHICS_APIS.includes(r.graphicsApi)) errors.push("Graphics API: not recorded by the run");

  const os = (s.os ?? "").trim();
  if (!os) errors.push("OS: choose windows or linux");
  else if (!(RESULT_OSES as readonly string[]).includes(os)) errors.push(`OS: '${os}' must be exactly windows or linux`);

  const mem = (s.memoryGb ?? "").trim();
  if (mem && (!/^\d+$/.test(mem) || Number(mem) < 1 || Number(mem) > MAX_MEMORY_GB))
    errors.push(`Memory: '${mem}' must be a whole number of GB (digits only)`);

  if (os === "windows") {
    const mixed = LINUX_ONLY_FIELDS.filter((k) => (s[k] ?? "").trim());
    if (mixed.length) errors.push(`OS fields: ${mixed.join(", ")} ${mixed.length > 1 ? "are" : "is"} Linux-only but OS is windows; clear ${mixed.length > 1 ? "them" : "it"}`);
  }
  return errors;
}

/** Short labels of what blocks submission, e.g. ["GPU", "OS"], for history rows. */
export function missingLabels(errors: string[]): string[] {
  return [...new Set(errors.map((e) => e.split(":")[0]))];
}
