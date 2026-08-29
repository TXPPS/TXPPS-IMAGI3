import { PARITY_THRESHOLDS, compareImages, type RgbaImage } from '@imagi3/audit';
import {
  QUAD_SIZE,
  VIEW_EXTENT,
  WEBGPU_PARITY_GAP,
  formatParityReport,
  judgeParity,
} from '@imagi3/render';
import {
  ENTITY_COUNT_PARAM,
  PLAY_PARAM,
  PLAYING_ATTRIBUTE,
  REFERENCE_2D,
  STOP_PLAY_MODE_KEY,
} from '../../apps/editor/src/playmode/params.ts';
import {
  REFERENCE_2D_ENTITY_COUNT,
  SPREAD,
} from '../../apps/editor/src/playmode/reference-scene.ts';
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
 * Coverage the scene must draw, computed from the scene.
 *
 * The camera fits {@link VIEW_EXTENT} either side of the origin onto the
 * viewport's **short** axis, so one {@link QUAD_SIZE} quad is
 * `QUAD_SIZE / (2 * VIEW_EXTENT)` of that axis, and its area as a fraction of
 * the frame is that squared, times `short / long`. Times the entity count, and
 * that is the coverage a correct render produces if no two sprites overlap.
 *
 * This replaces a floor of 0.5% against a scene that draws 7.5% — a floor 15x
 * below the truth, which is why 350 of 400 sprites could vanish and every
 * sprite could collapse onto one horizontal line without it firing. Visual QA
 * demonstrated both at the P1 gate. The measured values were 7.47% / 7.97% /
 * 4.83% against this formula's 8.27% / 8.82% / 6.11%: ratios of 0.90, 0.90 and
 * 0.79, the shortfall being overlap.
 *
 * **What it cannot see**, stated rather than discovered: the formula shares
 * `QUAD_SIZE` and `VIEW_EXTENT` with the renderer, so changing either moves
 * both sides and the band does not notice. Those are design parameters, and a
 * change to them is visible in the single-sprite geometry test instead.
 */
function expectedCoverage(entities: number, width: number, height: number): number {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const sideFraction = QUAD_SIZE / (2 * VIEW_EXTENT);
  return entities * sideFraction * sideFraction * (short / long);
}

/** Overlap only ever removes coverage; the measured shortfall is about 10-21%. */
const MIN_COVERAGE_RATIO = 0.6;
/** Above the no-overlap ceiling means something is drawing that should not be. */
const MAX_COVERAGE_RATIO = 1.1;

/**
 * Extent of the drawn block along the short axis, as a fraction of it.
 *
 * The entities are scattered across a {@link SPREAD}-unit square, so the block
 * they occupy — plus half a quad of bleed at each edge — spans
 * `(SPREAD + QUAD_SIZE) / (2 * VIEW_EXTENT)` of the short axis in **both**
 * directions. Asserting the span rather than "content reaches past the middle"
 * is what distinguishes a drawn scene from a single horizontal bar through the
 * origin, which reached past the middle by three thousandths and passed.
 */
const BLOCK_SPAN = (SPREAD + QUAD_SIZE) / (2 * VIEW_EXTENT);
/** Slack for edge quantisation and for the scene's random extremes. */
const SPAN_TOLERANCE = 0.25;

interface DrawnRegion {
  readonly count: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function isEntityPixel(image: RgbaImage, i: number): boolean {
  return (
    Math.abs((image.data[i] ?? 0) - ENTITY_RGB.r) <= CHANNEL_TOLERANCE &&
    Math.abs((image.data[i + 1] ?? 0) - ENTITY_RGB.g) <= CHANNEL_TOLERANCE &&
    Math.abs((image.data[i + 2] ?? 0) - ENTITY_RGB.b) <= CHANNEL_TOLERANCE
  );
}

/** Where the sprites are, and how many pixels of them there are. */
function drawnRegion(image: RgbaImage): DrawnRegion {
  let count = 0;
  let minX = image.width;
  let maxX = -1;
  let minY = image.height;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isEntityPixel(image, (y * image.width + x) * 4)) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, maxX, minY, maxY };
}

/** Fraction of the frame's height the negative control repaints. */
const PERTURBED_BAND = 0.1;

/**
 * A copy of a real capture with one band repainted, for a negative control.
 *
 * Repaints rather than shifts, so the change is unambiguous to both the
 * per-pixel gate and the structural one: a band of the entity colour laid over
 * whatever was there. Ten percent of the frame's height is far above every
 * threshold in `PARITY_THRESHOLDS` and far below "a different image".
 */
