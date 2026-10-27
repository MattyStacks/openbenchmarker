import { findGpu, UPSTREAM_REPO } from "../benchmark/catalog";
import { download } from "../benchmark/exporter";
import {
  BOARD_BRANDS,
  OWN_CARD,
  boardOf,
  buildGpuId,
  catalogFile,
  parseGpuInfo,
  productName,
  referenceMatches,
  vendorOf,
  type GpuFormFactor,
  type GpuInfo,
} from "../benchmark/gpu-id";
import { SYSINFO_COMMANDS } from "../benchmark/sysinfo";
import type { SystemInfo } from "../benchmark/types";
import { esc } from "./dom";

// ---------------------------------------------------------------------------
// "My GPU isn't listed": run a command, paste what it printed, check the pieces, and the page
// builds the catalog id, the GPU's name and its catalog file (src/benchmark/gpu-id.ts). The page
// never runs the command or reads the system; it only reads what the user pastes.
// ---------------------------------------------------------------------------

export type CmdOs = "windows" | "linux";

/** Radio buttons for Windows / Linux commands; `name` keeps each group separate. */
export function osSwitchHtml(name: string, os: CmdOs): string {
  return `<div class="seg seg-sm" role="radiogroup" aria-label="Commands for">${(["windows", "linux"] as const)
    .map((o) => `<label><input type="radio" name="${name}" value="${o}"${o === os ? " checked" : ""} /><span>${o === "windows" ? "Windows" : "Linux"}</span></label>`)
    .join("")}</div>`;
}

export function gpuHelperHtml(os: CmdOs): string {
  return `<div class="gpu-helper" id="gpu-helper">
    <h3>Work out your GPU's ID</h3>
    <ol class="helper-steps">
      <li><b>Run this</b> <span data-helper-shell></span> ${osSwitchHtml("helper-os", os)}
        <p class="muted tiny" data-helper-open></p>
        <div class="cmd"><div class="cmd-head"><b>GPU, VRAM and board maker</b><button type="button" class="btn btn-sm" data-helper-copy>Copy</button></div><pre data-helper-cmd></pre></div></li>
      <li><b>Paste what it printed</b>
        <textarea data-helper-paste rows="4" spellcheck="false" autocapitalize="off" aria-label="What the command printed" placeholder="Computer type: laptop&#10;GPU: NVIDIA GeForce RTX 5090 Laptop GPU (24 GB) [board 17AA]"></textarea></li>
      <li><b>Check it</b><div data-helper-result><p class="muted tiny">Paste the output above and the ID is built for you.</p></div></li>
    </ol>
  </div>`;
}

