/** Small timestamped playout buffer. Timings measure canvas handoff, not monitor scanout. */
export class PresentationQueue<T extends { close(): void }> {
  private queue: { image: T; targetAt: number; targetTick: number }[] = [];
  private intervals: number[] = [];
  private lateness: number[] = [];
  private last = 0;
  private first = 0;
  private frames = 0;
  private dropped = 0;
  constructor(private readonly capacity = 32) {}
  push(image: T, targetAt: number, targetTick: number): void {
    this.queue.push({ image, targetAt, targetTick });
    while (this.queue.length > this.capacity) { this.queue.shift()!.image.close(); this.dropped++; }
  }
  take(tick: number, now: number, timed: boolean): T | null {
    let selected: { image: T; targetAt: number; targetTick: number } | undefined;
    // Targets come from ordered animation callbacks. Preserve future frames;
    // discard only obsolete frames when several deadlines were missed.
    while (this.queue.length && this.queue[0].targetTick <= tick) {
      if (selected) { selected.image.close(); if (timed) this.dropped++; }
      selected = this.queue.shift()!;
    }
    if (!selected) return null;
    if (timed) {
      if (this.last) this.intervals.push(now - this.last);
      else this.first = now;
      this.last = now; this.frames++;
      this.lateness.push(Math.max(0, now - selected.targetAt));
    }
    return selected.image;
  }
  stats(): { frames: number; fps: number; p95Ms: number; maxMs: number; lateP95Ms: number; dropped: number } {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const late = [...this.lateness].sort((a, b) => a - b);
    return { frames: this.frames, fps: this.last > this.first ? (this.frames - 1) * 1000 / (this.last - this.first) : 0,
      p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, maxMs: sorted.at(-1) ?? 0,
      lateP95Ms: late[Math.floor(late.length * .95)] ?? 0, dropped: this.dropped };
  }
  dispose(): void { for (const f of this.queue) f.image.close(); this.queue.length = 0; }
}
