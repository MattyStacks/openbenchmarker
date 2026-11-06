/**
 * Fence notification intervals are not individual GPU execution times: a driver can
 * report several fences together, then another almost immediately. Feeding each
 * interval back into batch size creates oscillation and excessive queued work.
 */
export class BatchSizer {
  private wallMs = 0;
  private frames = 0;
  private frameMs = 0;
  constructor(private readonly targetGpuMs: number) {}
  observe(frames: number, wallMs: number, gpuFrameMs: number | null): number {
    if (frames > 0 && wallMs >= 0 && Number.isFinite(wallMs)) {
      this.frames += frames; this.wallMs += wallMs;
      // Without timers, average notifications over a window, not one fence event.
      if (this.wallMs >= 100) {
        this.frameMs = this.wallMs / this.frames;
        this.frames = 0; this.wallMs = 0;
      }
    }
    const ms = gpuFrameMs !== null && Number.isFinite(gpuFrameMs) && gpuFrameMs > 0 ? gpuFrameMs : this.frameMs;
    return ms > 0 ? Math.max(1, Math.min(256, Math.round(this.targetGpuMs / ms))) : 1;
  }
}
