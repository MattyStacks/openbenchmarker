# Upstream TODOs (open-gpu-benchmarks)

These are follow-ups for [MattyStacks/open-gpu-benchmarks](https://github.com/MattyStacks/open-gpu-benchmarks), noted on 2026-10-23 during Plan 6. Each item has a draft. Hand this file to a Claude session in that repo. Validating the extra result fields (score, `rendered_with`, `diagnostics`, `detected`) is a separate task, covered in [upstream-submission-changes.md](upstream-submission-changes.md).

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
  - laptop: `<gpu_model>_<vram>gb_<oem>_<model>` or `…_generic`
- [ ] Copy `templates/catalog_desktop.yaml` (or `catalog_laptop.yaml`) to `data/gpus/<form_factor>/<vendor>/<id>.yaml`. Set `base:` to the reference file, fill in identity and board-partner fields, and add `sources` (the maker's spec page, with an `accessed` date).
- [ ] Run the checks (`python scripts/validate.py` or the PR checks). Open a PR that links the issue (`Closes #N`), and reply on the issue once it's merged.
- [ ] Then, in **openbenchmarker**: `npm run refresh-catalog`, `npm test`, commit, deploy. The new card appears in the results page's GPU list. People who chose "My GPU isn't listed" can reopen their saved result from My Results and submit it.

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

## 4. Later, undecided

- [ ] A dedicated `gpu_request.yml` issue form with fields `gpu_name`, `form_factor`, `vendor` and `product_url`. The prefill would become `?template=gpu_request.yml&gpu_name=…`. Possibly automate catalog additions from it. Not decided; requests stay manual for now (item 1).
