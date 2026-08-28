import type { Page } from '@playwright/test';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import { COLD_LOAD_BUDGET_IDS, type PageIncident } from '@imagi3/audit';
import { recordMeasurements, ruleFor } from './budget.ts';
import { median } from '@imagi3/repo';
import { expect, test, throttlingFor, type OpenThrottledPage } from './fixtures.ts';
import { installIncidentCapture } from './incidents.ts';

/** Samples per profile; the gate takes the worst of them. */
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

/**
 * The worst sample, not the median.
 *
 * A median suppresses the tail rather than exposing it — samples of
 * 20/20/3000 ms report 20 — which is the wrong direction for a gate whose job
 * is catching regressions. Three samples cannot estimate a percentile, so the
 * conservative reduction is the right one until there is enough signal to do
 * something more careful.
 */
function worst(values: readonly number[]): number {
  const value = Math.max(...values);
  if (!Number.isFinite(value)) throw new Error('cannot reduce an empty sample set');
  return value;
}

/**
 * Each sample runs on a fresh page rather than a reload. A reload keeps the
 * renderer process, its code cache and its connection alive, which is not the
 * condition the budget is stated against.
 *
 * The page comes from `openPage`, never `context.newPage()`. CDP throttling is
 * per-page, so a directly opened page carries none — which is how every
 * device-named budget here was measured unthrottled for an entire gate, while
 * the throttling self-test stayed green because it ran on a different page.
 * See RC-0006.
 */
interface ColdLoadSample {
  readonly elapsedMs: number;
  /** Throttling measured on the page this sample came from. */
  readonly throttleRatio: number;
}

async function sampleColdLoad(
  open: OpenThrottledPage,
  incidents: PageIncident[],
  expectedRate: number,
): Promise<ColdLoadSample> {
  const fresh = await open();
  const freshIncidents = await installIncidentCapture(fresh);
  try {
    // Evidence is demanded of the page that produced the number, not of the
    // helper that opened it. A page nobody verified carries no throttling
    // record, and that absence fails here rather than reaching the budget gate
    // as a suspiciously fast result.
    const verification = throttlingFor(fresh);
    expect(
      verification,
      'the sampled page carries no throttling verification, so its timing means nothing',
    ).toBeDefined();
    expect(verification?.requestedRate).toBe(expectedRate);

    await fresh.goto('/');
    await expect(fresh.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    return {
      elapsedMs: coldLoadMs(await readTimings(fresh)),
      throttleRatio: verification?.observedRatio ?? Number.NaN,
    };
  } finally {
    incidents.push(...freshIncidents);
  }
}

test.describe('cold load', () => {
  test('stays within the declared budget and records the measurement', async ({
    page,
    profile,
    incidents,
    openPage,
  }) => {
    // First navigation warms the HTTP cache; the budget is stated against a
    // warm cache, so it is not itself a sample.
    await page.goto('/');
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();

    const samples: ColdLoadSample[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push(await sampleColdLoad(openPage, incidents, profile.cpuThrottlingRate));
    }
    const elapsedMs = worst(samples.map((s) => s.elapsedMs));
    // The median of the per-page ratios.
    //
    // Note this is the opposite choice from `worst()` above, deliberately,
    // because the two quantities are being estimated for different purposes.
    // The elapsed time feeds a *budget*, where the conservative bound is what
    // protects against regressions. This ratio is an *estimate of a physical
    // property* — how much the renderer was actually slowed — and there the
    // robust central estimate is the honest one.
    //
    // It was briefly the maximum, on the argument that every influence on the
    // estimate depresses it. Review disproved both halves of that: contention
    // on the throttled draws inflates the ratio, and a page that is never
    // throttled measured 1.31x rather than the 1.0x the argument assumed. The
    // minimum is not right either — it is one bad baseline draw away from
    // reading 1.96x on a genuinely 4x-throttled page, which this host produced.
    // The median is damaged by neither a lucky draw nor an unlucky one.
    const throttleRatio = median(samples.map((s) => s.throttleRatio));

    const budgetId = COLD_LOAD_BUDGET_IDS[profile.id];
    const rule = ruleFor(budgetId);
    const ceiling = rule.max;
    if (ceiling === undefined) {
      throw new Error(`${budgetId} declares no max; the cold-load assertion would be vacuous`);
    }

    recordMeasurements(`cold-load-${profile.id}`, [
      {
        id: budgetId,
        value: elapsedMs,
        origin: `tests/e2e/cold-load.spec.ts worst of ${String(SAMPLE_COUNT)}`,
        // A non-finite value serialises to JSON null, which the parser rejects
        // with a stack trace instead of the designed 'unthrottled' status.
        // Omitting it lands on that status, which is the intended path.
        throttleRatio: Number.isFinite(throttleRatio) ? throttleRatio : undefined,
      },
    ]);

    expect(incidents).toEqual([]);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(
      elapsedMs,
      `${profile.label} cold load ${elapsedMs.toFixed(1)}ms at ${throttleRatio.toFixed(2)}x ` +
        `throttling (samples ${samples.map((s) => s.elapsedMs.toFixed(1)).join(', ')}) ` +
        `exceeds the ${String(ceiling)}ms budget`,
    ).toBeLessThanOrEqual(ceiling);
  });
});
