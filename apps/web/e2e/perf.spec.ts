import { expect, test } from '@playwright/test';

import { CONTROL, openLive, resetSimulator, seedHistory, setSoil } from './helpers.ts';

// Frame rate on this computer's real GPU (the other tests use software WebGL,
// far too slow to say anything about performance). Run with `pnpm perf`.
// A phone is the real target: open the app with ?stats to see its frame rate.
test.use({
  launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] },
});

// With the HUD open too (D72): the plant sheet and the floating panels are
// opaque surfaces with static shadows over the canvas.
// Rewinding (A5): the scrubber moves every frame across a week of history
// while the twin follows; it must not cost frames (no React render per step).
const CASES = [
  'scene',
  'plant sheet open',
  'several warnings',
  'history chart open',
  'rewind scrubbing',
] as const;

for (const hud of CASES) {
  test(`frame rate on the GPU (${hud})`, async ({ page, request }) => {
    // Alone, or the other workers' browsers would share the GPU and the CPU.
    test.skip(test.info().config.workers > 1, 'runs alone: pnpm perf');
    await resetSimulator(request);
    if (hud === 'several warnings') {
      // Markers follow the plants every frame (A2): three thirsty, one without data.
      for (const zone of ['basil_01', 'lettuce_01', 'strawberry_01']) {
        await setSoil(request, zone, 0.1);
      }
      await request.post(`${CONTROL}/scenario`, {
        data: { scenario: 'sensor_failure', active: true, sensor: 'soil', zone: 'chives_01' },
      });
    }
    if (hud === 'history chart open' || hud === 'rewind scrubbing') await seedHistory(request);
    await openLive(page, hud === 'several warnings' ? '?theme=day&zoom=2.6' : '?theme=day');
    if (hud === 'plant sheet open' || hud === 'history chart open') {
      await page.getByRole('button', { name: 'Regar', exact: true }).click();
      await page.locator('.menu-row[data-zone="basil_01"]').click();
    }
    if (hud === 'history chart open') {
      await page.locator('.history-chart').scrollIntoViewIfNeeded();
    }
    if (hud === 'rewind scrubbing') {
      await page.getByRole('button', { name: 'Rebobinar' }).click();
      await page.getByRole('radio', { name: '7 días' }).click();
      await page
        .locator('.timeline-note')
        .filter({ hasNotText: 'Cargando' })
        .waitFor({ timeout: 20_000 });
    }
    await page.waitForTimeout(1500);
    const result = await page.evaluate(
      () =>
        new Promise<{ fps: number; worst: number; renderer: string }>((resolve) => {
          const gl = document.createElement('canvas').getContext('webgl2');
          const debug = gl?.getExtension('WEBGL_debug_renderer_info');
          const renderer = debug ? String(gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '?';
          const times: number[] = [];
          let last = performance.now();
          const start = last;
          // While rewinding, the thumb sweeps the week back and forth, one
          // input event per frame, as a finger would.
          const scrubber = document.querySelector<HTMLInputElement>('.timeline-input');
          const step = (now: number) => {
            times.push(now - last);
            last = now;
            if (scrubber) {
              const min = Number(scrubber.min);
              const max = Number(scrubber.max);
              const phase = ((now - start) / 2500) % 2;
              const t = phase < 1 ? phase : 2 - phase;
              scrubber.value = String(Math.round(min + (max - min) * t));
              scrubber.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (now - start < 5000) requestAnimationFrame(step);
            else {
              times.sort((a, b) => a - b);
              resolve({
                fps: (times.length / (now - start)) * 1000,
                worst: times[Math.floor(times.length * 0.95)] ?? 0,
                renderer,
              });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    const html = page.locator('html');
    const summary =
      `${result.fps.toFixed(1)} fps · 95th percentile ${result.worst.toFixed(1)} ms · ` +
      `${String(await html.getAttribute('data-draw-calls'))} draw calls · ` +
      `${String(await html.getAttribute('data-triangles'))} triangles · ${hud} · ${result.renderer}`;
    test.info().annotations.push({ type: 'perf', description: summary });
    console.info(`PERF ${summary}`);
    expect(result.fps).toBeGreaterThan(0);
  });
}
