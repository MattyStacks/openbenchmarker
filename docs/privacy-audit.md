# Privacy audit

Date: 2026-10-22. Branch: `feature/share-results`. Scope: source (`src/`, `index.html`, `public/`) and built output (`dist/`, `npm run build`). Later copy (share text, About & FAQ) must stay accurate to this report; re-run the checks below when it changes.

Principle being audited: everything runs in the browser; the site stores nothing on a server (no database, KV, cookies, accounts or server code); nothing is shared or submitted unless the user explicitly shares, exports or submits it.

## Findings

| Area | Result |
|---|---|
| Cookies | None. No `document.cookie`, no `Set-Cookie` (static assets only; `public/_headers` sets no cookie headers). |
| Analytics / beacons / error reporting | None. No analytics, `sendBeacon`, Sentry or similar in source or `dist/`. |
| Network requests from app code | None. No `fetch(`, `XMLHttpRequest`, `WebSocket` or `EventSource` in `src/`. The only URLs in the bundle are hyperlinks, catalog metadata and licence/attribution strings (GitHub, opengpubenchmarks.com, threejs.org, schema.org, creativecommons.org); they load nothing unless clicked. |
| Web fonts / third-party assets | None. System fonts only (`src/style.css`: "System fonts only, no external assets"); no `@font-face`, Google Fonts or CDN assets. Three.js is bundled at build time. |
| `sessionStorage` / IndexedDB / Cache Storage | Not used anywhere in source or `dist/`. |
| `localStorage` | `src/app/store.ts` and `src/app/run-guard.ts`, four keys (below). |
| Clipboard / Web Share | Clipboard writes only on explicit button clicks (`src/app/results-view.ts` copy YAML / copy lookup commands, dev-only `src/app/lab.ts`). No `navigator.share` yet (Plan 3). |
| `navigator.deviceMemory` | Read only to add a hint to the phone high-resolution confirmation (Chromium only). Never stored. |
| Browser APIs read for diagnostics/device | `navigator.userAgent` / `userAgentData` (including `getHighEntropyValues(["platform","brands"])`), `navigator.brave.isBrave()`, `navigator.hardwareConcurrency`, Battery Status API (Chromium), WebGL `WEBGL_debug_renderer_info`. All read locally, shown labelled as detected, never sent anywhere by the site. |

## Every storage use

| Key / API | File | What is stored | Leaves the browser? |
|---|---|---|---|
| `ogb.results.v1` (`localStorage`) | `src/app/store.ts` | Saved `BenchResult[]` (measured result, user-filled `system`, `diag`, and from Plan 1 the separate `device` field) | Only when the user exports JSON/CSV, downloads/copies YAML, or opens the GitHub submission form |
| `ogb.config.v1` (`localStorage`) | `src/app/store.ts` | Last-used run config (resolution, preset, duration) | Never |
| `ogb.runInProgress.v1` (`localStorage`) | `src/app/run-guard.ts` | The run currently in progress (resolution, preset, duration, start time, phase). Written before a run and removed when it ends in any way. If it's still there on the next load, the OS closed the page mid-run | Never |
| `ogb.unfinished.v1` (`localStorage`) | `src/app/run-guard.ts` | Resolution/preset combos that didn't finish on this device (count, last time, phase), used for the "Didn't finish on this device last time" hint. A combo is removed once a run at it finishes | Never |

Clearing site data deletes all of them. There is no server copy to delete.

## Hosting

Static assets only (`wrangler.toml` has no `main`, no bindings). Previews (`npm run preview:deploy`) serve the same build on `share-results.opengpubenchmarker.com` and `*.mattys.workers.dev`, marked `noindex`; each is its own origin with its own localStorage.

## Built output checked

`npm run build` produces `dist/index.html` plus one hashed JS and one CSS asset under `dist/assets/`, with `public/` files copied verbatim. Grepping `dist/` found: `localStorage` present (the uses above), no `sessionStorage`/IndexedDB/`document.cookie`/`sendBeacon`, and no external asset loads (external strings are links/metadata only).

## How to re-check

```sh
grep -rn "localStorage\|sessionStorage\|indexedDB\|document.cookie\|sendBeacon\|fetch(\|WebSocket" src/ index.html
npm run build
grep -o "sessionStorage\|indexedDB\|document.cookie\|sendBeacon" dist/assets/*.js
grep -rn "@font-face\|fonts.googleapis" src/ index.html dist/assets/*.css
```
