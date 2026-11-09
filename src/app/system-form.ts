import { GPU_CATALOG, GPU_REFERENCES, NOT_LISTED, UPSTREAM_CATALOG_README, UPSTREAM_TEMPLATES, catalogLabel, findGpu, gpuRequestUrl } from "../benchmark/catalog";
import { OVERCLOCK_FIELDS, SYSTEM_FIELDS, UNLISTED_GPU_FIELDS, fieldFor, submittedGpuId, type SystemField } from "../benchmark/fields";
import { buildGpuId, knownProduct, parseGpuInfo, referenceIn, referenceMatches, type GpuFormFactor } from "../benchmark/gpu-id";
import { searchGpus, type GpuOption } from "../benchmark/gpu-search";
import { referencesFor } from "../benchmark/guess";
import { SYSINFO_COMMANDS, parseSysinfoPaste } from "../benchmark/sysinfo";
import type { BenchResult, SystemInfo } from "../benchmark/types";
import { missingLabels, validateSubmission } from "../benchmark/validate";
import { esc } from "./dom";
import { bindGpuHelper, gpuFileHtml, gpuHelperHtml, osSwitchHtml, renderGpuFile, type CmdOs } from "./gpu-helper";

// ---------------------------------------------------------------------------
// The results page's System details form. Filled in for the user as far as the browser allows
// (src/benchmark/guess.ts, marked with where each guess came from), so most people only confirm
// the GPU and OS and download. The GPU is a type-to-search list of every GPU the catalog knows,
// listed or not; common fields are dropdowns with "Other… (type it)"; the lookup command is an
// optional extra whose whole output is pasted once.
// ---------------------------------------------------------------------------

const OTHER = "__other__";
/** Typed fields shown in the optional block, in order; Linux-only ones go in their own section. */
const OPTIONAL_KEYS: (keyof SystemInfo)[] = ["cpu", "memoryGb", "memoryType", "memoryChannels", "osDetail", "driver"];
const LINUX_KEYS: (keyof SystemInfo)[] = ["distro", "kernel", "mesa"];

function tag(key: string): string {
  return `<b class="suggested-tag" data-suggested="${key}" hidden></b>`;
}

/** A typed field: a plain text box. */
function inputField(f: SystemField, placeholder = f.placeholder ?? ""): string {
  const need = f.section === "unlisted" ? "needed to submit" : "optional";
  return `<label class="field${f.linux ? " linux-only" : ""}"><span>${esc(f.label)} <em>${need}</em> ${tag(f.key)}</span><input name="${f.key}" placeholder="${esc(placeholder)}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ""}${f.help ? ` aria-describedby="help-${f.key}"` : ""} />${f.help ? `<small class="field-help" id="help-${f.key}">${esc(f.help)}</small>` : ""}</label>`;
}

/** A field with common values: a dropdown, and a text box for "Other… (type it)". The text box holds the value. */
function comboField(f: SystemField): string {
  return `<label class="field combo${f.linux ? " linux-only" : ""}" data-combo="${f.key}"><span>${esc(f.label.replace(/ \(GB, digits only\)$/, ""))} <em>optional</em> ${tag(f.key)}</span>
    <select data-combo-select="${f.key}"></select>
    <input name="${f.key}" class="combo-other" placeholder="${esc(f.placeholder ?? "")}" aria-label="${esc(f.label)}, typed in" ${f.inputmode ? `inputmode="${f.inputmode}"` : ""} hidden />
    ${f.help ? `<small class="field-help">${esc(f.help)}</small>` : ""}</label>`;
}

function fieldHtml(key: keyof SystemInfo, r: BenchResult): string {
  const f = fieldFor(key)!;
  if (f.options) return comboField(f);
  // The browser can't name the CPU, but its thread count narrows it down.
  const threads = r.diag?.cpuThreads;
  return inputField(f, key === "cpu" && threads ? `${threads} threads, e.g. AMD Ryzen 7 7800X3D` : undefined);
}

