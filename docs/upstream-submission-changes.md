# Upstream changes for richer Open GPU Benchmarker submissions

Open GPU Benchmarker now writes more to each submission YAML: score-run scores, the settings the
scene actually rendered with, a "what limited this run" diagnosis, and a `detected:` block of
values read from the browser. This document lists what to change in
[open-gpu-benchmarks](https://github.com/MattyStacks/open-gpu-benchmarks) so those fields become
first-class: validated, documented and usable for charts and a future leaderboard.

Written against upstream `scripts/checks.py` and `templates/community_submission.yaml` as of
2026-10-21.

## Where things stand today (nothing breaks)

The new YAML **already passes** upstream checks unchanged:

- `check_result_file` only checks the result-entry fields it knows about. Unknown entry keys
  (`score_test`, `rendered_with`, `diagnostics`, …) and unknown top-level keys (`detected`) are
  ignored without an error.
- `score` is already in `RESULT_ENTRY_NUMBERS`, so it is type-checked as a number.
- `overclocked` is documented in the template as an optional top-level field, but nothing
  validates it.
- Nothing new goes under `system:`, so the `result-system-field` warning never fires.

So the order of deployment doesn't matter, but until upstream changes, the extra fields are
**unvalidated and unused**.

## What the tool emits

```yaml
gpu_id: rtx_5080_16gb_fe
game_id: openbenchmarker_neon_flythrough
date: "2026-10-21"
version: "2.0.0"
frame_generation: false
overclocked: true                 # only when the user answered; true/false
result:
  - resolution: "4K"
    time: "20:15"
    graphics_preset: "Extreme"
    avg_fps: 65.1
    p1_low: 55.2
    p5_low: 58.1
    duration: 60
    frame_count: 3907
    score: 6512                   # score runs only: round(avg_fps_unrounded * 100)
    score_test: extreme           # score runs only: entry | extreme
    worst_frame_ms: 24.6
    render_width: 3840
    render_height: 2160
    warmup_s: 3
    timing_method: gpu-timer      # gpu-timer | batch-avg
    rendered_with:                # what the scene actually used (bloom can fall back)
      bloom: true
      msaa: 8
      shadow_map: 4096
      reflections: 1
      volumetrics: 32             # ray-march steps of the volumetric haze; 0 = off (2.2.0+)
    diagnostics:
      limit: gpu                  # gpu | cpu | driver | mixed | software | unknown
      limit_estimated: false      # true when inferred without GPU timer queries
      gpu_busy_pct: 96.8          # omitted without GPU timers
      gpu_ms_per_frame: 14.87     # omitted without GPU timers
      frame_ms: 15.36
      cpu_ms_per_frame: 2.1
      scene_update_ms_per_frame: 0.6
      gpu_wait_ms_per_frame: 11.4
      loop_busy_pct: 98.1
      main_thread_stalls: 0
      stall_ms: 0
      hitches: 2
      frame_time_std_ms: 0.9
system:
  os: windows
  graphics_api: WebGL2
detected: # read from the browser by the run, not entered by the submitter
  webgl_renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  webgl_vendor: "Google Inc. (NVIDIA)"
  angle_backend: "D3D11"          # omitted when it can't be parsed
  cpu_threads: 24                 # omitted when unknown
  on_battery: false               # omitted when unknown (no Battery API)
  browser: "Chrome 141"
proof:
  method: other
```

The tool already refuses to produce YAML for software-rendered runs, invalid runs, mobile runs,
and runs whose `score` doesn't match `score_test` and `avg_fps`.

## 1. `scripts/checks.py`: validate the new fields

Add next to `RESULT_ENTRY_NUMBERS`:

```python
# Open GPU Benchmarker (game_id openbenchmarker_neon_flythrough) extra fields.
OPENBENCHMARKER_GAME_ID = "openbenchmarker_neon_flythrough"
SCORE_TESTS = {
    # score_test: (graphics_preset, resolution, duration)
    "entry": ("Low", "720p", 60),
    "extreme": ("Extreme", "4K", 60),
}
SCORE_PER_FPS = 100
LIMITS = ("gpu", "cpu", "driver", "mixed", "software", "unknown")
TIMING_METHODS = ("gpu-timer", "batch-avg")
# field: (kind, min, max); None = no bound
RUN_DETAIL_FIELDS = {
    "p5_low": ("number", 0, None),
    "duration": ("int", 1, 3600),
    "frame_count": ("int", 1, None),
    "worst_frame_ms": ("number", 0, None),
    "render_width": ("int", 1, 16384),
    "render_height": ("int", 1, 16384),
    "warmup_s": ("number", 0, 600),
}
RENDERED_WITH_FIELDS = {"bloom": ("bool",), "msaa": ("int", 0, 16), "shadow_map": ("int", 0, 16384), "reflections": ("number", 0, 4), "volumetrics": ("int", 0, 256)}
DIAGNOSTICS_FIELDS = {
    "limit_estimated": ("bool",),
    "gpu_busy_pct": ("number", 0, 100),
    "gpu_ms_per_frame": ("number", 0, None),
    "frame_ms": ("number", 0, None),
    "cpu_ms_per_frame": ("number", 0, None),
    "scene_update_ms_per_frame": ("number", 0, None),
    "gpu_wait_ms_per_frame": ("number", 0, None),
    "loop_busy_pct": ("number", 0, 100),
    "main_thread_stalls": ("int", 0, None),
    "stall_ms": ("number", 0, None),
    "hitches": ("int", 0, None),
    "frame_time_std_ms": ("number", 0, None),
}
DETECTED_FIELDS = {
    "webgl_renderer": ("text",),
    "webgl_vendor": ("text",),
    "angle_backend": ("text",),
    "cpu_threads": ("int", 1, 4096),
    "on_battery": ("bool",),
    "browser": ("text",),
}
```

Add a generic typed-map checker and the per-entry rules:

```python
def check_typed(path, issues, rule, label, spec_map, section):
    if not isinstance(section, dict):
        issues.error(path, rule, f"'{label}' must be a section with indented fields")
        return
    for key, value in section.items():
        spec = spec_map.get(key)
        if spec is None:
            issues.warning(path, rule, f"'{label}.{key}' is not a known field; check the spelling")
            continue
        kind, lo, hi = (spec + (None, None))[:3]
        ok = {
            "bool": isinstance(value, bool),
            "text": is_text(value),
            "int": isinstance(value, int) and not isinstance(value, bool),
            "number": is_number(value),
        }[kind]
        if not ok:
            issues.error(path, rule, f"'{label}.{key}' must be {'true or false' if kind == 'bool' else kind}")
        elif kind in ("int", "number") and ((lo is not None and value < lo) or (hi is not None and value > hi)):
            issues.error(path, rule, f"'{label}.{key}' {value} is out of range")


def check_openbenchmarker_entry(path, entry, label, issues):
    """Run details, score and diagnostics written by Open GPU Benchmarker."""
    for key, spec in RUN_DETAIL_FIELDS.items():
        if key in entry:
            check_typed(path, issues, "result-run-details", label, {key: spec}, {key: entry[key]})
    if entry.get("timing_method") is not None and entry["timing_method"] not in TIMING_METHODS:
        issues.error(path, "result-run-details", f"{label} timing_method must be one of {', '.join(TIMING_METHODS)}")
    if "rendered_with" in entry:
        check_typed(path, issues, "result-run-details", f"{label}.rendered_with", RENDERED_WITH_FIELDS, entry["rendered_with"])
    diag = entry.get("diagnostics")
    if diag is not None:
        check_typed(path, issues, "result-diagnostics", f"{label}.diagnostics", {**DIAGNOSTICS_FIELDS, "limit": ("text",)}, diag)
        if isinstance(diag, dict):
            if diag.get("limit") not in LIMITS:
                issues.error(path, "result-diagnostics", f"{label}.diagnostics.limit must be one of {', '.join(LIMITS)}")
            if diag.get("limit") == "software":
                issues.error(path, "result-diagnostics", f"{label} was rendered in software (no GPU); it can't be submitted")

    test, score = entry.get("score_test"), entry.get("score")
    if test is None and score is None:
        return
    if test not in SCORE_TESTS:
        issues.error(path, "result-score", f"{label} score_test must be one of {', '.join(SCORE_TESTS)} and comes with score")
        return
    if score is None:
        issues.error(path, "result-score", f"{label} has score_test but no score")
        return
    preset, resolution, duration = SCORE_TESTS[test]
    if (entry.get("graphics_preset"), entry.get("resolution"), entry.get("duration")) != (preset, resolution, duration):
        issues.error(path, "result-score", f"{label} score_test {test} requires {preset}, {resolution}, {duration} s")
    # avg_fps is rounded to 0.1 in the YAML; the score was computed from the unrounded value.
    if is_number(entry.get("avg_fps")) and abs(score - entry["avg_fps"] * SCORE_PER_FPS) > SCORE_PER_FPS * 0.05 + 0.5:
        issues.error(path, "result-score", f"{label} score {score} doesn't match avg_fps {entry['avg_fps']}")
```

Call it from `check_result_file`, inside the entry loop, only for this tool's game:

```python
        if run.get("game_id") == OPENBENCHMARKER_GAME_ID:
            check_openbenchmarker_entry(path, entry, label, issues)
        elif entry.get("score_test") is not None or entry.get("diagnostics") is not None:
            issues.error(path, "result-score", f"{label} score_test/diagnostics are only for {OPENBENCHMARKER_GAME_ID}")
```

Add top-level checks (in `check_result_file`, after `check_result_date`):

```python
    if "overclocked" in run and not isinstance(run["overclocked"], bool):
        issues.error(path, "result-overclocked", "overclocked must be true or false")
    if "detected" in run:
        check_typed(path, issues, "result-detected", "detected", DETECTED_FIELDS, run["detected"])
```

## 2. Outlier check: skip CPU-limited and overclocked runs

`check_outliers` fails a community run whose `avg_fps` is more than 25% from the official
baseline. That's wrong for two kinds of run this tool produces:

- **CPU-limited runs** (`diagnostics.limit` of `cpu`, `driver` or `mixed`), and Score: Entry in
  general. Their FPS depends on the CPU, so the same GPU legitimately varies far more than 25%.
- **Overclocked runs** (`overclocked: true`). These are the point of a 3DMark-style leaderboard.

Suggested change in `check_outliers`:

```python
            diag = entry.get("diagnostics") if isinstance(entry.get("diagnostics"), dict) else {}
            if run.get("overclocked") is True or diag.get("limit") in ("cpu", "driver", "mixed"):
                issues.info(path, "result-outlier-skipped", f"result[{index}] is overclocked or CPU-limited; outlier check skipped")
                continue
```

## 3. Proof method (optional, recommended)

The tool uses `proof.method: other`, and the template says to name the tool in the pull request.
The tool times every frame and always reports a 1% low, so add a dedicated method:

```python
P1_LOW_METHODS = (..., "openbenchmarker")
```

Then change `PROOF_METHOD` in this repo's `src/benchmark/validate.ts` to `"openbenchmarker"`.
Ship the upstream change first, because `other` → `openbenchmarker` would fail older upstream
checks.

## 4. Templates and docs

- Add `templates/community_openbenchmarker.yaml` with the example above. Note that the file is
  produced by the tool and shouldn't be edited by hand.
- In `docs/COMMUNITY_SUBMISSIONS.md`, add headings for the new rules: `result-run-details`,
  `result-diagnostics`, `result-score`, `result-detected`, `result-overclocked` and
  `result-outlier-skipped`. `checks.py` links each rule to a heading.
- Note in the docs that `detected:` values come from the browser and are never the source of
  `gpu_id` or `system:` fields.

## 5. Site and aggregation (when ready)

- Chart score runs separately per `score_test` and per tool `version`, never mixed with custom
  runs.
- Show `diagnostics.limit` next to each run. Consider charting only `limit: gpu` runs by default
  for GPU comparisons, with CPU-limited runs behind a toggle.
- Show `overclocked: true` runs with a badge, and keep them out of stock averages.
