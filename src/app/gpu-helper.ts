import { catalogLabel, findGpu, UPSTREAM_REPO } from "../benchmark/catalog";
import { download } from "../benchmark/exporter";
import {
  BOARD_BRANDS,
  OWN_CARD,
  boardOf,
  buildGpuId,
  chipTokens,
  catalogFile,
  isCatalogIdShape,
  knownProduct,
  parseGpuInfo,
  productName,
  referenceMatches,
  slug,
  vendorOf,
  type DetectedGpu,
  type GpuFormFactor,
  type GpuInfo,
} from "../benchmark/gpu-id";
import type { SystemInfo } from "../benchmark/types";
import { esc } from "./dom";

// ---------------------------------------------------------------------------
// A GPU that isn't in the dataset yet: from the GPU the user picked or typed (or the GPU lines of
// pasted command output), check the pieces and the page builds the catalog id, the GPU's name and
// its catalog file (src/benchmark/gpu-id.ts). The page never runs a command or reads the system.
// ---------------------------------------------------------------------------

export type CmdOs = "windows" | "linux";

/** Radio buttons for Windows / Linux commands; `name` keeps each group separate. */
export function osSwitchHtml(name: string, os: CmdOs): string {
  return `<div class="seg seg-sm" role="radiogroup" aria-label="Commands for">${(["windows", "linux"] as const)
    .map((o) => `<label><input type="radio" name="${name}" value="${o}"${o === os ? " checked" : ""} /><span>${o === "windows" ? "Windows" : "Linux"}</span></label>`)
    .join("")}</div>`;
}

/** The "isn't in the dataset yet" panel; filled by bindGpuHelper once a GPU is picked or pasted. */
export function gpuHelperHtml(): string {
  return `<div class="gpu-helper" id="gpu-helper"><div data-helper-result></div></div>`;
}

/** The GPU's catalog file section; filled by `renderGpuFile`. */
export function gpuFileHtml(): string {
  return `<div class="gpu-file" id="gpu-file">
    <h3>Your GPU's catalog file</h3>
    <label class="field"><span>Desktop card, laptop or handheld <em>for the file</em></span><select name="gpuFormFactor"><option value="">— Select —</option><option value="desktop">Desktop card</option><option value="laptop">Laptop</option><option value="handheld">Handheld PC</option></select></label>
    <div data-gpu-file-body></div>
  </div>`;
}

interface HelperState {
  info: GpuInfo | null;
  gpu: number;
  base: string;
  formFactor: GpuFormFactor;
  maker: string;
  line: string;
  ramGb: number | null;
}

const FF_LABEL: Record<GpuFormFactor, string> = { desktop: "Desktop card", laptop: "Laptop", handheld: "Handheld PC" };
/** System RAM sizes handhelds ship with. */
const HANDHELD_RAM = [12, 16, 24, 32, 48, 64];
/** GPU memory sizes, for a GPU with no reference file to take its size from. */
const VRAM_GB = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48];

/** The chip part of an id for a GPU with no reference file: "rtx_6090" from "NVIDIA GeForce RTX 6090". */
function chipStem(name: string): string {
  return chipTokens(name)[0] ?? slug(name.replace(/\b(nvidia|geforce|amd|ati|radeon|intel|graphics|gpu)\b/gi, " "));
}

export interface GpuHelper {
  /** Work out the id for a GPU the user picked or typed; `base` is its reference when known. */
  pick(g: DetectedGpu, opts?: { formFactor?: GpuFormFactor | null; base?: string }): void;
  /** Reads the GPU lines of pasted command output; false when there are none. */
  fromPaste(text: string): boolean;
}

/**
 * Wires the panel. `apply` saves the built name, id and form factor into the result (and the
 * form); `pickListed` chooses a catalog product instead.
 */
