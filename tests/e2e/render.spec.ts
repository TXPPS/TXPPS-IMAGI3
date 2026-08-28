import { PARITY_THRESHOLDS, compareImages, type RgbaImage } from '@imagi3/audit';
import { WEBGPU_PARITY_GAP, formatParityReport, judgeParity } from '@imagi3/render';
import {
  ENTITY_COUNT_PARAM,
  PLAY_PARAM,
  PLAYING_ATTRIBUTE,
  REFERENCE_2D,
  STOP_PLAY_MODE_KEY,
} from '../../apps/editor/src/playmode/params.ts';
import { captureScreenshot } from './visual.ts';
import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

/**
 * Pixels. Not attributes, not counters — pixels.
 *
 * Every guard the play-mode spec had at the P1 gate lived upstream of
 * rasterisation: a backend attribute, a step count, an entity count, a CPU
 * timing. Visual QA replaced `SceneView.present` with an empty function — one
 * line, deleting every draw call in the engine — and all 732 unit tests and all
 * 62 end-to-end tests across three device profiles stayed green, while the page
 * rendered a single flat colour. See RC-0009.
 *
 * These assertions are properties of the rendered frame, and they are the ones
 * that mutant fails. They are deliberately not baseline comparisons: ADR-0010
 * defers committed baselines because font rasterisation differs between
 * environments, and that argument holds. It does not follow that a renderer
 * should have no visual assertion at all — the invariants below need no
 * agreement between environments about how a glyph is antialiased.
 */

const READY_TIMEOUT_MS = 30_000;

/** Colour the reference scene draws its sprites in, from `view.ts`. */
const ENTITY_RGB = { r: 0x6f, g: 0xd3, b: 0xc7 } as const;
/** Per-channel slack, so a colour-managed pipeline is not a false failure. */
const CHANNEL_TOLERANCE = 24;

/**
 * Fraction of the frame the sprites must cover.
 *
 * Derived from the scene rather than chosen: 400 quads of 4 world units in a
 * 220-unit short axis cover roughly 0.03% each if none overlap, so a floor of
 * 0.5% is well under what the scene draws and far above what a blank frame
 * draws, which is zero.
 */
const MIN_ENTITY_COVERAGE = 0.005;

function countEntityPixels(image: RgbaImage): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (
      Math.abs((image.data[i] ?? 0) - ENTITY_RGB.r) <= CHANNEL_TOLERANCE &&
      Math.abs((image.data[i + 1] ?? 0) - ENTITY_RGB.g) <= CHANNEL_TOLERANCE &&
      Math.abs((image.data[i + 2] ?? 0) - ENTITY_RGB.b) <= CHANNEL_TOLERANCE
    ) {
      count += 1;
    }
  }
  return count;
}

function distinctColours(image: RgbaImage): number {
  const seen = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    seen.add(
      ((image.data[i] ?? 0) << 16) | ((image.data[i + 1] ?? 0) << 8) | (image.data[i + 2] ?? 0),
    );
    if (seen.size > 2) break;
  }
  return seen.size;
}

async function startPlaying(page: Page, entities: number): Promise<void> {
  await page.goto(`/?${PLAY_PARAM}=${REFERENCE_2D}&${ENTITY_COUNT_PARAM}=${String(entities)}`);
  await expect(page.locator(`html[${PLAYING_ATTRIBUTE}="true"]`)).toBeAttached({
    timeout: READY_TIMEOUT_MS,
  });
}

