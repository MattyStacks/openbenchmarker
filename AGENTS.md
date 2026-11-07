# Repository agent instructions

Read `CLAUDE.md`. For Neon stutter / GPU utilization work, read
`docs/plans/neon-stutter/STATUS.md` and `PLAN.md` first.

This branch preserves the user-selected local partial improvement. It is not a
completed fix. At close, a newer separate 3.0.2 checkpoint was discovered on
`origin/perf/neon-cpu-overhead` at `2607a6f`. Read its `docs/plans/neon-pacing/`
handoff too before resuming. Do not overwrite either checkpoint or assume the
measurements here tested that other version. Low settings/resolutions remain the
primary acceptance target; high GPU utilization and smooth motion are both needed.