export function bindGpuHelper(root: HTMLElement, opts: { apply: (s: Partial<SystemInfo>) => void; pickListed: (id: string) => void }): GpuHelper {
  const st: HelperState = { info: null, gpu: 0, base: "", formFactor: "desktop", maker: "", line: "", ramGb: null };
  const result = root.querySelector<HTMLElement>("[data-helper-result]")!;

  // A handheld's id needs its device name and RAM before it's worth saving.
  const complete = (id: string) => isCatalogIdShape(id) && (st.formFactor !== "handheld" || !!st.line.trim());
  const render = () => {
    const g = st.info?.gpus[st.gpu];
    if (!st.info || !g) {
      result.innerHTML = st.info
        ? `<p class="next-step tiny">No GPU found in that text. Paste everything the command printed, including the lines starting with <code>GPU:</code>.</p>`
        : `<p class="muted tiny">Search for your GPU above, or type its name, and its ID is built for you.</p>`;
      return;
    }
    const known = knownProduct(g);
    const knownGpu = known ? findGpu(known) : undefined;
    if (knownGpu) {
      result.innerHTML = `<p class="ok tiny">That's a <b>${esc(catalogLabel(knownGpu))}</b>, already in the dataset. <button type="button" class="btn btn-sm" data-helper-listed="${esc(knownGpu.id)}">Use it</button></p>`;
      return;
    }
    const refs = referenceMatches(g);
    const choices = [...new Set([...refs.options, ...(refs.fallback && !refs.options.includes(refs.fallback) ? [refs.fallback] : [])])];
    // No reference and no memory size: ask for the size, or for a handheld, use the chip alone (the RAM gives the size).
    const stem = chipStem(g.name);
    const askVram = !choices.length && st.formFactor !== "handheld";
    if (!choices.length && st.formFactor === "handheld") st.base = stem;
    const vendor = vendorOf(st.base);
    const id = st.base ? buildGpuId(st) : "";
    const listed = id && findGpu(id);
    result.innerHTML = `
      <p class="tiny"><b>${esc(g.name)}</b>${g.vramGb && !/\b\d+\s*GB\b/i.test(g.name) ? `, ${g.vramGb} GB` : ""} isn't in the dataset yet. Check these and its ID is built for you.</p>
      ${
        st.info.gpus.length > 1
          ? `<label class="field"><span>Which GPU ran the benchmark?</span><select data-helper-gpu>${st.info.gpus.map((x, i) => `<option value="${i}"${i === st.gpu ? " selected" : ""}>${esc(x.name)}${x.vramGb ? ` (${x.vramGb} GB)` : ""}</option>`).join("")}</select></label>`
          : ""
      }
      <div class="field"><span>Desktop card, laptop or handheld</span><div class="seg seg-sm" role="radiogroup" aria-label="Desktop card, laptop or handheld">${(["desktop", "laptop", "handheld"] as const)
        .map((f) => `<label><input type="radio" name="helper-ff" value="${f}"${f === st.formFactor ? " checked" : ""} /><span>${FF_LABEL[f]}</span></label>`)
        .join("")}</div></div>
      ${
        askVram
          ? `<label class="field"><span>Graphics memory</span><select data-helper-vram>
              <option value="">— Choose —</option>
              ${VRAM_GB.map((n) => `<option value="${stem}_${n}gb"${st.base === `${stem}_${n}gb` ? " selected" : ""}>${n} GB</option>`).join("")}
            </select></label>`
          : choices.length > 1 || (choices.length === 1 && st.base !== choices[0])
          ? `<label class="field"><span>Graphics memory</span><select data-helper-base>
              ${st.base ? "" : `<option value="">— Choose —</option>`}
              ${choices.map((c) => `<option value="${esc(c)}"${c === st.base ? " selected" : ""}>${esc(memoryOf(c))}${c === refs.fallback && !refs.options.includes(c) ? " (no reference file yet)" : ""}</option>`).join("")}
            </select></label>`
          : ""
      }
      ${
        st.formFactor === "desktop"
          ? `<label class="field"><span>Who made the card</span><select data-helper-maker>
              <option value="">Not sure</option>
              ${vendor ? `<option value="own"${st.maker === "own" ? " selected" : ""}>${esc(OWN_CARD[vendor].label)} (made by ${vendor === "nvidia" ? "NVIDIA" : vendor === "amd" ? "AMD" : "Intel"})</option>` : ""}
              ${BOARD_BRANDS.map((b) => `<option value="${b.token}"${b.token === st.maker ? " selected" : ""}>${esc(b.label)}</option>`).join("")}
            </select></label>
            ${st.maker && st.maker !== "own" ? `<label class="field"><span>Product line <em>optional, from the box</em></span><input data-helper-line value="${esc(st.line)}" placeholder="e.g. Gaming OC, Ventus 2X OC, TUF Gaming" /></label>` : ""}`
          : st.formFactor === "handheld"
          ? `<label class="field"><span>Device <em>as sold</em></span><input data-helper-line value="${esc(st.line)}" placeholder="e.g. ROG Ally X, Legion Go S, MSI Claw 8 AI+" /></label>
            <label class="field"><span>System RAM <em>shared with the GPU</em></span><select data-helper-ram>
              <option value="">— Choose —</option>
              ${HANDHELD_RAM.map((n) => `<option value="${n}"${n === st.ramGb ? " selected" : ""}>${n} GB</option>`).join("")}
            </select></label>`
          : `<p class="muted tiny">Laptop GPUs use the reference ID: the laptop's maker and model aren't part of it.</p>`
      }
      ${
        id
          ? `<p class="helper-id">ID: <code>${esc(id)}</code></p>
             ${listed ? `<p class="ok tiny">It's already in the dataset as ${esc(listed.name)}. <button type="button" class="btn btn-sm" data-helper-listed="${esc(id)}">Use it</button></p>` : ""}
             ${st.formFactor === "handheld" && (!st.line.trim() || !st.ramGb) ? `<p class="next-step tiny">Add the device name and its RAM to finish the ID.</p>` : ""}
             ${st.formFactor === "desktop" && !st.maker ? `<p class="muted tiny">Not sure who made it? <code>_reference</code> works until someone adds the exact card.</p>` : ""}`
          : `<p class="next-step tiny">Choose its graphics memory above.</p>`
      }`;
    if (id && !listed && complete(id)) opts.apply({ gpuName: productName(g.name, st), gpuIdRequested: id, gpuFormFactor: st.formFactor });
  };

  // A new GPU resets what was worked out for the previous one.
  const pickGpu = (formFactor?: GpuFormFactor | null, base?: string) => {
    const g = st.info?.gpus[st.gpu];
    if (!g) return render();
    // No reference file but a known memory size (a typed "Mystery GPU 9000 12 GB"): its chip and size.
    const refs = referenceMatches(g);
    st.base = base ?? refs.base ?? (!refs.options.length && g.vramGb && refs.fallback ? refs.fallback : "");
    st.formFactor = formFactor ?? st.info!.formFactor ?? (/laptop|mobile|\d+m\b/i.test(g.name) ? "laptop" : "desktop");
    const maker = boardOf(g.board);
    st.maker = st.formFactor !== "desktop" || !maker ? "" : "own" in maker ? "own" : maker.brand;
    st.line = "";
    st.ramGb = null;
    render();
  };

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.matches("[data-helper-gpu]")) {
      st.gpu = Number(el.value);
      return pickGpu();
    }
    if (el.matches("[data-helper-base]") || el.matches("[data-helper-vram]")) st.base = el.value;
    else if (el.matches('input[name="helper-ff"]')) st.formFactor = el.value as GpuFormFactor;
    else if (el.matches("[data-helper-maker]")) st.maker = el.value;
    else if (el.matches("[data-helper-ram]")) st.ramGb = el.value ? Number(el.value) : null;
    else if (el.matches("[data-helper-line]")) {
      // Re-rendering would steal focus from the box being typed in: update the id and fields only.
      st.line = el.value;
      const g = st.info?.gpus[st.gpu];
      const code = result.querySelector(".helper-id code");
      if (g && st.base && code) {
        code.textContent = buildGpuId(st);
        if (complete(buildGpuId(st))) opts.apply({ gpuName: productName(g.name, st), gpuIdRequested: buildGpuId(st), gpuFormFactor: st.formFactor });
      }
      return;
    } else return;
    render();
  });
  root.addEventListener("click", (e) => {
    const listed = (e.target as HTMLElement).closest<HTMLElement>("[data-helper-listed]");
    if (listed) opts.pickListed(listed.dataset.helperListed!);
  });
  render();
  return {
    pick(g, o = {}) {
      st.info = { formFactor: o.formFactor ?? null, gpus: [g] };
      st.gpu = 0;
      pickGpu(o.formFactor, o.base);
    },
    fromPaste(text) {
      const info = parseGpuInfo(text);
      if (!info.gpus.length) return false;
      st.info = info;
      st.gpu = 0;
      pickGpu();
      return true;
    },
  };
}

