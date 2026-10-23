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
| `sessionStorage` | One key, `ogb.challenge.v1` (`src/app/challenge.ts`): the share code of a run you chose to compare with ("Set up the same test"), kept in this tab only so it survives a reload or crash. Cleared when the comparison is shown on your result, or on "Stop comparing". |
| IndexedDB / Cache Storage | Not used anywhere in source or `dist/`. |
| `localStorage` | `src/app/store.ts`, `src/app/run-guard.ts` and `src/app/history-view.ts`, five keys (below). |
| Clipboard / Web Share | Only on explicit taps: copy YAML / lookup commands (`src/app/results-view.ts`), and Share / Copy link / Save image (`src/app/share.ts`). Share hands the link, text and card PNG to the system share sheet (`navigator.share`); where that's missing it copies the link and text to the clipboard. The site sends nothing itself. |
| Share links | `#/r/<payload>`: the whole result encoded (not encrypted) in the URL fragment (`src/benchmark/share-codec.ts`). Browsers never send the fragment in HTTP requests, so opening a link sends nothing about the result to the site. It is decoded and shown only in the recipient's browser. A link carries the measured numbers, settings, run date, browser + version, OS, device type and the GPU name as reported by the browser. It never carries the user-filled `system` fields, the diagnostics or the result id. Anyone with a link can read it. |
| Share card | Drawn on a 2D canvas in the browser (`renderCard`), QR code generated locally (`uqr`, bundled; no network). |
| `navigator.deviceMemory` | Read only to add a hint to the phone high-resolution confirmation (Chromium only). Never stored. |
| Browser APIs read for diagnostics/device | `navigator.userAgent` / `userAgentData` (including `getHighEntropyValues(["platform","brands"])`), `navigator.brave.isBrave()`, `navigator.hardwareConcurrency`, Battery Status API (Chromium), WebGL `WEBGL_debug_renderer_info`. All read locally, shown labelled as detected, never sent anywhere by the site. |

## Every storage use

| Key / API | File | What is stored | Leaves the browser? |
|---|---|---|---|
| `ogb.results.v1` (`localStorage`) | `src/app/store.ts` | Saved `BenchResult[]` (measured result, user-filled `system`, `diag`, the separate `device` field, and on compared runs a `challenge` field holding the compared-with run's share code; it's stripped from JSON export and never submitted) | Only when the user exports JSON/CSV, downloads/copies YAML, or opens the GitHub submission form |
| `ogb.config.v1` (`localStorage`) | `src/app/store.ts` | Last-used run config (resolution, preset, duration) | Never |
| `ogb.challenge.v1` (`sessionStorage`) | `src/app/challenge.ts` | Pending comparison (share code) for this tab | Never |
| `ogb.historyView.v1` (`localStorage`) | `src/app/history-view.ts` | My Results display preference, `cards` or `table` | Never |
| `ogb.runInProgress.v1` (`localStorage`) | `src/app/run-guard.ts` | The run currently in progress (resolution, preset, duration, start time, phase). Written before a run and removed when it ends in any way. If it's still there on the next load, the OS closed the page mid-run | Never |
| `ogb.unfinished.v1` (`localStorage`) | `src/app/run-guard.ts` | Resolution/preset combos that didn't finish on this device (count, last time, phase), used for the "Didn't finish on this device last time" hint. A combo is removed once a run at it finishes | Never |

Clearing site data deletes all of them. In My Results, "Clear my saved results" removes `ogb.results.v1` and `ogb.unfinished.v1`; the run config stays. My Results filters and sort live in memory only (nothing stored). There is no server copy to delete.

## Hosting

Static assets only (`wrangler.toml` has no `main`, no bindings). Previews (`npm run preview:deploy`) serve the same build on `share-results.opengpubenchmarker.com` and `*.mattys.workers.dev`, marked `noindex`; each is its own origin with its own localStorage.

## Built output checked

`npm run build` produces `dist/index.html` plus one hashed JS and one CSS asset under `dist/assets/`, with `public/` files copied verbatim. Grepping `dist/` found: `localStorage` present (the uses above), no `sessionStorage`/IndexedDB/`document.cookie`/`sendBeacon`, and no external asset loads (external strings are links/metadata only).

## How to re-check

```sh
grep -rn "localStorage\|sessionStorage\|indexedDB\|document.cookie\|sendBeacon\|fetch(\|WebSocket" src/ index.html
npm run build
grep -o "indexedDB\|document.cookie\|sendBeacon" dist/assets/*.js   # sessionStorage: only ogb.challenge.v1
grep -rn "@font-face\|fonts.googleapis" src/ index.html dist/assets/*.css
```
