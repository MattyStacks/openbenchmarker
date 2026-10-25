# P09: WebGPU bootstrap and capability gate

**Track:** Ashen foundation · **Depends on:** P08 · **Visitors see:** optionally, a "WebGPU
requirements" section on About · **Ashen version:** 0.2.0

## Goal
Ashen Horizon starts a `WebGPURenderer` in its own lazy-loaded chunk, shows a placeholder scene, and
handles browsers without WebGPU gracefully.

## Read first
- `src/app/run.ts`
- `src/benchmark/sysinfo.ts`
- `src/app/env.ts`
- `src/app/run-guard.ts`
- `vite.config` (if present) / `package.json`
- three r186 `three/webgpu` docs (`WebGPURenderer`, `init()`, `compileAsync`)
- the storyboard's "Platform Support" panel
- README "Decisions already made" (the platform list)

## Scope
- **Lazy chunk:**
  - Ashen's definition is a small stub in the main bundle
  - its renderer and scene (including `three/webgpu`) load with a dynamic `import()` when the visitor
    opens it
  - record Neon's main bundle size before and after, in the PR and in this folder's README, and make
    sure it doesn't grow beyond the stub
- **`createRenderer`:**
  - `WebGPURenderer`, `await renderer.init()`, high-performance adapter
  - pixel ratio 1, exact render size as Neon
  - **never** the WebGL2 backend fallback
- **Capability gate (always on):**
  - checks `navigator.gpu`, the adapter, the required limits and features (e.g. `timestamp-query`
    optional; storage buffer and compute limits Ashen needs)
  - on failure, show the storyboard's **"WebGPU Required"** card: why it failed, "Run Neon Flythrough
    instead", "View WebGPU requirements"
  - the failure reason is logged to the console only and never saved as a result
- **WebGPU requirements** section `#/about/webgpu`: the corrected platform list from the README
  (NVIDIA on Linux needs Wayland; other Linux setups need flags; Firefox on Linux is Nightly only).
  Ask Matt whether it goes public now or with P14.
- **GPU identification:** WebGPU `adapter.info` lacks the model name. Briefly create a throwaway
  WebGL context to read `WEBGL_debug_renderer_info`, then release it. `sysinfo.ts` prefill behaviour
  is unchanged.
- **Device loss:** `device.lost` → the run is invalid with a clear message, mirroring WebGL context
  loss in `run-guard.ts`.
- **Placeholder scene:** grey terrain, an instanced box field and a simple camera spline, enough to
  render and dispose cleanly.

## Out of scope
Timing accuracy (P10), real content.

## Acceptance
- With `?preview=ashen-horizon`:
  - Chrome on Windows and Safari on iOS 26 render the placeholder
  - a browser without WebGPU (or Firefox on Linux stable) shows the gate
- Neon is unaffected, and its bundle size is unchanged.
