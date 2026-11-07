# Repository agent instructions

Read `CLAUDE.md` for shared project instructions and portable-configuration rules.

The active Neon Flythrough utilization/pacing investigation is on
`perf/neon-cpu-overhead`. Before resuming it, read:
- `docs/plans/neon-pacing/STATUS.md`
- `docs/plans/neon-pacing/PLAN.md`

Version 3.0.1 regressed on the affected NVIDIA system. The 3.0.2 checkpoint is an
undeployed candidate, not a confirmed fix. Resume validation on that system before
publishing another claimed solution. Keep findings and handoff state in git.
