# Notes for Claude

## Ashen Horizon

The Ashen Horizon benchmark's plans, progress, decisions and working notes all live in
`docs/plans/ashen-horizon/`, in git, so every PC sees the same state.

- Start with `docs/plans/ashen-horizon/README.md` (rules and plan index) and `STATUS.md` (where the
  work is and how to resume).
- "Read in the last plan", or anything like it, means: resume Ashen Horizon at the point
  `STATUS.md` gives.
- Store Ashen plans, decisions, findings and progress in that folder, as its README's "Notes,
  memory and branches" section describes. Don't store them in local auto-memory.
- Every deliverable gets a new branch from the latest `main`. Push it so the work isn't on one
  machine only.

## Deploy a preview for review

After finishing a change to the site on a branch, once `npm test` and `npm run build` pass, deploy
a preview without being asked: `npm run preview:deploy -- <branch-name>` (README, "Testing on a
phone (LAN) and preview deploys"). Give Matt both preview links,
`https://<branch-name>.opengpubenchmarker.com` and
`https://<branch-name>-openbenchmarker.mattys.workers.dev`, and say what to test there. Redeploy
the same name after later changes on that branch. Docs-only or test-only changes don't need one.

## Keep repo config portable

Matt works on more than one PC and may switch OS. Don't commit anything that only works on one
machine: GPU env vars or launch flags, absolute paths, distro-specific commands. Machine setup goes
in that machine's environment, an untracked local file, or an opt-in switch that defaults off.
Documenting a machine's setup in `docs/` is fine. Cross-platform npm devDependencies are fine. Ask
before adding anything that might be platform-specific.
