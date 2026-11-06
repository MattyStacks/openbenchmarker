/** Align previews to actual display callbacks, at an integer divisor of refresh. */
export class PreviewCadence {
  tick = 0;
  intervalMs = 1000 / 60;
  divisor = 1;
  delayTicks = 4;
  private last = 0;
  private tunedAt = 0;
  private intervals: number[] = [];
  advance(now: number, renderFps: number, warming: boolean): { request: boolean; reset: boolean } {
    this.tick++;
    if (this.last && now > this.last) {
      this.intervals.push(now - this.last);
      if (this.intervals.length > 60) this.intervals.shift();
    }
    this.last = now;
    let reset = false;
    if (this.intervals.length >= 20 && now - this.tunedAt >= 500) {
      this.tunedAt = now;
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const interval = sorted[Math.floor(sorted.length / 2)];
      const refreshChanged = Math.abs(interval / this.intervalMs - 1) > 0.1;
      if (warming || refreshChanged) {
        const divisor = renderFps > 0 ? Math.max(1, Math.ceil(1000 / interval / (renderFps * .9) - 1e-6)) : 1;
        // Leave time for two queued GPU batches and the requested frame even on
        // GPUs slower than one refresh. This changes only preview latency/cadence.
        const delayMs = Math.max(50, renderFps > 0 ? 3000 / renderFps : 50);
        const delayTicks = Math.max(divisor, Math.ceil(delayMs / interval / divisor - 1e-6) * divisor);
        reset = divisor !== this.divisor || delayTicks !== this.delayTicks;
        this.divisor = divisor; this.delayTicks = delayTicks; this.intervalMs = interval;
      }
    }
    return { request: this.tick % this.divisor === 0, reset };
  }
}
