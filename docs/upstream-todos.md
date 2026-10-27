# Upstream TODOs (open-gpu-benchmarks)

These are follow-ups for [MattyStacks/open-gpu-benchmarks](https://github.com/MattyStacks/open-gpu-benchmarks), first noted on 2026-10-23 during Plan 6, with items 4 and 5 added on 2026-10-27. Each item has a draft. Hand this file to a Claude session in that repo. Items 4 and 5 point to [upstream-submission-changes.md](upstream-submission-changes.md) for the full code; that file is public at https://github.com/MattyStacks/openbenchmarker/blob/main/docs/upstream-submission-changes.md.

Upstream state when this was written: the catalog holds one product (`desktop/nvidia/rtx_5080_16gb_fe`) plus 309 `reference/` base models. `.github/ISSUE_TEMPLATE/` holds only `benchmark.yml` ("Benchmark result", turned into a PR by a bot). Blank issues are on, because there's no `config.yml`.

## 1. Add GPUs people request (manual for now)

Open GPU Benchmarker's "Request your GPU" button opens a **prefilled blank issue**. The person edits it and submits it. Nothing is automated. For each request, the maintainer asks Claude to add the card.

Here is what a request looks like:

```markdown
Title: GPU catalog request: NVIDIA GeForce RTX 4070 SUPER

**GPU to add:** <!-- the exact product: brand, model and memory, e.g. MSI GeForce RTX 5060 Ti 16 GB Ventus 2X OC -->
**Form factor:** desktop / laptop <!-- keep one -->
**Product or spec page:** <!-- optional link, helps get the details right -->
**Reported by the browser (starting point, edit as needed):** NVIDIA GeForce RTX 4070 SUPER
---
Requested from Open GPU Benchmarker (https://opengpubenchmarker.com/). This is a catalog request only; it contains no benchmark result.
```

The browser-reported name is the WebGL renderer string, normalized. It gives the GPU model but never the board partner, and it's sometimes generic. Treat it as a hint and go by the person's own "GPU to add" line.

Steps for a Claude session, one request at a time:
- [ ] Read the issue. If the exact product is unclear (board partner, memory size, laptop model), ask on the issue first.
- [ ] Find the chip's reference file under `data/gpus/reference/<vendor>/`, for example `rtx_4070_super_12gb.yaml`.
- [ ] Pick the ID per `data/gpus/README.md` ("Picking the ID"). For example:
  - desktop: `<gpu_model>_<vram>gb_<brand>_<product_line>`
  - laptop: `<reference>_reference`, for example `rtx_5090_laptop_24gb_reference` (once item 5 lands; until then the README says `<oem>_<model>` or `…_generic`)
- [ ] Copy `templates/catalog_desktop.yaml` (or `catalog_laptop.yaml`) to `data/gpus/<form_factor>/<vendor>/<id>.yaml`. Set `base:` to the reference file, fill in identity and board-partner fields, and add `sources` (the maker's spec page, with an `accessed` date).
- [ ] Run the checks (`python scripts/validate.py` or the PR checks). Open a PR that links the issue (`Closes #N`), and reply on the issue once it's merged.
- [ ] Then, in **openbenchmarker**: `npm run refresh-catalog`, `npm test`, commit, deploy. The new card appears in the results page's GPU list. People who chose "My GPU isn't listed" can reopen their saved result from My Results and submit it. The results page also builds the GPU's catalog file for them, to add in the same PR as their result (item 5), so some requests will arrive as a PR instead.

## 2. Let the "Benchmark result" issue form take Open GPU Benchmarker runs

Today this tool's route is a pull request made with GitHub's new-file form, prefilled with the YAML. The issue form, where a bot opens the PR, would be easier for people who don't use GitHub much. Two gaps block it today:
- the form's `graphics_api` dropdown has no `WebGL2`
- the form has no score, score test or diagnostics

Draft option A, the small change to `benchmark.yml`:

```yaml
  - type: dropdown
    id: graphics_api
    attributes:
      label: Graphics API
      options:
        - DX12
        - DX11
        - Vulkan
        - WebGL2          # Open GPU Benchmarker (browser)
  - type: input
    id: score
    attributes:
      label: Score
      description: Optional. Open GPU Benchmarker score runs only (round(avg FPS × 100)).
```

Draft option B, a separate form `openbenchmarker_result.yml` (the better fit, because it keeps every field the tool writes):

```yaml
name: Open GPU Benchmarker result
description: Paste the YAML from opengpubenchmarker.com. A bot checks it and opens a pull request.
title: "Open GPU Benchmarker: "
labels: [benchmark, openbenchmarker]
body:
  - type: input
    id: gpu
    attributes: { label: GPU catalog ID, placeholder: rtx_5080_16gb_fe }
    validations: { required: true }
  - type: textarea
    id: yaml
    attributes:
      label: Result YAML
      description: Use "Copy YAML" on the results page. Don't edit the measured numbers.
      render: yaml
    validations: { required: true }
  - type: checkboxes
    id: credit
    attributes:
      label: Credit
      options: [{ label: Credit me as my GitHub username }]
  - type: checkboxes
    id: confirmations
    attributes:
      label: Confirmations
      options:
        - label: I release these results under CC BY 4.0 … (same wording as benchmark.yml)
          required: true
```

For option B, the bot runs `checks.py` on the pasted YAML, as it would on a PR file, and writes `data/community/<gpu>/<file>.yaml`.

- [ ] Choose A or B and add the form.
- [ ] Bot: support it (B: write the pasted YAML as the result file after the checks pass).
- [ ] Then, in **openbenchmarker**, add "Submit with the issue form" next to the PR route, prefilled by field id: `issues/new?template=openbenchmarker_result.yml&gpu=<id>&yaml=<yaml>`. Watch URL length, since the YAML with diagnostics is a few KB; GitHub accepts about 8 KB of URL. Keep the PR route as a fallback.

## 3. Phone and tablet runs as synthetic results (schema change)

Phone and tablet runs can be shared but not submitted, because the dataset lists desktop and laptop GPUs only (and `handheld` gaming PCs). The goal is to accept them as **synthetic-only** results that are never grouped with desktop or laptop GPUs.

Draft of the schema change:
- [ ] `scripts/checks.py`:
  - add `phone` and `tablet` to `GPU_FORM_FACTORS`, and to `PLATFORM_FORM_FACTORS` so they can carry `platform:` device specs
  - decide between this and reusing `handheld`. Separate values are recommended: handhelds run desktop games and phones don't.
- [ ] `system.os`: allow `ios`, `ipados` and `android` for phone and tablet entries only, and keep `windows|linux` for the rest.
- [ ] Results on phone and tablet IDs: allow only games with `type: synthetic` (a new check, for example `result-phone-synthetic-only`).
- [ ] ID pattern, like handhelds: `<device>_<chip>_<ram>gb`, for example `iphone_16_pro_a18_pro_8gb`, `ipad_pro_11_m4_8gb`, `galaxy_s25_ultra_snapdragon_8_elite_12gb`. RAM is soldered, so each RAM size is its own entry.
- [ ] Add `templates/catalog_phone.yaml` (and a tablet one), based on `catalog_handheld.yaml`, with `platform.oem`, `platform.soc` and `os_shipped`.
- [ ] Add reference files for the SoC GPUs (Apple A/M series, Adreno, Mali, Xclipse), or allow no `base:` for phones.
- [ ] Dashboard: a separate phone/tablet table, never averaged with PCs.

Then, in **openbenchmarker**:
- [ ] Allow submission for phone and tablet runs (`isHandheld` currently blocks it in `results-view.ts` and `result-display.ts`). The OS options become iOS/iPadOS/Android, and the phone note copy changes.
- [ ] The CSV `status` column shows `incomplete` for phone runs today, and stays that way until this lands. Once phone runs can be submitted, `incomplete` is correct for phones too, so check that the wording still fits.
- [ ] The README sections "Phones and tablets" and "Honest-data rules", and the FAQ.

## 4. Validate the extra result fields and the overclock block

Open GPU Benchmarker (game_id `openbenchmarker_neon_flythrough`) writes more than checks.py knows about. Today it all passes, because unknown keys are ignored, but nothing is validated or used. The full YAML example and ready-to-use Python are in upstream-submission-changes.md, sections 1–4.

What's new in the YAML:
- top level: `overclock:` (only with `overclocked: true`), with `core_clock_offset_mhz`, `memory_clock_offset_mhz` and `power_limit_pct`, each present only when filled in
- top level: `detected:`, values read from the browser, never typed in by the submitter
- each result entry: run details (`p5_low`, `frame_count`, `timing_method`, …), `score` + `score_test` on score runs, `rendered_with` and `diagnostics`

- [ ] `scripts/checks.py`: add the field tables and `check_typed()` / `check_openbenchmarker_entry()` from section 1, called only for this game_id. Also add the top-level checks: `overclocked` is a bool, `overclock:` needs `overclocked: true` and ints in range, `detected:` is typed.
- [ ] `check_outliers`: skip runs that are overclocked or CPU-limited (`diagnostics.limit` cpu/driver/mixed), with an info note instead of the 25% error (section 2).
- [ ] Optional: add `openbenchmarker` to `P1_LOW_METHODS` (section 3). Merge it upstream first, then switch `PROOF_METHOD` in openbenchmarker's `src/benchmark/validate.ts` from `other` to `openbenchmarker`.
- [ ] Add `templates/community_openbenchmarker.yaml`, add `docs/COMMUNITY_SUBMISSIONS.md` headings for the new rule ids, and document `overclock:` and `detected:` (section 4).
- [ ] Tests: a sample YAML with `overclock:`, `detected:`, diagnostics and a score validates, and each bad value fails with the right rule id.

## 5. Catalog IDs: `_reference` when the exact model isn't known

The results page builds an unlisted GPU's ID from the lookup command's output (PCI name, VRAM, board vendor, laptop or desktop) and gives the person the catalog file with `base:` set to the reference. `check_catalog_id` already accepts these IDs, so this is mostly a README and policy change (upstream-submission-changes.md, section 5).

| Form factor | Pattern | Example |
| --- | --- | --- |
| laptop | `<reference>_reference` | `rtx_5090_laptop_24gb_reference`, `rx_7600m_xt_8gb_reference` |
| desktop, GPU vendor's own card | `<reference>_fe` / `_reference` / `_le` | `rtx_5080_16gb_fe` (unchanged) |
| desktop, brand and line known | `<reference>_<brand>_<product_line>` | `rtx_5080_16gb_gigabyte_gaming_oc` (unchanged) |
| desktop, brand known, line not | `<reference>_<brand>_reference` | `rtx_5080_16gb_gigabyte_reference` |
| desktop, brand not known | `<reference>_reference` | `rtx_5080_16gb_reference` |

- [ ] Rewrite "Picking the ID" in `data/gpus/README.md` to match this table. Laptop IDs leave out the laptop's maker and model: laptop GPUs are the chip vendor's design.
- [ ] Replace the `_generic` rule with `reference`. In `check_catalog_id`, update the laptop shape hint and the `id-generic` checks (drop them, or make `generic` an error that says to use `_reference`). Decide whether `_reference` products should get a warning so named models still win.
- [ ] Rename the `rtx_4070_laptop_8gb_generic` example (and the file, if there is one) to `rtx_4070_laptop_8gb_reference`.
- [ ] Note that `rx_9070_xt_16gb_reference` now covers AMD's own card and an unknown board alike: both use the reference specs.
- [ ] Check that the file the tool generates passes as is, for example `data/gpus/laptop/nvidia/rtx_5090_laptop_24gb_reference.yaml`, which has `id`, `base`, `identity.name`, `identity.gpu_vendor`, `classification.form_factor` and `memory.capacity_gb` (branded desktops also get `identity.board_partner`). If more fields are needed, list them so openbenchmarker's `catalogFile()` in `src/benchmark/gpu-id.ts` can add them.
- [ ] Done when a PR with that GPU file plus a result using its gpu_id passes CI.

## 6. Later, undecided

- [ ] A dedicated `gpu_request.yml` issue form with fields `gpu_name`, `form_factor`, `vendor` and `product_url`. The prefill would become `?template=gpu_request.yml&gpu_name=…`. Possibly automate catalog additions from it. Not decided; requests stay manual for now (item 1).
