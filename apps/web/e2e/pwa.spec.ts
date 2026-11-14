import { expect, test } from '@playwright/test';

interface Manifest {
  name: string;
  lang: string;
  display: string;
  icons: { sizes: string; purpose?: string }[];
}

test('is installable: manifest, icons and an active service worker', async ({ page }) => {
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = (await (await page.request.get(manifestHref ?? '')).json()) as Manifest;
  expect(manifest).toMatchObject({ name: 'Vitreo', lang: 'es', display: 'standalone' });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope).toBe('http://localhost:4173/');

  // Chrome's own verdict. Playwright contexts are always incognito, which
  // Chrome reports on its own; anything else would be a real problem.
  const session = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await session.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
});

test('opens offline once installed', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.status-name')).toHaveText('Vitreo');
  await expect(page.locator('.status-line')).toContainText('Sin conexión');
  await context.setOffline(false);
});
