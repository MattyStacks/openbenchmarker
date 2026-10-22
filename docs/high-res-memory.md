# High-resolution memory on phones

Date: 2026-10-22, benchmark 2.2.0, three.js 0.186.1. This page estimates the GPU memory that grows with the render size. It explains why some phones close the page at 1440p and 4K. Nothing here changes the measured workload.

## What was seen

On the first phone tested, every preset at 720p and 1080p finished, Extreme included. At 1440p, Low, Medium and High finished, and Ultra and Extreme crashed the browser. 4K is heavier still. The page simply reloads. An OS memory kill can't be caught in JavaScript.

## How the buffers add up

These buffers scale with the render size (bytes per pixel, from three.js r186 allocation code):

| Buffer | Format | Bytes / pixel |
|---|---|---|
| Canvas drawing buffer + depth + compositor copies | RGBA8, depth 24 | ~16 |
| Composer target ×2 (ping-pong; the second is a `clone()`, so MSAA too) | RGBA16F, MSAA S: color 8·S + depth 4·S, plus resolve color 8 + depth 4 | 2 × (12·S + 12) |
| Bloom chain (bright + 5 mips × 2 blur targets, from half size down) | RGBA16F, no depth | ~7.3 |
| Reflector (Ultra, Extreme: `reflections: 1`, full size) | RGBA16F, MSAA S | 12·S + 12 |
| Shadow map (fixed size, not per pixel) | RGBA8 + depth 32, `shadowMap²` | 8 per texel |

Notes:
- Every preset asks for 8× MSAA, but three.js clamps that to the GPU's `MAX_SAMPLES`. That's 4 on most phone and iPad GPUs, and 8 on desktop GPUs. Where the browser exposes `WEBGL_multisampled_render_to_texture`, three.js keeps MSAA in tile memory, so the real cost there is lower.
- Extreme's 8192 shadow map is capped at `MAX_TEXTURE_SIZE`. It's 512 MB at 8192 and 128 MB at 4096. It doesn't scale with resolution, and 1080p Extreme finished, so it isn't what tips 1440p over.
- These numbers are estimates, not measurements. Drivers add padding, and some browsers keep an extra canvas copy.

## Estimates (MB, render-size buffers only, no shadow map)

| Resolution | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|
| **Phone (4× MSAA)** | | | | | |
| 720p | 42 | 126 | 126 | 179 | 179 |
| 1080p | 94 | 283 | 283 | 402 | 402 |
| 1440p | 166 | **504** | **504** | **715** ✗ | **715** ✗ |
| 4K | 374 | **1134** | **1134** | **1609** | **1609** |
| **Desktop (8× MSAA)** | | | | | |
| 1440p | 166 | 841 | 841 | 1221 | 1221 |
| 4K | 374 | 1893 | 1893 | 2747 | 2747 |

✗ = crashed on the first phone tested. The line falls between about 0.5 GB (1440p High finished) and 0.7 GB (1440p Ultra didn't). Ultra is the first preset with the full-size reflector. On top of this table, add the shadow map (8–512 MB depending on the preset and the GPU limit) and the scene's geometry and textures. Those are the same at every resolution.

The phone confirmation (`isMemoryHeavy` in `src/app/run-guard.ts`) follows this line: 1440p at Ultra or Extreme, and 4K at Medium and above. It's one phone's data, so it's a hint, never a block.

## Savings that don't change what's rendered or measured

- **Free the context when a run can't start.** Done in this change: if building the scene fails, the renderer is disposed and its context released before the error shows.
- **Free the context when a run ends.** This was already in place: `cleanup()` in `src/app/run.ts` disposes the scene, render targets and renderer, forces context loss and removes the canvas before the results page shows. That covers finish, invalid, abort and context loss.
- **Nothing else is worth taking at the crashing combos.** The canvas depth buffer goes unused while the composer draws everything, but the plain-render fallback needs it, and it's only ~4 B/px (15 MB at 1440p). Dropping CPU-side copies of static geometry after upload would save the same amount at every resolution, so it wouldn't move the 1440p line.

## Version-bump proposals (not implemented)

Each of these changes either the GPU work or the image, so each would need a benchmark version bump and fresh baselines. They are listed for a separate decision.

1. **No MSAA on the composer's second buffer, for presets with volumetrics (High, Ultra, Extreme).** With volumetrics on, each frame does an even number of buffer swaps (volumetric, sanitize, grade, output), so the scene always renders into the first buffer. The second only ever gets full-screen post passes, where MSAA adds no detail. Saves 12·S B/px: about 169 MB at 1440p and 380 MB at 4K on phones. Low and Medium make an odd number of swaps, so the scene alternates between the buffers and this doesn't apply. It removes an MSAA resolve per post pass, which changes GPU time, so it needs a bump.
2. **Half-size reflector on Ultra and Extreme (`reflections: 0.5`).** That's a quarter of the reflector memory: 1440p Ultra on phones drops from about 715 MB to about 557 MB. The reflections would look softer.
3. **Cap MSAA at 4× everywhere.** This only helps desktops (phones are already at 4) and changes desktop image quality and timing. It's listed for completeness, but isn't recommended for the phone problem.