/** The GPU's catalog file section; filled by `renderGpuFile`. */
export function gpuFileHtml(): string {
  return `<div class="gpu-file" id="gpu-file">
    <h3>Your GPU's catalog file</h3>
    <label class="field"><span>Desktop card or laptop <em>for the file</em></span><select name="gpuFormFactor"><option value="">— Select —</option><option value="desktop">Desktop card</option><option value="laptop">Laptop</option></select></label>
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
}

/**
 * Wires the helper. `apply` saves the built name, id and form factor into the result (and the
 * form); `os` and `setOs` share the Windows/Linux choice with the commands card.
 */
export function bindGpuHelper(
  root: HTMLElement,
  opts: { os: () => CmdOs; setOs: (os: CmdOs) => void; apply: (s: Partial<SystemInfo>) => void; pickListed: (id: string) => void },
): { renderOs: () => void } {
  const st: HelperState = { info: null, gpu: 0, base: "", formFactor: "desktop", maker: "", line: "" };
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

  const renderOs = () => {
    const set = SYSINFO_COMMANDS[opts.os()];
    const gpuCmd = set.commands.find((c) => c.field === "gpu")!.command;
    q("[data-helper-shell]").textContent = `in ${set.shell}:`;
    q("[data-helper-open]").textContent = set.howToOpen;
    q("[data-helper-cmd]").textContent = gpuCmd;
    root.querySelectorAll<HTMLInputElement>('input[name="helper-os"]').forEach((i) => (i.checked = i.value === opts.os()));
  };

  const result = q("[data-helper-result]");
  const render = () => {
    const g = st.info?.gpus[st.gpu];
    if (!st.info || !g) {
      result.innerHTML = st.info
        ? `<p class="next-step tiny">No GPU found in that text. Paste everything the command printed, including the lines starting with <code>GPU:</code>.</p>`
        : `<p class="muted tiny">Paste the output above and the ID is built for you.</p>`;
      return;
    }
    const refs = referenceMatches(g);
    const choices = [...new Set([...refs.options, ...(refs.fallback && !refs.options.includes(refs.fallback) ? [refs.fallback] : [])])];
    const vendor = vendorOf(st.base);
    const id = st.base ? buildGpuId(st) : "";
    const listed = id && findGpu(id);
    result.innerHTML = `
      <p class="tiny">Found <b>${esc(g.name)}</b>${g.vramGb ? `, ${g.vramGb} GB` : ""}${st.info.formFactor ? ` on a ${st.info.formFactor}` : ""}.</p>
      ${
        st.info.gpus.length > 1
          ? `<label class="field"><span>Which GPU ran the benchmark?</span><select data-helper-gpu>${st.info.gpus.map((x, i) => `<option value="${i}"${i === st.gpu ? " selected" : ""}>${esc(x.name)}${x.vramGb ? ` (${x.vramGb} GB)` : ""}</option>`).join("")}</select></label>`
          : ""
      }
      <div class="field"><span>Desktop card or laptop</span><div class="seg seg-sm" role="radiogroup" aria-label="Desktop card or laptop">${(["desktop", "laptop"] as const)
        .map((f) => `<label><input type="radio" name="helper-ff" value="${f}"${f === st.formFactor ? " checked" : ""} /><span>${f === "desktop" ? "Desktop card" : "Laptop"}</span></label>`)
        .join("")}</div></div>
      <label class="field"><span>GPU and memory <em>the catalog's reference for this chip</em></span><select data-helper-base>
        ${st.base ? "" : `<option value="">— Choose —</option>`}
        ${choices.map((c) => `<option value="${esc(c)}"${c === st.base ? " selected" : ""}>${esc(c)}${c === refs.fallback && !refs.options.includes(c) ? " (no reference file yet)" : ""}</option>`).join("")}
      </select></label>
      ${
        st.formFactor === "desktop"
          ? `<label class="field"><span>Who made the card</span><select data-helper-maker>
              <option value="">Not sure</option>
              ${vendor ? `<option value="own"${st.maker === "own" ? " selected" : ""}>${esc(OWN_CARD[vendor].label)} (made by ${vendor === "nvidia" ? "NVIDIA" : vendor === "amd" ? "AMD" : "Intel"})</option>` : ""}
              ${BOARD_BRANDS.map((b) => `<option value="${b.token}"${b.token === st.maker ? " selected" : ""}>${esc(b.label)}</option>`).join("")}
            </select></label>
            ${st.maker && st.maker !== "own" ? `<label class="field"><span>Product line <em>optional, from the box</em></span><input data-helper-line value="${esc(st.line)}" placeholder="e.g. Gaming OC, Ventus 2X OC, TUF Gaming" /></label>` : ""}`
          : `<p class="muted tiny">Laptop GPUs use the reference ID: the laptop's maker and model aren't part of it.</p>`
      }
      ${
        id
          ? `<p class="helper-id">ID: <code>${esc(id)}</code>${listed ? "" : " — filled in below"}</p>
             ${listed ? `<p class="ok tiny">It's already in the catalog as ${esc(listed.name)}. <button type="button" class="btn btn-sm" data-helper-listed="${esc(id)}">Use it</button></p>` : ""}
             ${st.formFactor === "desktop" && !st.maker ? `<p class="muted tiny">Not sure who made it? <code>_reference</code> works until someone adds the exact card.</p>` : ""}`
          : `<p class="next-step tiny">Choose the GPU and memory above.</p>`
      }`;
    if (id && !listed) opts.apply({ gpuName: productName(g.name, st), gpuIdRequested: id, gpuFormFactor: st.formFactor });
  };

  const fromPaste = (text: string) => {
    const info = parseGpuInfo(text);
    st.info = text.trim() ? info : null;
    st.gpu = 0;
    pickGpu();
  };
  // A new GPU choice resets what was worked out from the previous one.
  const pickGpu = () => {
    const g = st.info?.gpus[st.gpu];
    if (!g) return render();
    st.base = referenceMatches(g).base ?? "";
    st.formFactor = st.info!.formFactor ?? (/laptop|mobile|\d+m\b/i.test(g.name) ? "laptop" : "desktop");
    const maker = boardOf(g.board);
    st.maker = st.formFactor === "laptop" || !maker ? "" : "own" in maker ? "own" : maker.brand;
    st.line = "";
    render();
  };

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (el.matches("[data-helper-paste]")) return fromPaste(el.value);
    if (el.matches("[data-helper-gpu]")) {
      st.gpu = Number(el.value);
      return pickGpu();
    }
    if (el.matches("[data-helper-base]")) st.base = el.value;
    else if (el.matches('input[name="helper-ff"]')) st.formFactor = el.value as GpuFormFactor;
    else if (el.matches("[data-helper-maker]")) st.maker = el.value;
    else if (el.matches("[data-helper-line]")) {
      // Re-rendering would steal focus from the box being typed in: update the id and fields only.
      st.line = el.value;
      const g = st.info?.gpus[st.gpu];
      const code = result.querySelector(".helper-id code");
      if (g && st.base && code) {
        code.textContent = buildGpuId(st);
        opts.apply({ gpuName: productName(g.name, st), gpuIdRequested: buildGpuId(st), gpuFormFactor: st.formFactor });
      }
      return;
    } else if (el.matches('input[name="helper-os"]')) {
      opts.setOs(el.value as CmdOs);
      return;
    } else return;
    render();
  });
  root.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const listed = t.closest<HTMLElement>("[data-helper-listed]");
    if (listed) return opts.pickListed(listed.dataset.helperListed!);
    const copy = t.closest<HTMLButtonElement>("[data-helper-copy]");
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(q("[data-helper-cmd]").textContent ?? "");
      copy.textContent = "Copied ✓";
    } catch {
      getSelection()?.selectAllChildren(q("[data-helper-cmd]"));
      copy.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1800);
  });
  renderOs();
  return { renderOs };
}

/** The catalog file for the requested id, with download, copy and GitHub's new-file form. */
export function renderGpuFile(root: HTMLElement, s: Pick<SystemInfo, "gpuIdRequested" | "gpuName" | "gpuFormFactor">): void {
  const body = root.querySelector<HTMLElement>("[data-gpu-file-body]");
  if (!body) return;
  const ff = s.gpuFormFactor === "desktop" || s.gpuFormFactor === "laptop" ? s.gpuFormFactor : null;
  const f = ff ? catalogFile(s.gpuIdRequested.trim(), s.gpuName, ff) : null;
  if (!f) {
    body.innerHTML = `<p class="muted tiny">Fill in your GPU's name, the requested gpu_id and desktop card or laptop, and the file appears here.</p>`;
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
