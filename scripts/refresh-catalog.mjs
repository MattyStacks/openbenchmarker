#!/usr/bin/env node
// Re-pull the GPU catalog from MattyStacks/open-gpu-benchmarks into
// src/benchmark/gpu-catalog.json. Product entries live at
// data/gpus/<form_factor>/<gpu_vendor>/<gpu_id>.yaml; data/gpus/reference/ holds
// base models that results must not use. Both keep the few specs the results form pre-fills from
// (name, memory, a handheld's platform), so a GPU that isn't listed yet still fills in.
// Refuses to overwrite the snapshot with an empty list.
//
//   npm run refresh-catalog            (set GITHUB_TOKEN to avoid API rate limits)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = "MattyStacks/open-gpu-benchmarks";
const OUT = fileURLToPath(new URL("../src/benchmark/gpu-catalog.json", import.meta.url));
const headers = { "User-Agent": "openbenchmarker-refresh", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get(url, json = true) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return json ? res.json() : res.text();
}

/** A scalar under a top-level section of a catalog YAML (e.g. identity.name), without a YAML dependency. */
function field(yaml, section, key) {
  const block = yaml.match(new RegExp(`^${section}:[ \\t]*\\n((?:[ \\t]+.*\\n?)*)`, "m"));
  const v = block?.[1].match(new RegExp(`^[ \\t]+${key}:[ \\t]*(.+)$`, "m"))?.[1].trim();
  if (!v || v === ">-" || v === "|") return undefined;
  return v.replace(/^(['"])(.*)\1$/, "$2");
}
const num = (v) => (v !== undefined && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);

/** The specs the results form uses; absent ones are left out. */
function specs(yaml) {
  const out = {
    memoryGb: num(field(yaml, "memory", "capacity_gb")),
    memoryType: field(yaml, "memory", "type"),
    memoryShared: field(yaml, "memory", "shared") === "true" || undefined,
    architecture: field(yaml, "classification", "architecture"),
    boostMhz: num(field(yaml, "clocks", "boost_mhz")),
    tdpW: num(field(yaml, "power", "tdp_w")),
    oem: field(yaml, "platform", "oem"),
    cpu: field(yaml, "platform", "cpu"),
    ramMts: num(field(yaml, "platform", "ram_mts")),
    osShipped: field(yaml, "platform", "os_shipped"),
    display: field(yaml, "platform", "display"),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/** Fetch many files a few at a time. */
async function getAll(paths) {
  const out = new Array(paths.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < paths.length) {
        const i = next++;
        out[i] = await get(`https://raw.githubusercontent.com/${REPO}/${commit.sha}/${paths[i]}`, false);
      }
    }),
  );
  return out;
}

const repo = await get(`https://api.github.com/repos/${REPO}`);
const branch = repo.default_branch;
const commit = await get(`https://api.github.com/repos/${REPO}/commits/${branch}`);
const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${commit.sha}?recursive=1`);
if (tree.truncated) throw new Error("GitHub tree listing was truncated; refusing to write a partial catalog");

const paths = tree.tree.map((t) => t.path.match(/^data\/gpus\/([^/]+)\/([^/]+)\/([a-z0-9_]+)\.ya?ml$/)).filter(Boolean);
const entries = paths.filter((m) => m[1] !== "reference");
const refPaths = paths.filter((m) => m[1] === "reference");
const refYaml = await getAll(refPaths.map((m) => m[0]));
const references = refPaths
  .map(([, , vendor, id], i) => ({ id, vendor, name: field(refYaml[i], "identity", "name") || id, ...specs(refYaml[i]) }))
  .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));

const gpus = [];
const productYaml = await getAll(entries.map((m) => m[0]));
entries.forEach(([path, formFactor, vendor, id], i) => {
  const yaml = productYaml[i];
  const fileId = yaml.match(/^id:\s*(\S+)/m)?.[1];
  if (fileId && fileId !== id) {
    console.warn(`skip ${path}: id '${fileId}' does not match file name`);
    return;
  }
  const base = yaml.match(/^base:\s*(\S+)/m)?.[1];
  const ref = base ? references.find((r) => r.id === base) : undefined;
  // A product's own values win over its reference's (upstream merges them the same way).
  const own = specs(yaml);
  const merged = ref ? { ...Object.fromEntries(Object.entries(ref).filter(([k]) => !["id", "vendor", "name"].includes(k))), ...own } : own;
  gpus.push({ id, name: field(yaml, "identity", "name") || id, vendor, formFactor, ...(base ? { base } : {}), ...merged });
});
gpus.sort((a, b) => a.formFactor.localeCompare(b.formFactor) || a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));

if (gpus.length === 0) {
  console.error("Upstream returned 0 catalog products; keeping the existing snapshot.");
  process.exit(1);
}

const snapshot = {
  snapshotDate: new Date().toISOString().slice(0, 10),
  source: `https://github.com/${REPO}/tree/${commit.sha}/data/gpus`,
  gpus,
  references,
};
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Wrote ${gpus.length} GPU(s) and ${references.length} reference id(s) from ${REPO}@${commit.sha.slice(0, 7)} to ${OUT}`);
for (const g of gpus) console.log(`  ${g.formFactor}/${g.vendor}/${g.id}  ${g.name}`);