/** "16 GB" for a reference id like rtx_5060_ti_16gb. */
function memoryOf(id: string): string {
  const m = /_(\d+)gb(?:_|$)/.exec(id);
  return m ? `${m[1]} GB` : id;
}

/** The catalog file for the requested id, with download, copy and GitHub's new-file form. */
export function renderGpuFile(root: HTMLElement, s: Pick<SystemInfo, "gpuIdRequested" | "gpuName" | "gpuFormFactor">): void {
  const body = root.querySelector<HTMLElement>("[data-gpu-file-body]");
  if (!body) return;
  const ff = s.gpuFormFactor === "desktop" || s.gpuFormFactor === "laptop" || s.gpuFormFactor === "handheld" ? s.gpuFormFactor : null;
  const f = ff ? catalogFile(s.gpuIdRequested.trim(), s.gpuName, ff) : null;
  if (!f) {
    body.innerHTML = `<p class="muted tiny">Fill in your GPU's name, the requested gpu_id and desktop card, laptop or handheld, and the file appears here.</p>`;
    return;
  }
  const dir = f.path.slice(0, f.path.lastIndexOf("/"));
  const file = f.path.slice(dir.length + 1);
  body.innerHTML = `<p class="tiny">Add it as <code>${esc(f.path)}</code> in the same pull request as your result, so the checks can find your GPU.</p>
    <pre class="yaml" data-gpu-file-yaml>${esc(f.yaml)}</pre>
    <div class="row">
      <button type="button" class="btn btn-sm" data-gpu-file-download>Download</button>
      <button type="button" class="btn btn-sm" data-gpu-file-copy>Copy</button>
      <a class="btn btn-sm" target="_blank" rel="noopener" href="${UPSTREAM_REPO}/new/main/${dir}?filename=${encodeURIComponent(file)}&value=${encodeURIComponent(f.yaml)}">Open GitHub's new-file form</a>
    </div>`;
  body.querySelector("[data-gpu-file-download]")!.addEventListener("click", () => download(file, f.yaml, "application/x-yaml"));
  body.querySelector("[data-gpu-file-copy]")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(f.yaml);
      b.textContent = "Copied ✓";
    } catch {
      getSelection()?.selectAllChildren(body.querySelector("[data-gpu-file-yaml]")!);
      b.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (b.textContent = "Copy"), 1800);
  });
}