function perturb(image: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data);
  const bandRows = Math.max(1, Math.round(image.height * PERTURBED_BAND));
  for (let y = 0; y < bandRows; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      data[i] = ENTITY_RGB.r;
      data[i + 1] = ENTITY_RGB.g;
      data[i + 2] = ENTITY_RGB.b;
      data[i + 3] = 255;
    }
  }
  return { width: image.width, height: image.height, data };
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

  test('draws as much of the scene as the scene has', async ({ page }) => {
    await startPlaying(page, REFERENCE_2D_ENTITY_COUNT);
    const frame = await captureScreenshot(page);
    const region = drawnRegion(frame);
    const coverage = region.count / (frame.width * frame.height);
    const expected = expectedCoverage(REFERENCE_2D_ENTITY_COUNT, frame.width, frame.height);
    const ratio = coverage / expected;
    const shape =
      `${(coverage * 100).toFixed(3)}% covered against ${(expected * 100).toFixed(3)}% ` +
      `expected from the scene (ratio ${ratio.toFixed(2)})`;

    expect(
      distinctColours(frame),
      'the frame is a single flat colour, so nothing was drawn',
    ).toBeGreaterThan(1);
    // Below the band: sprites are missing, or collapsed on top of each other.
    // Above it: something is drawing that the scene does not contain.
    expect(ratio, `too little of the scene reached the frame — ${shape}`).toBeGreaterThan(
      MIN_COVERAGE_RATIO,
    );
    expect(ratio, `more was drawn than the scene contains — ${shape}`).toBeLessThan(
      MAX_COVERAGE_RATIO,
    );
  });

  test('spreads the scene across both axes, not along one line', async ({ page }) => {
    // Collapsing every sprite to y=0 leaves a 16px bar through the middle of an
    // otherwise black frame. It passed a coverage floor and passed "content
    // reaches past the vertical middle" — by three thousandths, because a bar
    // through the origin lands just below centre.
    await startPlaying(page, REFERENCE_2D_ENTITY_COUNT);
    const frame = await captureScreenshot(page);
    const region = drawnRegion(frame);
    expect(region.count, 'nothing was drawn').toBeGreaterThan(0);

    const short = Math.min(frame.width, frame.height);
    const spanX = (region.maxX - region.minX + 1) / short;
    const spanY = (region.maxY - region.minY + 1) / short;
    const floor = BLOCK_SPAN * (1 - SPAN_TOLERANCE);
    const shape = `${spanX.toFixed(2)} x ${spanY.toFixed(2)} of the short axis`;

    expect(spanX, `the drawn block is too narrow: ${shape}`).toBeGreaterThan(floor);
    expect(spanY, `the drawn block is too short: ${shape}`).toBeGreaterThan(floor);
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
   *
   * The first assertion written for that was "content reaches the lower half of
   * the frame", and Visual QA showed at pass 2 that **the defect satisfies it
   * harder than the fix does**: with `resize` dead the scene is clipped and runs
   * off the bottom edge, measuring 0.959 where a working renderer measures
   * 0.787. Reaching past the middle is not the property; tracking the viewport
   * is, and the geometry that says so was being read and thrown away.
   */
  async function canvasGeometry(page: Page): Promise<{
    attrWidth: number;
    attrHeight: number;
    cssWidth: number;
    cssHeight: number;
    innerWidth: number;
    innerHeight: number;
  } | null> {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (canvas === null) return null;
      const box = canvas.getBoundingClientRect();
      return {
        attrWidth: canvas.width,
        attrHeight: canvas.height,
        cssWidth: box.width,
        cssHeight: box.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      };
    });
  }

  test('resizes the canvas to the rotated viewport', async ({ page, profile }) => {
    await startPlaying(page, REFERENCE_2D_ENTITY_COUNT);
    const rotated = { width: profile.viewport.height, height: profile.viewport.width };
    await page.setViewportSize(rotated);
    await page.waitForTimeout(500);

    const size = await canvasGeometry(page);
    expect(size, 'no canvas after rotation').not.toBeNull();
    if (size === null) return;

    // The CSS box is the viewport. RC-0013 was the other failure mode of this
    // line: `setSize(w, h, false)` left the canvas with no CSS size, the
    // attribute drove layout, the container grew, and the observer refired —
    // a phone settled at a 1827px root inside a 390px viewport.
    expect(size.cssWidth, 'the canvas is not as wide as the rotated viewport').toBeCloseTo(
      size.innerWidth,
      0,
    );
    expect(size.cssHeight, 'the canvas is not as tall as the rotated viewport').toBeCloseTo(
      size.innerHeight,
      0,
    );
    // The backing store is the CSS box times the capped device pixel ratio, and
    // the same ratio on both axes — a backing store that kept its
    // pre-rotation shape is exactly the dead-`resize` signature.
    const ratioX = size.attrWidth / size.cssWidth;
    const ratioY = size.attrHeight / size.cssHeight;
    expect(ratioX, 'the canvas backing store does not track its CSS box').toBeCloseTo(ratioY, 1);

    // And the page must not have grown a scrollbar's worth of layout out of it.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow, 'the rotated page overflows its own viewport').toBeLessThanOrEqual(1);
  });

  test('re-centres the scene when the device rotates', async ({ page, profile }) => {
    await startPlaying(page, REFERENCE_2D_ENTITY_COUNT);
    const rotated = { width: profile.viewport.height, height: profile.viewport.width };
    await page.setViewportSize(rotated);
    await page.waitForTimeout(500);

    const frame = await captureScreenshot(page);
    const region = drawnRegion(frame);
    expect(region.count, 'nothing was drawn after rotation').toBeGreaterThan(0);

    // Centred, not merely present. A clipped scene jammed into a corner reaches
    // further down the frame than a correct one does.
    const centreX = (region.minX + region.maxX) / 2 / frame.width;
    const centreY = (region.minY + region.maxY) / 2 / frame.height;
    const where = `centre (${centreX.toFixed(2)}, ${centreY.toFixed(2)})`;
    expect(centreX, `the scene is not horizontally centred after rotation — ${where}`).toBeCloseTo(
      0.5,
      1,
    );
    expect(centreY, `the scene is not vertically centred after rotation — ${where}`).toBeCloseTo(
      0.5,
      1,
    );

    // And none of it is clipped away: the same derived coverage as upright.
    const coverage = region.count / (frame.width * frame.height);
    const expected = expectedCoverage(REFERENCE_2D_ENTITY_COUNT, frame.width, frame.height);
    expect(
      coverage / expected,
      `rotation lost content: ${(coverage * 100).toFixed(3)}% against ` +
        `${(expected * 100).toFixed(3)}% expected`,
    ).toBeGreaterThan(MIN_COVERAGE_RATIO);
  });

  test('keeps a square sprite square after rotation', async ({ page, profile }) => {
    // `resize` calls `frameCamera` because the aspect correction is right once
    // and wrong after every rotation. Deleting that call left all fifteen
    // rotation assertions passing at pass 2: the square-sprite test never
    // rotates, and the rotation test never measured aspect.
    await startPlaying(page, 1);
    await page.setViewportSize({ width: profile.viewport.height, height: profile.viewport.width });
    await page.waitForTimeout(500);

    const frame = await captureScreenshot(page);
    const region = drawnRegion(frame);
    expect(region.count, 'no sprite was found after rotation').toBeGreaterThan(0);
    const drawnWidth = region.maxX - region.minX + 1;
    const drawnHeight = region.maxY - region.minY + 1;
    expect(
      Math.abs(drawnWidth - drawnHeight),
      `${profile.label} drew a square sprite as ${String(drawnWidth)}x${String(drawnHeight)}px ` +
        'after rotation, so the camera was not reframed',
    ).toBeLessThanOrEqual(2);
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

    // The negative control, and the reason this test is worth running at all.
    //
    // The two captures above are byte-identical — 0 of 1,296,000 pixels differ,
    // mean SSIM exactly 1.00000 — so `expect(comparison.ok).toBe(true)` is
    // `X === X`. Visual QA neutered `compareImages` to `ok: true` at pass 2 and
    // this whole spec stayed green. A comparator that cannot be observed to
    // fail is not being exercised, whatever the header says.
    //
    // So the same comparator, on the same real capture, against a copy with one
    // band of pixels moved. If this passes, the comparison above proved nothing.
    const damaged = perturb(second);
    const control = compareImages(first, damaged, PARITY_THRESHOLDS);
    expect(
      control.ok,
      'the comparator accepted a visibly different frame, so the comparison above is vacuous',
    ).toBe(false);
    expect(judgeParity({ webgl2: { ok: control.ok, detail: 'planted' } }).legs[0]?.status).toBe(
      'violated',
    );
  });
});