export function systemFormHtml(r: BenchResult): string {
  const os: CmdOs = r.system.os === "linux" ? "linux" : "windows";
  return `<form class="card sys-form" id="sys-form" autocomplete="off">
    <h2><span class="kana" aria-hidden="true">システム</span>System details</h2>
    <div class="guess-summary" id="guess-summary" aria-live="polite"></div>
    ${r.carriedFrom ? `<p class="carried-note" id="carried-note">Filled in from your result of ${esc(r.carriedFrom)}. Check they still match before submitting.</p>` : ""}

    <div class="field gpu-pick">
      <label for="gpu-search"><span class="field-label">GPU or device <em>required</em> ${tag("gpuId")}</span></label>
      <div class="gpu-search-wrap">
        <input id="gpu-search" type="text" role="combobox" aria-expanded="false" aria-controls="gpu-results" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type to search: 5080, RX 9070, Steam Deck…" />
        <ul id="gpu-results" class="gpu-results" role="listbox" aria-label="GPUs" hidden></ul>
      </div>
      <input type="hidden" name="gpuId" />
      <small class="field-help" id="gpu-picked"></small>
    </div>
    <div id="gpu-blocked" class="blocked" hidden>
      ${gpuHelperHtml()}
      <details class="gpu-more" id="gpu-more">
        <summary>Its name and ID, catalog file, and how to get it added</summary>
        ${UNLISTED_GPU_FIELDS.filter((f) => f.kind === "text").map((f) => inputField(f)).join("")}
        ${gpuFileHtml()}
        <div class="blocked-links">
          <p><a class="btn btn-primary" id="gpu-request" href="${esc(gpuRequestUrl(r.system.gpuName || r.device?.gpuLabel))}" target="_blank" rel="noopener">Request your GPU (open an issue) →</a> <span class="muted tiny">Easiest, no coding needed.</span></p>
          <p><a class="btn" href="${UPSTREAM_TEMPLATES}" target="_blank" rel="noopener">Add it yourself (pull request) →</a> <span class="muted tiny">If you're comfortable with GitHub (<a href="${UPSTREAM_CATALOG_README}" target="_blank" rel="noopener">ID rules</a>).</span></p>
        </div>
      </details>
      <p class="tiny">Saving, sharing and downloading work now. Submitting <b>fails the dataset's checks</b> until this GPU is added to the catalog, first or in the same pull request.</p>
    </div>

    <label class="field"><span>Operating system <em>required</em> ${tag("os")}</span>
      <select name="os"><option value="">— Select —</option><option value="windows">Windows</option><option value="linux">Linux (incl. SteamOS)</option></select></label>
    <label class="field"><span>GPU overclocked <em>optional</em></span>
      <select name="overclocked"><option value="">— Not saying —</option><option value="no">No, stock clocks and power limit</option><option value="yes">Yes, overclocked or raised power limit</option></select></label>
    <fieldset class="oc-details"><legend>What you raised <span class="muted tiny">(MSI Afterburner or your vendor's tuning tool)</span></legend>${OVERCLOCK_FIELDS.map((f) => inputField(f)).join("")}</fieldset>

    <h3 class="opt-head">Optional: helps others compare</h3>
    ${OPTIONAL_KEYS.map((k) => fieldHtml(k, r)).join("")}
    <details class="linux-more linux-only" id="linux-more"><summary>More Linux details: distro, kernel, Mesa</summary>
      ${LINUX_KEYS.map((k) => fieldHtml(k, r)).join("")}
    </details>

    <details class="exact" id="exact-values">
      <summary>Want exact values? Run one command and paste what it prints</summary>
      <p class="muted tiny">Optional. The command only reads information, and you can see all of it below. This page never runs it or reads your system: it only reads what you paste.</p>
      ${osSwitchHtml("cmd-os", os)}
      <p class="muted tiny" data-cmd-open></p>
      <div class="cmd"><div class="cmd-head"><b>The command</b><button type="button" class="btn btn-sm" data-copy="all">Copy command</button></div><pre data-cmd-all></pre></div>
      <label class="field"><span>Paste what it printed</span><textarea data-sys-paste rows="5" spellcheck="false" autocapitalize="off" placeholder="OS version:  Windows 11 Pro 24H2&#10;CPU:         AMD Ryzen 7 7800X3D&#10;…"></textarea></label>
      <p class="tiny" data-paste-status role="status"></p>
      <details class="cmd-list"><summary>One command per detail</summary><div class="cmds" data-cmd-list></div></details>
    </details>
  </form>`;
}

/** How the chosen GPU reads: its catalog name, or the typed or built name of one that isn't listed. */
export function gpuDisplay(s: Pick<SystemInfo, "gpuId" | "gpuName" | "gpuIdRequested">): string {
  if (s.gpuId === NOT_LISTED) return s.gpuName.trim() || s.gpuIdRequested.trim();
  const g = findGpu(s.gpuId);
  return g ? catalogLabel(g) : "";
}

