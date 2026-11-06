import { test, expect } from './fixtures';
// Opt in on a configured accelerated browser; software rendering cannot run this workload promptly.
test.skip(process.env.BENCH_GPU_TESTS !== '1', 'Requires an explicitly configured real GPU');
for (const action of ['abort', 'resize', 'visibility'] as const) {
  test(`worker rendering invalidates on ${action} and returns to setup`, async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');
    await page.locator('#config').evaluate(form => {
      for (const [name, value] of Object.entries({ preset: 'Low', resolution: '720p', duration: '30' })) {
        const input = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
        input.checked = true;
      }
      (form as HTMLFormElement).requestSubmit();
    });
    await expect(page.locator('#hud-phase')).toContainText('TIMED', { timeout: 60000 });
    if (action === 'abort') await page.locator('#abort').click();
    else if (action === 'visibility') await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    else await page.setViewportSize({ width: 1100, height: 700 });
    await expect(page).toHaveURL(/#\/result\//, { timeout: 10000 });
    const result = await page.evaluate(() => JSON.parse(localStorage.getItem('ogb.results.v1')!)[0]);
    expect(result.valid).toBe(false);
    expect(result.diag.renderThread).toBe('worker');
    expect(result.invalidReason).toMatch(action === 'abort' ? /Aborted/ : action === 'resize' ? /resized/ : /Tab hidden/);
    await page.goto('/');
    await expect(page.locator('#config')).toBeVisible();
  });
}

for (const preset of ['Medium', 'High', 'Ultra', 'Extreme']) {
  test(`${preset} renders the fixed workload through the worker`, async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');
    await page.locator('#config').evaluate((form, preset) => {
      for (const [name, value] of Object.entries({ preset, resolution: '720p', duration: '30' })) {
        form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.checked = true;
      }
      (form as HTMLFormElement).requestSubmit();
    }, preset);
    await expect(page.locator('#hud-phase')).toContainText('TIMED', { timeout: 60000 });
    const imageLength = await page.locator('.bench-canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length);
    expect(imageLength).toBeGreaterThan(20000);
    const layout = await page.evaluate(() => ({ height: innerHeight, abort: document.querySelector('#abort')!.getBoundingClientRect().bottom, graph: document.querySelector('#hud-graph')!.getBoundingClientRect().bottom }));
    expect(layout.abort).toBeLessThanOrEqual(layout.height);
    expect(layout.graph).toBeLessThanOrEqual(layout.height);
    await page.locator('#abort').click();
    await expect(page).toHaveURL(/#\/result\//, { timeout: 10000 });
    const result = await page.evaluate(() => JSON.parse(localStorage.getItem('ogb.results.v1')!)[0]);
    expect(result.diag.renderThread).toBe('worker');
    expect(result.diag.features.volumetrics).toBe(64);
    expect(result.diag.features.fallbackReason).toBe('');
  });
}
