import type { Page } from '@playwright/test';
import { READY_ATTRIBUTE, READY_MARK } from '../../apps/editor/src/constants.ts';
import {
  COLD_LOAD_BUDGET_IDS,
  observedThrottleRatio,
  type PageIncident,
  type ThrottleProbe,
} from '@imagi3/audit';
import { recordMeasurements, ruleFor } from './budget.ts';
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
  /** Raw throttling evidence from the page this sample came from. */
  readonly probe: ThrottleProbe;
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

    if (verification === undefined) throw new Error('unreachable: asserted defined above');

    await fresh.goto('/');
    await expect(fresh.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    return { elapsedMs: coldLoadMs(await readTimings(fresh)), probe: verification.probe };
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
    const probes = samples.map((s) => s.probe);
    // Reported for the failure message only. The gate computes its own from
    // the probes below and does not read this or any other number this file
    // concludes; see tools/audit/src/budgets/throttle.ts.
    const throttleRatio = observedThrottleRatio(probes);

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
        // Every raw sample from every page, not a conclusion drawn from them.
        // The flake evidence has to survive into the artifact: a run that
        // passed on a median while one page was wildly slower is a fact a
        // later investigation needs, and an estimator throws it away.
        throttle: probes,
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
