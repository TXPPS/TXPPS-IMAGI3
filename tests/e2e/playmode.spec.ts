import {
  cpuFrameMsFrom,
  droppedFrameRatioFrom,
  frameRateFrom,
  type FrameSamples,
  type Measurement,
  type ThrottleProbe,
} from '@imagi3/audit';
import {
  ENTITY_COUNT_PARAM,
  FRAME_SAMPLES_KEY,
  PLAY_PARAM,
  PLAYING_ATTRIBUTE,
  REFERENCE_2D,
} from '../../apps/editor/src/playmode/params.ts';
import { REFERENCE_2D_ENTITY_COUNT } from '../../apps/editor/src/playmode/reference-scene.ts';
import { READY_ATTRIBUTE } from '../../apps/editor/src/constants.ts';
import { recordMeasurements, ruleFor } from './budget.ts';
import { expect, test, throttlingFor } from './fixtures.ts';
import type { Page } from '@playwright/test';

/**
 * Play mode on the reference scene, measured under each profile's throttling.
 *
 * This is the P1 claim that the engine renders a realistic 2D scene inside its
 * frame budget, and it is measured the same way every other budget here is: the
 * page records raw frame durations, the gate derives the rate, and the
 * measurement carries the throttling probe of the page it came from. A page
 * reporting its own frame rate would be a producer attesting its own work.
 */

/**
 * How long to run before sampling.
 *
 * Sized from the slowest profile rather than chosen: the phone profile renders
 * at roughly 8 frames a second here, and the frame statistics need 30 warm-up
 * frames plus 30 usable ones before a percentile means anything. Fifteen
 * seconds clears that with margin on every profile.
 */
const RUN_MS = 15_000;
const READY_TIMEOUT_MS = 30_000;

/**
 * The CI-measurable budget per profile.
 *
 * Deliberately the **engine CPU** budget, not a frame rate. There is no GPU in
 * CI, so a frame-rate budget would measure SwiftShader; the frame-rate claim is
 * real and lives in the DEVICE-VERIFIED register as DV-007, which closes no
 * phase. See ADR-0015.
 */
const CPU_BUDGET_IDS = {
  tablet: 'playmode.cpuFrame.tablet.reference2d',
} as const;

/** The deferred device budget, recorded so the number survives to P9. */
const DROPPED_BUDGET_IDS = {
  tablet: 'playmode.droppedFrames.tablet.reference2d',
} as const;

async function readSamples(page: Page): Promise<FrameSamples> {
  return page.evaluate((key) => {
    const read = (window as unknown as Record<string, () => FrameSamples>)[key];
    if (typeof read !== 'function') throw new Error(`play mode published no ${key}`);
    return read();
  }, FRAME_SAMPLES_KEY);
}

