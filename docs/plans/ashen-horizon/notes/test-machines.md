# Test machines

How each of Matt's machines runs the browser tests on a real GPU. This is documentation only. Per
the repo's portability rule, none of these flags, env vars or paths go into repo config; they live
in each machine's own environment. The repo side is `e2e/fixtures.ts` (`PW_CDP_URL`) plus
`PW_CHANNEL`/`PW_ARGS` in `playwright.config.ts`, all off by default.

## WSL laptop (Ubuntu 26.04 on WSL2, RTX 5090 Laptop GPU)

Verified 2026-10-25 with Playwright 1.63.0 / chromium-1243.

### WebGL in WSL Chromium

Playwright's default headless shell renders WebGL with SwiftShader (software, no
`EXT_disjoint_timer_query_webgl2`). To use the real GPU:

- launch with `channel: "chromium"` (full Chromium, new headless; the headless shell can't use the
  GPU)
- env: `GALLIUM_DRIVER=d3d12`, `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` (without these, Mesa falls
  back to llvmpipe)
- args: `--ignore-gpu-blocklist --enable-gpu --use-gl=angle --use-angle=gl`

Result: "ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 5090 Laptop GPU), OpenGL ES 3.1)",
with timer queries, about 22x faster than SwiftShader on a heavy 1080p shader. It works headless and
headed (WSLg). The numbers go through a GL→D3D12 translation layer, so they're fine for regression
checks but not comparable with native Windows results.

WSL Chromium has **no WebGPU**: there's no Vulkan route, because Ubuntu's `mesa-vulkan-drivers`
doesn't ship Mesa's dzn (Dozen) ICD.

### WebGPU (and native WebGL) via Windows Edge over CDP

Drive Windows Edge from WSL. Matt prefers Edge for WebGPU testing. Brave works the same way as a
fallback; Chrome isn't needed.

- WSL uses mirrored networking (`.wslconfig`), so Edge reaches a dev server on WSL's `localhost`.
- Launch `"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new
  --force-high-performance-gpu --remote-debugging-port=9333` with `--user-data-dir` under
  `%LOCALAPPDATA%\Temp`. Not `C:\Windows\Temp`, where files can't be deleted without admin.
- From WSL: `chromium.connectOverCDP("http://127.0.0.1:9333")`.
- The page must be a secure context, so serve it on `http://localhost` (`about:blank` has no
  `navigator.gpu`).
- Without `--force-high-performance-gpu` it picks the Intel iGPU (xe-lpg), even with
  `powerPreference: "high-performance"`.

Result: adapter nvidia/blackwell, `timestamp-query`, `maxTextureDimension2D` 16384, and WebGL native
on D3D11. Both have timer queries. This is native Dawn on D3D12, so its numbers are representative.

**Wrapper:** `~/.local/bin/edge-gpu-e2e [playwright args]`, outside the repo on purpose. It launches
headless Edge as above (profile `%LOCALAPPDATA%\Temp\edge-gpu-e2e-<pid>`, port `EDGE_CDP_PORT` or
9333), waits for the CDP port, then runs `PW_CDP_URL=http://127.0.0.1:9333 npx playwright test
--workers=1 "$@"` (one worker, so GPU timings don't share the GPU). When it exits, it kills that
Edge and deletes the profile. `EDGE_HEADED=1` shows the window. Use it for anything that needs real
WebGPU.

## Desktop

Not set up yet. Record its OS, GPU and test route here when it is.
