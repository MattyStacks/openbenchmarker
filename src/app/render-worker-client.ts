import type { WorkerReady, WorkerSettings, WorkerOutput } from '../engine/render-worker-protocol';
export async function prepareRenderWorker(canvas: HTMLCanvasElement, settings: WorkerSettings): Promise<{ worker: Worker; meta: WorkerReady; present: (image: ImageBitmap) => void } | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  canvas.width = settings.width; canvas.height = settings.height;
  const output = canvas.getContext?.('bitmaprenderer');
  if (!output) return null;
  const worker = new Worker(new URL('../engine/render.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const button = document.querySelector('#abort');
    const cancel = () => fail('Aborted by user');
    const timeout = setTimeout(() => fail('Renderer worker initialization timed out'), 120000);
    const cleanup = () => { clearTimeout(timeout); button?.removeEventListener('click', cancel); worker.onerror = null; worker.onmessage = null; };
    const fail = (reason: string) => { cleanup(); worker.terminate(); reject(new Error(reason)); };
    button?.addEventListener('click', cancel);
    worker.onerror = e => fail(e.message || 'Renderer worker failed');
    worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
      if (e.data.type === 'error') fail(e.data.reason);
      else if (e.data.type === 'ready') { cleanup(); resolve({ worker, meta: e.data, present: image => output.transferFromImageBitmap(image) }); }
    };
    try { const offscreen = new OffscreenCanvas(settings.width, settings.height); worker.postMessage({ type: 'init', canvas: offscreen, settings }, [offscreen]); }
    catch (e) { fail(String(e)); }
  });
}
