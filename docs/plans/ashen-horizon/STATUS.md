# Ashen Horizon: status and shared memory

This file and `notes/` are the project's memory. They're in git so every PC sees the same thing.
Read this at the start of every session and update it at the end. Don't keep Ashen Horizon
knowledge only in a machine's local Claude memory (see README "Notes, memory and branches").

## Where we are

- **Last updated:** 2026-10-26
- **Done:** none
- **In progress:** none
- **Next:** [P01 Golden safety net](P01-golden-safety-net.md), branch `feature/p01-golden-safety-net`

The plan index in `README.md` marks plans done too. Keep the two in sync.

## Resuming on any PC

1. `git checkout main && git pull`, then `git fetch && git branch -r`. Any unmerged
   `origin/feature/pNN-*` branch holds a plan in progress. Check it out; its notes are there.
2. Read `README.md`, this file, the plan file and its `notes/Pxx-*.md`.
3. If nothing is in progress, the next plan in index order is the pickup point. **P20 comes right
   after P14.**

"Read in the last plan", or anything like it, means: resume Ashen Horizon from here.

## Answered open questions

Move each answer here from the README's "Open questions" table when Matt decides it.

| Question | Answer | Date | Decided in |
|---|---|---|---|
| — | — | — | — |

## Known tooling gaps

Not acted on yet. Deal with each in the plan that needs it, then remove it here.

- P01: the QR test may need a QR decoder dev dependency (e.g. `jsqr`).
- P10: precise WebGPU timing may need a Chromium flag that turns off timestamp quantization. Verify
  the flag then.
- PM01: needs glTF/KTX2 tools, some of them native.
- P04, P05, P06, P07, P14, P22 and P23 lack the "Branch / Preview" header line the other plans have.
  Add it when each plan starts.

## Test machines

How each machine runs WebGL and WebGPU tests: [notes/test-machines.md](notes/test-machines.md).
Matt plans to do the implementation on the WSL laptop (RTX 5090 Laptop GPU).

## History

- 2026-10-25: plans P01–P24, PM01, the model set template and the storyboard committed to `main`
  (`e1066f7`). The test tooling was set up beforehand (`741449b`).
- 2026-10-26: moved Ashen Horizon memory and notes into this folder, so they're available on every PC.
