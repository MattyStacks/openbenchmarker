/** Align previews to actual display callbacks, at an integer divisor of refresh. */
export class PreviewCadence {
  tick = 0;
  intervalMs = 1000 / 60;
  divisor = 1;
  delayTicks = 4;
  private last = 0;
  private tunedAt = 0;
  private presentationDivisor = 1;
  private intervals: number[] = [];
  advance(now: number, renderFps: number, warming: boolean): { request: boolean; reset: boolean } {
    // Missing a callback must not stretch every queued presentation deadline.
    const previousTick = this.tick;
    this.tick += this.last ? Math.max(1, Math.round((now - this.last) / this.intervalMs)) : 1;
    if (this.last && now > this.last) {
      this.intervals.push(now - this.last);
      if (this.intervals.length > 60) this.intervals.shift();
    }
    this.last = now;
    let reset = false;
    if (this.intervals.length >= 20 && now - this.tunedAt >= 500) {
      this.tunedAt = now;
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const interval = sorted[Math.floor(sorted.length * .2)];
      const refreshChanged = Math.abs(interval / this.intervalMs - 1) > 0.1;
      const typical = sorted.slice(0, Math.ceil(sorted.length * .9));
      const callbackInterval = typical.reduce((sum, ms) => sum + ms, 0) / typical.length;
      const overloaded = sorted.length >= 60 && callbackInterval > interval / .85;
      if (warming || refreshChanged || overloaded) {
        const renderDivisor = renderFps > 0 ? Math.max(1, Math.ceil(1000 / interval / (renderFps * .9) - 1e-6)) : 1;
        if (refreshChanged) this.presentationDivisor = 1;
        // Ignore isolated startup stalls. Once presentation overload is sustained,
        // retain a sustainable cadence rather than immediately overloading it again.
        if (overloaded) {
          this.presentationDivisor = Math.max(this.presentationDivisor, Math.ceil(callbackInterval / interval / 1.05));
        }
        const divisor = Math.max(renderDivisor, this.presentationDivisor);
        // Leave time for two queued GPU batches and the requested frame even on
        // GPUs slower than one refresh. This changes only preview latency/cadence.
        const delayMs = Math.max(50, renderFps > 0 ? 3000 / renderFps : 50);
        const delayTicks = Math.max(divisor, Math.ceil(delayMs / interval / divisor - 1e-6) * divisor);
        reset = divisor !== this.divisor || delayTicks !== this.delayTicks;
        this.divisor = divisor; this.delayTicks = delayTicks; this.intervalMs = interval;
      }
    }
    // Request once when crossing a display slot, even if its callback was missed.
    return { request: Math.floor(this.tick / this.divisor) > Math.floor(previousTick / this.divisor), reset };
  }
}
