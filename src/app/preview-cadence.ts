/** Align previews to display time, including refreshes whose callbacks were missed. */
export class PreviewCadence {
  tick = 0;
  intervalMs = 1000 / 60;
  divisor = 1;
  delayTicks = 4;
  private last = 0;
  private tunedAt = 0;
  private intervals: number[] = [];
  private delayedWindows = 0;
  private backedOff = false;
  private timedIntervals: number[] = [];
  private lastTimed = 0;
  advance(now: number, renderFps: number, warming: boolean): { request: boolean; reset: boolean } {
    const previousTick = this.tick;
    const elapsed = this.last ? now - this.last : this.intervalMs;
    // A 25 ms callback gap on a 120 Hz timeline skips three refreshes, not one.
    // Counting callbacks alone stretches the buffer and replays stale motion.
    this.tick += Math.max(1, Math.round(elapsed / this.intervalMs));
    if (this.last && elapsed > 0) {
      this.intervals.push(elapsed);
      if (this.intervals.length > 60) this.intervals.shift();
    }
    if (!warming) {
      if (this.lastTimed) this.timedIntervals.push(now - this.lastTimed);
      this.lastTimed = now;
    }
    this.last = now;
    let reset = false;
    if (this.intervals.length >= 20 && now - this.tunedAt >= 500) {
      this.tunedAt = now;
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const interval = sorted[Math.floor(sorted.length / 2)];
      const refreshChanged = Math.abs(interval / this.intervalMs - 1) > 0.1;
      if (refreshChanged) { this.backedOff = false; this.delayedWindows = 0; }
      const slots = this.intervals.reduce((n, dt) => n + Math.max(1, Math.round(dt / interval)), 0);
      const missedShare = (slots - this.intervals.length) / slots;
      this.delayedWindows = missedShare > .15 ? this.delayedWindows + 1 : 0;
      const backOff = !this.backedOff && this.delayedWindows >= 2;
      if (backOff) this.backedOff = true;
      if (warming || refreshChanged || backOff) {
        const base = renderFps > 0 ? Math.max(1, Math.ceil(1000 / interval / (renderFps * .9) - 1e-6)) : 1;
        // Render FPS alone cannot measure the compositor's capacity. After two
        // bad windows, lower preview traffic by one divisor and keep it stable.
        // Benchmark rendering and workload stay uncapped and unchanged.
        const divisor = base + (this.backedOff ? 1 : 0);
        const delayMs = Math.max(50, renderFps > 0 ? 4000 / renderFps : 50);
        const delayTicks = Math.max(divisor, Math.ceil(delayMs / interval / divisor - 1e-6) * divisor);
        reset = divisor !== this.divisor || delayTicks !== this.delayTicks;
        this.divisor = divisor; this.delayTicks = delayTicks; this.intervalMs = interval;
      }
    }
    // A callback may skip the exact requested slot; issue one current request,
    // never a burst of catch-up renders or wait for a later modulo match.
    return { request: Math.floor(this.tick / this.divisor) > Math.floor(previousTick / this.divisor), reset };
  }
  callbackStats(): { callbackFps: number; callbackP95Ms: number; callbackMaxMs: number } {
    const sorted = [...this.timedIntervals].sort((a, b) => a - b);
    const total = this.timedIntervals.reduce((n, dt) => n + dt, 0);
    return { callbackFps: total > 0 ? this.timedIntervals.length * 1000 / total : 0,
      callbackP95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, callbackMaxMs: sorted.at(-1) ?? 0 };
  }
}
