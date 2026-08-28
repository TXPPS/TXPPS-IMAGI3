import type { Page } from '@playwright/test';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { recordMeasurements, ruleFor } from './budget.ts';
import { expect, test } from './fixtures.ts';
import { installIncidentCapture } from './incidents.ts';

/** Samples per profile. An odd count so the median is an observed value. */
const SAMPLE_COUNT = 3;

interface LoadTimings {
  /** Time the app declared itself ready, relative to navigation start. */
  readonly readyMs: number;
  /** Browser-reported first contentful paint, relative to navigation start. */
  readonly firstContentfulPaintMs: number;
}

async function readTimings(page: Page): Promise<LoadTimings> {
  await page.waitForFunction(() =>
    performance.getEntriesByType('paint').some((e) => e.name === 'first-contentful-paint'),
  );
  return page.evaluate((mark) => {
    const ready = performance.getEntriesByName(mark)[0];
    const paint = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    if (ready === undefined) throw new Error(`missing performance mark ${mark}`);
    if (paint === undefined) throw new Error('missing first-contentful-paint entry');
    return { readyMs: ready.startTime, firstContentfulPaintMs: paint.startTime };
  }, READY_MARK);
}

/**
 * The app's own readiness mark is self-reported and fires before paint, so on
 * its own it is blind to work deferred past it and to time spent rendering.
 * Taking the later of the mark and the browser's first contentful paint anchors
 * the number to something the browser attests to.
 */
function coldLoadMs(timings: LoadTimings): number {
  return Math.max(timings.readyMs, timings.firstContentfulPaintMs);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) throw new Error('cannot take the median of an empty sample set');
  return value;
}

/**
 * Each sample runs on a fresh page rather than a reload. A reload keeps the
 * renderer process, its code cache and its connection alive, which is not the
 * condition the budget is stated against.
 */
async function sampleColdLoad(page: Page, incidents: unknown[]): Promise<number> {
  const fresh = await page.context().newPage();
  const freshIncidents = await installIncidentCapture(fresh);
  try {
    await fresh.goto('/');
    await expect(fresh.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    return coldLoadMs(await readTimings(fresh));
  } finally {
    incidents.push(...freshIncidents);
    await fresh.close();
  }
}

test.describe('cold load', () => {
  test('stays within the declared budget and records the measurement', async ({
    page,
    profile,
    incidents,
  }) => {
    // First navigation warms the HTTP cache; the budget is stated against a
    // warm cache, so it is not itself a sample.
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();

    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await sampleColdLoad(page, incidents));
    }
    const elapsedMs = median(samples);

    const budgetId = `editor.coldLoad.${profile.id}`;
    const rule = ruleFor(budgetId);
    const ceiling = rule.max;
    if (ceiling === undefined) {
      throw new Error(`${budgetId} declares no max; the cold-load assertion would be vacuous`);
    }

    recordMeasurements(`cold-load-${profile.id}`, [
      {
        id: budgetId,
        value: elapsedMs,
        origin: `tests/e2e/cold-load.spec.ts median of ${String(SAMPLE_COUNT)}`,
      },
    ]);

    expect(incidents).toEqual([]);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(
      elapsedMs,
      `${profile.label} cold load ${elapsedMs.toFixed(1)}ms (samples ${samples
        .map((s) => s.toFixed(1))
        .join(', ')}) exceeds the ${String(ceiling)}ms budget`,
    ).toBeLessThanOrEqual(ceiling);
  });
});