/** The one-line summary at the top of the form: what we think the machine is, and what's still needed. */
export function summaryHtml(r: BenchResult): string {
  const s = r.system;
  const gpu = gpuDisplay(s);
  const os = s.osDetail.trim() || (s.os === "windows" ? "Windows" : s.os === "linux" ? "Linux" : "");
  const parts = [gpu, os, s.cpu.trim(), s.memoryGb.trim() ? `${s.memoryGb.trim()} GB${s.memoryType.trim() ? ` ${s.memoryType.trim()}` : ""}` : "", r.graphicsApi].filter(Boolean);
  const errors = validateSubmission(r);
  const missing = missingLabels(errors);
  const guessed = (r.suggested ?? []).length > 0;
  return `<p class="guess-line">${parts.length ? esc(parts.join(" · ")) : "Tell us your GPU and OS."}</p>
    <p class="tiny ${errors.length ? "next-step" : "ok"}">${
      errors.length ? `Still needed: ${esc(missing.join(", "))}.` : `✓ Ready to download${s.gpuId === NOT_LISTED ? " (submitting needs the GPU added to the catalog)" : " and submit"}.`
    }${guessed ? " Values marked in amber are our best guesses from your browser: check them." : ""}</p>`;
}

export interface SystemFormApi {
  /** Re-reads the result into the form: summary, tags, dropdowns and sections. */
  refresh(): void;
}

/**
 * Wires the form to `r`. Every change is written into r.system and passed to `save` (which stores
 * the result and refreshes the rest of the page); a value the user changes stops being a suggestion.
 */
