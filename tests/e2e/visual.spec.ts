import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { DeviceProfile } from '@imagi3/audit';
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
 * with the perceptual comparator, and reject a real regression in a real page.
 * It deliberately does not lock committed baselines — that is the phase 3 gate,
 * and it needs the pinned rendering container recorded in docs/GAPS.md, because
 * font rasterisation differs between environments.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
}

function scratchBaseline(profile: DeviceProfile, name: string): string {
  return baselinePath(mkdtempSync(join(tmpdir(), 'imagi3-visual-')), profile, name);
}

test.describe('screenshot infrastructure', () => {
  test('captures a screenshot matching the emulated viewport', async ({ page, profile }) => {
    await openShell(page);
    const capture = await captureScreenshot(page);

    expect(capture.width).toBe(profile.viewport.width * profile.deviceScaleFactor);
    expect(capture.height).toBe(profile.viewport.height * profile.deviceScaleFactor);
  });

  test('renders content rather than a blank frame', async ({ page }) => {
    await openShell(page);
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

  test('reports zero difference when the page has not changed', async ({ page, profile }) => {
    // A plumbing check, not a threshold check: repeat captures of this shell are
    // byte-identical, so the comparator is being asked whether X equals X. What
    // it proves is that capture, PNG encode, decode and compare round-trip
    // without corrupting anything — not that any threshold is calibrated.
    const path = scratchBaseline(profile, 'shell');
    await openShell(page);
    expect(
      compareToBaseline(await captureScreenshot(page), path, { allowCreate: true }).status,
    ).toBe('written');

    await openShell(page);
    const second = compareToBaseline(await captureScreenshot(page), path);

    expect(second.status).toBe('compared');
    expect(second.comparison?.diffRatio).toBe(0);
    expect(
      second.comparison?.ok,
      `capture drifted between loads: ${describeComparison(second.comparison!)}`,
    ).toBe(true);
  });

  test('rejects a visual regression planted in the running page', async ({ page, profile }) => {
    // The negative control the check above cannot provide. Without it, no
    // screenshot the browser produces is ever compared against anything but
    // itself, and a comparator that always returned ok would pass this suite.
    const path = scratchBaseline(profile, 'shell-regression');
    await openShell(page);
    compareToBaseline(await captureScreenshot(page), path, { allowCreate: true });

    await openShell(page);
    await page.addStyleTag({ content: '.i3-shell__status { visibility: hidden; }' });
    const regressed = compareToBaseline(await captureScreenshot(page), path);

    expect(regressed.status).toBe('compared');
    expect(regressed.comparison?.ok, 'hiding a visible control must fail the comparator').toBe(
      false,
    );
    expect(regressed.comparison?.failures.length).toBeGreaterThan(0);
  });

  test('treats an absent baseline as a failure rather than creating one', async ({
    page,
    profile,
  }) => {
    await openShell(page);
    const outcome = compareToBaseline(
      await captureScreenshot(page),
      scratchBaseline(profile, 'absent'),
    );

    expect(outcome.status, 'a missing baseline must not silently self-heal to green').toBe(
      'missing',
    );
  });
});
