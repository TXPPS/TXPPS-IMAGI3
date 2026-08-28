import { READY_ATTRIBUTE } from '../../apps/editor/src/constants.ts';
import { expect, test } from './fixtures.ts';

test.describe('application shell', () => {
  test('boots and signals readiness', async ({ page, incidents }) => {
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('IMAGI3');
    await expect(page.getByTestId('shell-status')).toBeVisible();
    expect(incidents).toEqual([]);
  });

  test('lays out without horizontal overflow', async ({ page, profile }) => {
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      scrollWidth,
      `${profile.label} shell overflows its ${String(profile.viewport.width)}px viewport`,
    ).toBeLessThanOrEqual(profile.viewport.width);
  });

  test('serves an installable web app manifest', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).not.toBeNull();
    const response = await page.request.get(new URL(href!, page.url()).toString());
    expect(response.ok()).toBe(true);
    const manifest: unknown = await response.json();
    expect((manifest as { name?: string }).name).toBe('IMAGI3');
  });
});
