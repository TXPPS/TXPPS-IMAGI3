import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { READY_ATTRIBUTE } from '../../apps/editor/src/constants.ts';
import { expect, test } from './fixtures.ts';
import {
  baselinePath,
  captureScreenshot,
  compareToBaseline,
  describeComparison,
} from './visual.ts';

/**
 * Phase 0 proves the screenshot pipeline end to end: capture, encode, compare
 * with the perceptual comparator, and report. It deliberately does not lock
 * committed baselines — that is the phase 3 gate, and it requires the pinned
 * rendering container recorded in docs/GAPS.md, because font rasterisation
 * differs between environments.
 */
test.describe('screenshot infrastructure', () => {
  test('captures a screenshot matching the emulated viewport', async ({ page, profile }) => {
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    const capture = await captureScreenshot(page);

    expect(capture.width).toBe(profile.viewport.width * profile.deviceScaleFactor);
    expect(capture.height).toBe(profile.viewport.height * profile.deviceScaleFactor);
  });

  test('renders content rather than a blank frame', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    const capture = await captureScreenshot(page);

    const distinctColours = new Set<number>();
    for (let i = 0; i < capture.data.length; i += 4) {
      distinctColours.add(
        ((capture.data[i] ?? 0) << 16) |
          ((capture.data[i + 1] ?? 0) << 8) |
          (capture.data[i + 2] ?? 0),
      );
      if (distinctColours.size > 2) break;
    }
    expect(distinctColours.size).toBeGreaterThan(2);
  });

  test('produces deterministic captures within one environment', async ({ page, profile }) => {
    const scratch = mkdtempSync(join(tmpdir(), 'imagi3-visual-'));
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();

    const path = baselinePath(scratch, profile, 'shell');
    const first = compareToBaseline(await captureScreenshot(page), path);
    expect(first.status).toBe('written');

    await page.reload();
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    const second = compareToBaseline(await captureScreenshot(page), path);

    expect(second.status).toBe('compared');
    const comparison = second.comparison;
    expect(comparison).toBeDefined();
    expect(
      comparison?.ok,
      `capture drifted between reloads: ${describeComparison(comparison!)}`,
    ).toBe(true);
  });
});
