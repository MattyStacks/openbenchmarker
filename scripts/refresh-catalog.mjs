#!/usr/bin/env node
// Re-pull the GPU catalog from MattyStacks/open-gpu-benchmarks into
// src/benchmark/gpu-catalog.json. Product entries live at
// data/gpus/<form_factor>/<gpu_vendor>/<gpu_id>.yaml; data/gpus/reference/ holds
// base models that results must not use, so it is skipped.
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

/** identity.name from a catalog YAML, without a YAML dependency. */
function identityName(yaml) {
  const block = yaml.match(/^identity:\s*\n((?:[ \t]+.*\n?)*)/m);
  const name = block?.[1].match(/^[ \t]+name:[ \t]*(.+)$/m)?.[1].trim();
  return name?.replace(/^(['"])(.*)\1$/, "$2");
}

const repo = await get(`https://api.github.com/repos/${REPO}`);
const branch = repo.default_branch;
const commit = await get(`https://api.github.com/repos/${REPO}/commits/${branch}`);
const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${commit.sha}?recursive=1`);
if (tree.truncated) throw new Error("GitHub tree listing was truncated; refusing to write a partial catalog");

const entries = tree.tree
  .map((t) => t.path.match(/^data\/gpus\/([^/]+)\/([^/]+)\/([a-z0-9_]+)\.ya?ml$/))
  .filter((m) => m && m[1] !== "reference");

const gpus = [];
for (const [path, formFactor, vendor, id] of entries) {
  const yaml = await get(`https://raw.githubusercontent.com/${REPO}/${commit.sha}/${path}`, false);
  const fileId = yaml.match(/^id:\s*(\S+)/m)?.[1];
  if (fileId && fileId !== id) {
    console.warn(`skip ${path}: id '${fileId}' does not match file name`);
    continue;
  }
  gpus.push({ id, name: identityName(yaml) || id, vendor, formFactor });
}
gpus.sort((a, b) => a.formFactor.localeCompare(b.formFactor) || a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));

if (gpus.length === 0) {
  console.error("Upstream returned 0 catalog products; keeping the existing snapshot.");
  process.exit(1);
}

const snapshot = {
  snapshotDate: new Date().toISOString().slice(0, 10),
  source: `https://github.com/${REPO}/tree/${commit.sha}/data/gpus`,
  gpus,
};
writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Wrote ${gpus.length} GPU(s) from ${REPO}@${commit.sha.slice(0, 7)} to ${OUT}`);
for (const g of gpus) console.log(`  ${g.formFactor}/${g.vendor}/${g.id}  ${g.name}`);
