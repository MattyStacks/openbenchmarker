// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareRenderWorker } from '../src/app/render-worker-client';
import { getPreset } from '../src/benchmark/presets';
import type { WorkerSettings } from '../src/engine/render-worker-protocol';
const settings: WorkerSettings = { preset: getPreset('Low')!, width: 1280, height: 720, duration: 30, lapCount: 0, cpuBatchMs: 8, gpuBatchMs: 16, inFlight: 3, leadMs: 4, leadMaxFrameMs: 14, spinMs: 3, timers: true };
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
}
function setup() {
  vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('OffscreenCanvas', class {});
  document.body.innerHTML = '<button id="abort">Abort</button>';
  const output = { transferFromImageBitmap: vi.fn() };
  const canvas = { getContext: () => output } as unknown as HTMLCanvasElement;
  return { canvas, output };
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
describe('render worker setup', () => {
  it('transfers the canvas once and resolves only after renderer readiness', async () => {
    const { canvas, output } = setup(); const pending = prepareRenderWorker(canvas, settings);
    const worker = FakeWorker.latest;
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message).toMatchObject({ type: 'init', settings });
    expect(transfer).toEqual([message.canvas]);
    worker.onmessage!({ data: { type: 'ready', renderer: 'GPU', vendor: 'Vendor', maxTextureSize: 8192, features: {} } });
    const ready = await pending;
    expect(ready?.worker).toBe(worker);
    const image = {} as ImageBitmap; ready!.present(image);
    expect(output.transferFromImageBitmap).toHaveBeenCalledWith(image);
    document.querySelector<HTMLButtonElement>('#abort')!.click();
    expect(worker.terminate).not.toHaveBeenCalled();
  });
  it('cancels initialization and releases the worker when Abort is clicked', async () => {
    const { canvas } = setup(); const pending = prepareRenderWorker(canvas, settings);
    const rejected = expect(pending).rejects.toThrow('Aborted by user');
    document.querySelector<HTMLButtonElement>('#abort')!.click(); await rejected;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('reports initialization failure and terminates the failed worker', async () => {
    const { canvas } = setup(); const pending = prepareRenderWorker(canvas, settings);
    const rejected = expect(pending).rejects.toThrow('no WebGL2');
    FakeWorker.latest.onmessage!({ data: { type: 'error', reason: 'no WebGL2' } }); await rejected;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('uses the main-thread path when bitmap presentation is unavailable', async () => {
    expect(await prepareRenderWorker({} as HTMLCanvasElement, settings)).toBeNull();
  });
});