test.describe('play mode', () => {
  test.setTimeout(READY_TIMEOUT_MS * 3);

  test('renders the reference scene on the WebGL2 path', async ({ page, profile }) => {
    await page.goto(`/?${PLAY_PARAM}=${REFERENCE_2D}&${ENTITY_COUNT_PARAM}=32`);
    await expect(page.locator(`html[${READY_ATTRIBUTE}="true"]`)).toBeAttached();
    await expect(page.locator(`html[${PLAYING_ATTRIBUTE}="true"]`)).toBeAttached({
      timeout: READY_TIMEOUT_MS,
    });

    // WebGL2 is the primary path and every profile must take it. A profile
    // silently falling back would make every visual and performance claim
    // below describe a renderer nobody else is running.
    await expect(page.locator('canvas')).toHaveAttribute('data-backend', 'webgl2');
    expect(profile.id).toBeTruthy();
  });

  test('runs the simulation while it draws', async ({ page }) => {
    await page.goto(`/?${PLAY_PARAM}=${REFERENCE_2D}&${ENTITY_COUNT_PARAM}=32`);
    await expect(page.locator(`html[${PLAYING_ATTRIBUTE}="true"]`)).toBeAttached({
      timeout: READY_TIMEOUT_MS,
    });
    await page.waitForTimeout(1000);

    // A renderer drawing a frozen world would meet any frame budget. The step
    // count is in the artifact so that cannot be mistaken for performance.
    const samples = await readSamples(page);
    expect(samples.steps, 'the simulation ran no steps').toBeGreaterThan(0);
    expect(samples.entityCount).toBe(32);
    // The mesh count is checked here, at a count that is **not** the reference
    // scene's, and on every profile. Where it was checked before — against the
    // literal 400, inside a test that only runs where a CPU budget is declared
    // — a `meshCount` getter hardcoded to `return 400` passed both unit and
    // E2E suites, and desktop and phone never ran the check at all.
    expect(samples.meshCount, 'the renderer allocated a different number of meshes').toBe(32);
  });

  test('keeps engine CPU work inside its share of the frame', async ({
    page,
    profile,
    incidents,
  }) => {
    const budgetId = CPU_BUDGET_IDS[profile.id as keyof typeof CPU_BUDGET_IDS];
    // The desktop profile is unthrottled and carries no device signal, so no
    // per-frame budget is named for it. The skip is recorded, not silent.
    test.skip(budgetId === undefined, 'no play-mode CPU budget is declared for this profile');

    const verification = throttlingFor(page);
    expect(verification, 'the measured page carries no throttling verification').toBeDefined();
    if (verification === undefined) throw new Error('unreachable: asserted defined above');

    await page.goto(`/?${PLAY_PARAM}=${REFERENCE_2D}`);
    await expect(page.locator(`html[${PLAYING_ATTRIBUTE}="true"]`)).toBeAttached({
      timeout: READY_TIMEOUT_MS,
    });
    await page.waitForTimeout(RUN_MS);

    const samples = await readSamples(page);
    const cpu = cpuFrameMsFrom(samples);
    const rule = ruleFor(budgetId);
    const ceiling = rule.max;
    if (ceiling === undefined) {
      throw new Error(`${budgetId} declares no max; the CPU assertion would be vacuous`);
    }

    const probes: ThrottleProbe[] = [verification.probe];
    const measurements: Measurement[] = [
      {
        id: budgetId,
        value: cpu.cpuMs,
        origin: `tests/e2e/playmode.spec.ts ${cpu.detail}`,
        throttle: probes,
      },
    ];

    // The frame-rate figure is recorded even though its budget is deferred to
    // P9, so the artifact carries the number this environment could produce and
    // a later run on real hardware has something to compare against.
    const droppedBudgetId = DROPPED_BUDGET_IDS[profile.id as keyof typeof DROPPED_BUDGET_IDS];
    if (droppedBudgetId !== undefined) {
      const dropped = droppedFrameRatioFrom(samples);
      const frames = frameRateFrom(samples);
      measurements.push({
        id: droppedBudgetId,
        value: dropped.ratio,
        origin:
          `tests/e2e/playmode.spec.ts (SOFTWARE RASTERISED, see DV-007) ${dropped.detail}; ` +
          `reported rate ${frames.fps.toFixed(1)}fps, which no engine can push to 60 here`,
        throttle: probes,
      });
    }
    // The honesty assertions come **before** the artifact is written, and the
    // budget assertion after. Recording first meant a run that had measured the
    // wrong scene still left a measurement behind: truncating the reference
    // scene to one entity produced an artifact reading "1.111ms over 1 entities
    // (1 meshes)" from a failed run. A run that measured the right thing and
    // exceeded its ceiling should still record — that number is the evidence —
    // but a run that measured the wrong thing should record nothing.
    expect(samples.entityCount).toBe(REFERENCE_2D_ENTITY_COUNT);
    // Two counts from two sources that must agree: the document's, and what the
    // renderer actually allocated. One number the page chose is not evidence.
    // A getter hardcoded to the reference count would satisfy this; what makes
    // it load-bearing is the 32-entity case in the test above.
    expect(samples.meshCount).toBe(REFERENCE_2D_ENTITY_COUNT);
    expect(incidents).toEqual([]);

    recordMeasurements(`playmode-${profile.id}`, measurements);

    expect(
      cpu.cpuMs,
      `${profile.label} play mode spent ${cpu.cpuMs.toFixed(2)}ms of engine CPU per frame ` +
        `against a ${String(ceiling)}ms ceiling — ${cpu.detail}`,
    ).toBeLessThanOrEqual(ceiling);
  });
});
