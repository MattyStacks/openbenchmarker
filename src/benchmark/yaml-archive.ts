import { NOT_LISTED, UPSTREAM_REPO } from "./catalog";
import { suggestedFileName, toDraftYaml, toYaml } from "./exporter";
import { isHandheldRun, submittedGpuId } from "./fields";
import type { BenchResult } from "./types";
import { missingLabels, validateSubmission } from "./validate";
import { zip, type ZipFile } from "./zip";

// ---------------------------------------------------------------------------
// "Download all as YAML": every saved result as a YAML file, in a zip laid out like the
// open-gpu-benchmarks repo, so the ready ones can be unzipped straight into a checkout.
//   data/community/<gpu_id>/result_YYYYMMDD_<game_id>[_n].yaml   ready to submit
//   not-ready/<gpu_id or no-gpu-chosen>/result_...yaml            the rest, in the same layout
//   README.txt                                                    every file and its status
// Invalid runs are left out: they can never be submitted.
// ---------------------------------------------------------------------------

export type ArchiveStatus = "ready" | "gpu-not-in-catalog" | "not-ready";

export interface ArchiveEntry {
  path: string;
  status: ArchiveStatus;
  /** Why it isn't ready, for README.txt; "" when ready. */
  note: string;
  yaml: string;
  result: BenchResult;
}

function statusOf(r: BenchResult): { status: ArchiveStatus; note: string } {
  if (isHandheldRun(r)) return { status: "not-ready", note: "phone and tablet results can't be submitted yet" };
  if (r.stressTest) return { status: "not-ready", note: "stress tests aren't submitted" };
  const missing = missingLabels(validateSubmission(r));
  if (missing.length) return { status: "not-ready", note: `still needs ${missing.join(", ")}` };
  if (r.system.gpuId === NOT_LISTED) return { status: "gpu-not-in-catalog", note: "the GPU has to be added to the catalog first, or in the same pull request" };
  return { status: "ready", note: "" };
}

/** The files for `results` (any order), oldest first, numbered _2, _3 when a folder repeats a name. */
export function archiveEntries(results: readonly BenchResult[], opts: { readyOnly?: boolean } = {}): ArchiveEntry[] {
  const runs = results
    .filter((r) => r.valid)
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const taken = new Set<string>();
  const out: ArchiveEntry[] = [];
  for (const r of runs) {
    const { status, note } = statusOf(r);
    if (opts.readyOnly && status !== "ready") continue;
    const gpuId = submittedGpuId(r.system ?? { gpuId: "", gpuIdRequested: "" }) || "no-gpu-chosen";
    const dir = status === "ready" ? `data/community/${gpuId}` : `not-ready/${gpuId}`;
    const stem = suggestedFileName(r, "yaml").replace(/\.yaml$/, "");
    let path = `${dir}/${stem}.yaml`;
    for (let n = 2; taken.has(path); n++) path = `${dir}/${stem}_${n}.yaml`;
    taken.add(path);
    out.push({ path, status, note, yaml: status === "not-ready" ? toDraftYaml(r) : toYaml(r), result: r });
  }
  return out;
}

const STATUS_LABEL: Record<ArchiveStatus, string> = {
  ready: "ready to submit",
  "gpu-not-in-catalog": "GPU not in the catalog yet",
  "not-ready": "not ready",
};

export function archiveReadme(entries: readonly ArchiveEntry[], skippedInvalid: number): string {
  const ready = entries.filter((e) => e.status === "ready").length;
  const lines = [
    "Your Open GPU Benchmarker results, one YAML file per run (https://opengpubenchmarker.com/).",
    "",
    "data/community/ is laid out like the Open GPU Benchmarks repository, so you can unzip it into",
    `a checkout of ${UPSTREAM_REPO} and open a pull request with the results you want to share.`,
    "Submitting is optional. Submitted results are public under CC BY 4.0.",
    "not-ready/ holds the rest in the same layout; each file says at the top what it still needs.",
    "",
    `${entries.length} file${entries.length === 1 ? "" : "s"}, ${ready} ready to submit.${skippedInvalid ? ` ${skippedInvalid} invalid run${skippedInvalid === 1 ? " was" : "s were"} left out.` : ""}`,
    "",
    ...entries.map((e) => `${e.path}\n    ${e.result.date} ${e.result.time} · ${e.result.resolution} ${e.result.preset} · ${STATUS_LABEL[e.status]}${e.note ? `: ${e.note}` : ""}`),
  ];
  return lines.join("\n") + "\n";
}

/** The zip and its file name, e.g. openbenchmarker_results_20261109.zip. */
export function yamlArchive(results: readonly BenchResult[], opts: { readyOnly?: boolean; now?: Date } = {}): { fileName: string; bytes: Uint8Array; entries: ArchiveEntry[] } {
  const now = opts.now ?? new Date();
  const entries = archiveEntries(results, opts);
  const skipped = results.filter((r) => !r.valid).length;
  const files: ZipFile[] = [...entries.map((e) => ({ path: e.path, data: e.yaml })), { path: "README.txt", data: archiveReadme(entries, skipped) }];
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return { fileName: `openbenchmarker_results_${day}.zip`, bytes: zip(files, now), entries };
}