export function bindSystemForm(form: HTMLFormElement, r: BenchResult, save: () => void): SystemFormApi {
  const q = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
  const other = new Set<string>();

  /** Sets fields as the user's (or a command's) values: the form follows, and changed values lose their suggested mark. */
  const setValues = (vals: Partial<SystemInfo>, keepMarks = false) => {
    for (const [k, v] of Object.entries(vals) as [keyof SystemInfo, string][]) {
      const changed = r.system[k] !== v;
      r.system[k] = v;
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = v;
      if (changed && !keepMarks) unmark(k);
    }
  };
  const unmark = (k: keyof SystemInfo) => {
    if (!r.suggested?.includes(k)) return;
    r.suggested = r.suggested.filter((x) => x !== k);
    if (r.suggestedWhy) delete r.suggestedWhy[k];
    if (!r.suggested.length) delete r.suggested;
  };

  // --- GPU: type to search ---------------------------------------------------
  const search = q<HTMLInputElement>("#gpu-search");
  const list = q<HTMLUListElement>("#gpu-results");
  let shown: GpuOption[] = [];
  let typed = "";
  let active = -1;

  const helper = bindGpuHelper(q("#gpu-blocked"), {
    // The helper's built name and id: kept marked if they're the guess itself.
    apply: (vals) => {
      setValues(vals, true);
      save();
    },
    pickListed: (id) => {
      setValues({ gpuId: id });
      save();
    },
  });

  const closeList = () => {
    list.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const renderList = () => {
    typed = search.value.trim();
    shown = searchGpus(typed, 8);
    const rows = shown.map(
      (o, i) => `<li role="option" id="gpu-opt-${i}" data-i="${i}" class="${o.kind}"><span class="opt-name">${esc(o.label)}</span><span class="opt-detail">${o.kind === "product" ? "In the dataset" : "Not in the dataset yet"}${o.detail ? ` · ${esc(o.detail)}` : ""}</span></li>`,
    );
    if (typed) rows.push(`<li role="option" id="gpu-opt-typed" data-i="typed" class="typed"><span class="opt-name">Use “${esc(typed)}”</span><span class="opt-detail">Not in the list? Type its full name, e.g. “ASUS GeForce RTX 5070 Ti 16 GB”.</span></li>`);
    else rows.push(`<li class="hint" aria-hidden="true">Type to search ${GPU_CATALOG.length + GPU_REFERENCES.length} GPUs, or type any name.</li>`);
    list.innerHTML = rows.join("");
    list.hidden = false;
    search.setAttribute("aria-expanded", "true");
    active = -1;
  };
  const highlight = (i: number) => {
    const items = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((el, n) => el.setAttribute("aria-selected", String(n === active)));
    search.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };
  const choose = (key: string) => {
    closeList();
    if (key === "typed") {
      const name = typed;
      if (!name) return;
      const vram = /(\d+)\s*GB\b/i.exec(name);
      setValues({ gpuId: NOT_LISTED, gpuName: name, gpuIdRequested: "" });
      helper.pick({ name, vramGb: vram ? Number(vram[1]) : null, board: "" }, { formFactor: /laptop|mobile/i.test(name) ? "laptop" : null });
    } else {
      const o = shown[Number(key)];
      if (!o) return;
      if (o.kind === "product") setValues({ gpuId: o.id });
      else {
        setValues({ gpuId: NOT_LISTED, gpuName: "", gpuIdRequested: "" });
        helper.pick({ name: o.label, vramGb: o.ref.memoryGb ?? null, board: "" }, { formFactor: o.formFactor, base: o.ref.id });
        q<HTMLDetailsElement>("#gpu-more").open = false;
      }
    }
    save();
  };
  search.addEventListener("focus", () => {
    search.select();
    renderList();
  });
  search.addEventListener("input", renderList);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) renderList();
      highlight(active + (e.key === "ArrowDown" ? 1 : -1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const el = active >= 0 ? list.querySelectorAll<HTMLElement>('[role="option"]')[active] : null;
      if (el) choose(el.dataset.i!);
      else if (shown.length === 1) choose("0");
      else if (typed) choose("typed");
    } else if (e.key === "Escape") {
      closeList();
      search.value = gpuDisplay(r.system);
    }
  });
  search.addEventListener("blur", () => {
    closeList();
    search.value = gpuDisplay(r.system);
  });
  // mousedown, not click: it lands before the search box's blur closes the list.
  list.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choose(li.dataset.i!);
    search.blur();
  });

  // A guessed GPU that isn't listed: open the helper on it, so its memory size and maker are a click away.
  // Not when the user built a custom id already (a brand and product line): the helper would reset it.
  if (r.system.gpuId === NOT_LISTED && r.system.gpuName.trim()) {
    const base = referenceIn(r.system.gpuIdRequested) ?? (referencesFor(r.system.gpuName).length === 1 ? referencesFor(r.system.gpuName)[0].id : undefined);
    const ff = (r.system.gpuFormFactor || null) as GpuFormFactor | null;
    const untouched = !r.system.gpuIdRequested.trim() || (base && r.system.gpuIdRequested === buildGpuId({ base, formFactor: ff ?? "desktop" }));
    if (untouched) {
      const ref = GPU_REFERENCES.find((x) => x.id === base);
      helper.pick({ name: r.system.gpuName, vramGb: ref?.memoryGb ?? null, board: "" }, { formFactor: ff, ...(base ? { base } : {}) });
    } else q<HTMLDetailsElement>("#gpu-more").open = true;
  }

  // --- Dropdowns with "Other… (type it)" -------------------------------------
  const syncCombo = (key: keyof SystemInfo) => {
    const f = fieldFor(key)!;
    const sel = form.querySelector<HTMLSelectElement>(`[data-combo-select="${key}"]`);
    const input = form.elements.namedItem(key) as HTMLInputElement | null;
    if (!sel || !input || !f.options) return;
    const v = r.system[key] ?? "";
    const opts = f.options({ os: r.system.os });
    const listed = opts.some((o) => o.value === v);
    const typing = other.has(key);
    sel.innerHTML = [
      `<option value="">— Not sure —</option>`,
      ...(v && !listed && !typing ? [`<option value="${esc(v)}">${esc(v)}</option>`] : []),
      ...opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label ?? o.value)}</option>`),
      `<option value="${OTHER}">Other… (type it)</option>`,
    ].join("");
    sel.value = typing ? OTHER : v;
    input.hidden = !typing;
    if (document.activeElement !== input) input.value = v;
  };
  form.addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const key = sel.dataset.comboSelect as keyof SystemInfo | undefined;
    if (!key) return;
    const input = form.elements.namedItem(key) as HTMLInputElement;
    if (sel.value === OTHER) {
      other.add(key);
      input.hidden = false;
      input.focus();
      return;
    }
    other.delete(key);
    input.value = sel.value;
    // Picking the value that's already there confirms a guess.
    if (r.system[key] === sel.value) {
      unmark(key);
      save();
    } else input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // --- Typed fields ----------------------------------------------------------
  form.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (!(el.name in r.system)) return;
    const k = el.name as keyof SystemInfo;
    if (r.system[k] === el.value) return;
    r.system[k] = el.value;
    unmark(k);
    save();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  // --- Optional: one command, pasted once ------------------------------------
  let cmdOs: CmdOs = r.system.os === "linux" ? "linux" : "windows";
  const renderCommands = () => {
    const set = SYSINFO_COMMANDS[cmdOs];
    q("[data-cmd-open]").textContent = `${set.shell}: ${set.howToOpen}`;
    q("[data-cmd-all]").textContent = set.all;
    form.querySelectorAll<HTMLInputElement>('input[name="cmd-os"]').forEach((i) => (i.checked = i.value === cmdOs));
    const label = (f: string) => (f === "gpu" ? "GPU" : (fieldFor(f)?.label ?? f));
    q("[data-cmd-list]").innerHTML = set.commands
      .map(
        (c, i) => `<div class="cmd"><div class="cmd-head"><b>${esc(c.label)}</b><span class="muted tiny">→ ${esc(label(c.field))}</span>${c.command ? `<button type="button" class="btn btn-sm" data-copy="${i}">Copy</button>` : ""}</div>
        ${c.command ? `<pre>${esc(c.command)}</pre>` : ""}${c.note ? `<p class="muted tiny">${esc(c.note)}</p>` : ""}</div>`,
      )
      .join("");
  };
  form.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.name !== "cmd-os") return;
    cmdOs = el.value as CmdOs;
    renderCommands();
  });
  form.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!btn) return;
    const set = SYSINFO_COMMANDS[cmdOs];
    const text = btn.dataset.copy === "all" ? set.all : set.commands[Number(btn.dataset.copy)].command;
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied ✓";
    } catch {
      const pre = btn.closest(".cmd")?.querySelector("pre");
      if (pre) getSelection()?.selectAllChildren(pre);
      btn.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (btn.textContent = label), 1800);
  });
  q<HTMLTextAreaElement>("[data-sys-paste]").addEventListener("input", (e) => {
    const text = (e.target as HTMLTextAreaElement).value;
    const status = q("[data-paste-status]");
    if (!text.trim()) {
      status.textContent = "";
      return;
    }
    const vals = parseSysinfoPaste(text);
    const filled = Object.keys(vals).map((k) => fieldFor(k)?.label.replace(/ \(GB, digits only\)$/, "") ?? k);
    for (const k of Object.keys(vals)) other.delete(k);
    setValues(vals);
    // The GPU from the paste, unless the user already chose one themselves.
    const gpuChosenByUser = r.system.gpuId.trim() && !r.suggested?.includes("gpuId");
    const info = parseGpuInfo(text);
    if (!gpuChosenByUser && info.gpus.length) {
      const g = info.gpus[0];
      const base = referenceMatches(g).base;
      // A listed product for that chip, when there's only one to choose from.
      const sameChip = base ? GPU_CATALOG.filter((p) => p.base === base) : [];
      const product = knownProduct(g) ?? (sameChip.length === 1 ? sameChip[0].id : undefined);
      if (product) setValues({ gpuId: product });
      else {
        setValues({ gpuId: NOT_LISTED });
        helper.fromPaste(text);
      }
      filled.unshift("GPU");
    }
    status.innerHTML = filled.length
      ? `<span class="ok">✓ Filled in ${esc(filled.join(", "))}.</span>`
      : `<span class="next-step">Nothing found in that text. Paste everything the command printed.</span>`;
    save();
  });
  renderCommands();

  const refresh = () => {
    for (const [k, v] of Object.entries(r.system)) {
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
      if (el && document.activeElement !== el) el.value = v;
    }
    if (document.activeElement !== search) search.value = gpuDisplay(r.system);
    for (const f of SYSTEM_FIELDS) if (f.options) syncCombo(f.key);
    form.querySelectorAll<HTMLElement>("[data-suggested]").forEach((t) => {
      const k = t.dataset.suggested as keyof SystemInfo;
      const on = !!r.suggested?.includes(k);
      t.hidden = !on;
      if (on) t.textContent = r.suggestedWhy?.[k] ?? "suggested";
    });
    const notListed = r.system.gpuId === NOT_LISTED;
    q("#gpu-blocked").hidden = !notListed;
    q("#gpu-picked").textContent = notListed
      ? `Not in the dataset yet: ID ${submittedGpuId(r.system) || "not built yet"}.`
      : r.system.gpuId
        ? `In the dataset as ${r.system.gpuId}.`
        : "";
    if (notListed) {
      q<HTMLAnchorElement>("#gpu-request").href = gpuRequestUrl(r.system.gpuName || r.device?.gpuLabel);
      renderGpuFile(q("#gpu-blocked"), r.system);
    }
    // Linux details stay visible once filled, so a windows/linux mix can be seen and fixed.
    const linux = r.system.os === "linux" || LINUX_KEYS.some((k) => r.system[k].trim());
    form.classList.toggle("show-linux", linux);
    form.classList.toggle("show-oc", r.system.overclocked === "yes");
    q<HTMLInputElement>('[name="driver"]').placeholder = r.system.os === "linux" ? "e.g. Mesa 26.1.2, or NVIDIA 580.95.05" : "e.g. 581.57 (NVIDIA), 25.10.1 (AMD)";
    q("#guess-summary").innerHTML = summaryHtml(r);
  };
  return { refresh };
}
