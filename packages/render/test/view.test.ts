import { describe, expect, it } from 'vitest';
import { VIEW_EXTENT, frustumFor } from '../src/view.ts';

/**
 * `view.ts` had no test file at all when P1 was first submitted — 163 lines,
 * the only code in the repository that produces a pixel, with neither unit nor
 * visual coverage. Visual QA found it.
 *
 * Most of the module needs a real WebGL context and is covered in the browser
 * by `tests/e2e/render.spec.ts`. The camera framing does not, and it is where
 * the bug was: a square frustum on a non-square viewport stretched every sprite
 * by exactly the viewport's aspect. Extracting it made it testable here, which
 * is the point of extracting it.
 */

describe('frustumFor', () => {
  it('is square for a square viewport', () => {
    expect(frustumFor(800, 800)).toEqual({ x: VIEW_EXTENT, y: VIEW_EXTENT });
  });

  it('widens the long axis in landscape, keeping the short axis pinned', () => {
    // Short-axis fit: the same world extent is visible whichever way the device
    // is held, and the long axis shows more.
    expect(frustumFor(1600, 800)).toEqual({ x: VIEW_EXTENT * 2, y: VIEW_EXTENT });
  });

  it('heightens the long axis in portrait', () => {
    expect(frustumFor(800, 1600)).toEqual({ x: VIEW_EXTENT, y: VIEW_EXTENT * 2 });
  });

  it('makes a world square draw square on every real profile', () => {
    // The invariant the bug violated, stated as a ratio rather than as bounds.
    // A 4x4 world quad measured 21x46 pixels on the phone profile before this.
    for (const [width, height] of [
      [1440, 900],
      [1200, 800],
      [390, 844],
      [844, 390],
    ] as const) {
      const bounds = frustumFor(width, height);
      const pixelsPerWorldUnitX = width / (bounds.x * 2);
      const pixelsPerWorldUnitY = height / (bounds.y * 2);
      expect(
        pixelsPerWorldUnitX / pixelsPerWorldUnitY,
        `${String(width)}x${String(height)} does not draw a square square`,
      ).toBeCloseTo(1, 10);
    }
  });

  it('keeps the short axis at exactly VIEW_EXTENT whichever axis is short', () => {
    expect(frustumFor(1600, 800).y).toBe(VIEW_EXTENT);
    expect(frustumFor(800, 1600).x).toBe(VIEW_EXTENT);
  });

  it.each([
    ['zero width', 0, 800],
    ['zero height', 800, 0],
    ['a negative dimension', -100, 800],
    ['a non-finite dimension', Number.NaN, 800],
  ])('falls back to square for %s rather than producing invalid bounds', (_label, w, h) => {
    // A zero-sized canvas is a real state during layout. NaN frustum bounds
    // blank the scene silently, which is a much worse failure than a frame
    // drawn at the wrong aspect for one tick.
    const bounds = frustumFor(w, h);
    expect(Number.isFinite(bounds.x) && Number.isFinite(bounds.y)).toBe(true);
    expect(bounds).toEqual({ x: VIEW_EXTENT, y: VIEW_EXTENT });
  });

  it('frames more world than the simulation bounds, so entities stay visible', () => {
    // DEFAULT_BOUNDS in the runtime is ±100. This margin is why entities do not
    // touch the frame edge. The two constants live in different packages and
    // agree by intent, not by construction — noted so a change to either is a
    // decision rather than a surprise.
    expect(VIEW_EXTENT).toBeGreaterThan(100);
  });
});