test.describe('the renderer draws', () => {
  test.setTimeout(READY_TIMEOUT_MS * 2);

  test('puts the scene on the canvas rather than leaving it blank', async ({ page }) => {
    await startPlaying(page, 400);
    const frame = await captureScreenshot(page);
    const coverage = countEntityPixels(frame) / (frame.width * frame.height);

    expect(
      distinctColours(frame),
      'the frame is a single flat colour, so nothing was drawn',
    ).toBeGreaterThan(1);
    expect(
      coverage,
      `sprites cover ${(coverage * 100).toFixed(3)}% of the frame, below the ` +
        `${(MIN_ENTITY_COVERAGE * 100).toFixed(1)}% the reference scene must draw`,
    ).toBeGreaterThan(MIN_ENTITY_COVERAGE);
  });

  test('draws a moving scene, not one still frame', async ({ page }) => {
    // A renderer that drew once and stopped would satisfy the coverage check
    // above for the whole run.
    await startPlaying(page, 400);
    const first = await captureScreenshot(page);
    await page.waitForTimeout(400);
    const second = await captureScreenshot(page);

    const comparison = compareImages(first, second, PARITY_THRESHOLDS);
    expect(
      comparison.differingPixels,
      'two captures 400ms apart are identical, so the scene is frozen',
    ).toBeGreaterThan(0);
  });

  /**
   * The aspect-ratio bug Visual QA found by measuring, not by reading: a square
   * frustum on a non-square viewport stretched every sprite by exactly the
   * viewport's aspect. A 4x4 quad measured 21x46 pixels on the phone profile.
   */
  test('draws a square sprite square, whatever the viewport aspect', async ({ page, profile }) => {
    await startPlaying(page, 1);
    const frame = await captureScreenshot(page);

    let minX = frame.width;
    let maxX = -1;
    let minY = frame.height;
    let maxY = -1;
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const i = (y * frame.width + x) * 4;
        if (Math.abs((frame.data[i + 1] ?? 0) - ENTITY_RGB.g) > CHANNEL_TOLERANCE) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    expect(maxX, 'no sprite was found in the frame').toBeGreaterThanOrEqual(0);
    const drawnWidth = maxX - minX + 1;
    const drawnHeight = maxY - minY + 1;
    const drawnAspect = drawnWidth / drawnHeight;
    const viewportAspect = profile.viewport.width / profile.viewport.height;
    const shape = `${String(drawnWidth)}x${String(drawnHeight)}px, aspect ${drawnAspect.toFixed(3)}`;

    // Tolerance in pixels, not in ratio. A sprite is only ~16px on a side here,
    // and each edge lands on a pixel boundary, so ±1px per axis is
    // quantisation rather than distortion — a fixed ratio tolerance would be
    // 6% at this size and flake. Two pixels is the honest bound.
    expect(
      Math.abs(drawnWidth - drawnHeight),
      `${profile.label} drew a square sprite as ${shape}`,
    ).toBeLessThanOrEqual(2);

    // The bug's signature was that drawn aspect tracked viewport aspect
    // exactly. This is the assertion that actually distinguishes the fix from
    // the defect, and it holds with room whatever the rounding does.
    if (Math.abs(viewportAspect - 1) > 0.1) {
      expect(
        Math.abs(drawnAspect - 1) < Math.abs(drawnAspect - viewportAspect),
        `${profile.label} drew ${shape}, closer to the viewport aspect ` +
          `${viewportAspect.toFixed(3)} than to square — the frustum is not aspect-corrected`,
      ).toBe(true);
    }
  });

  /**
   * Rotation. `SceneView.resize` existed and was called by nothing at the P1
   * gate, so a rotated tablet drew the scene into the top 45% of the screen.
   */
  test('follows the viewport when the device rotates', async ({ page, profile }) => {
    await startPlaying(page, 400);
    const rotated = { width: profile.viewport.height, height: profile.viewport.width };
    await page.setViewportSize(rotated);
    await page.waitForTimeout(500);

    const size = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas === null ? null : { width: canvas.width, height: canvas.height };
    });
    expect(size, 'no canvas after rotation').not.toBeNull();

    const frame = await captureScreenshot(page);
    // Content must reach the far half of the newly long axis; before the fix it
    // stopped at the old extent and left the rest of the screen empty.
    let lowest = -1;
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const i = (y * frame.width + x) * 4;
        if (Math.abs((frame.data[i + 1] ?? 0) - ENTITY_RGB.g) <= CHANNEL_TOLERANCE) lowest = y;
      }
    }
    expect(
      lowest / frame.height,
      'the scene does not reach the lower half of the rotated viewport',
    ).toBeGreaterThan(0.5);
  });
});

/**
 * The parity harness, wired.
 *
 * At the P1 gate `judgeParity` had no caller outside its own unit test, while
 * its header claimed a WebGL2-to-WebGL2 comparison ran today. This is that
 * comparison. It runs the real comparator over two real captures with the real
 * thresholds, and then asserts the thing that actually matters: the report is
 * **not** ok, because the WebGPU leg was never rendered.
 */
test.describe('renderer parity', () => {
  test.setTimeout(READY_TIMEOUT_MS * 2);

  test('compares WebGL2 against itself and reports WebGPU unmeasured', async ({ page }) => {
    await startPlaying(page, 400);
    // Freeze the simulation so the two captures differ only by rendering. The
    // comparison is of the pipeline, not of the passage of time.
    await page.evaluate((key) => {
      const stop = (window as unknown as Record<string, () => void>)[key];
      if (typeof stop !== 'function') throw new Error(`play mode published no ${key}`);
      stop();
    }, STOP_PLAY_MODE_KEY);
    const first = await captureScreenshot(page);
    const second = await captureScreenshot(page);
    const comparison = compareImages(first, second, PARITY_THRESHOLDS);

    const detail =
      comparison.failures.length === 0
        ? `${String(comparison.differingPixels)} of ${String(comparison.totalPixels)} pixels differ`
        : comparison.failures.join('; ');
    const report = judgeParity({ webgl2: { ok: comparison.ok, detail } });

    expect(comparison.ok, `two identical WebGL2 captures differ: ${detail}`).toBe(true);
    expect(report.legs.find((leg) => leg.backend === 'webgl2')?.status).toBe('passed');
    expect(report.legs.find((leg) => leg.backend === 'webgpu')?.status).toBe('unmeasured');
    expect(report.ok, 'parity must not be ok while a backend is unmeasured').toBe(false);
    expect(report.deferredTo).toBe(WEBGPU_PARITY_GAP);
    expect(formatParityReport(report)).toContain('PARITY NOT ESTABLISHED');
  });
});
