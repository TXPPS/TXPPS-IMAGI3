import { RGBA_CHANNELS, type RgbaImage } from '../../src/image/types.ts';

export function solidImage(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * RGBA_CHANNELS);
  for (let i = 0; i < width * height; i += 1) {
    data.set(rgba, i * RGBA_CHANNELS);
  }
  return { width, height, data };
}

/** Deterministic pseudo-random image so tests never depend on Math.random. */
export function noiseImage(width: number, height: number, seed: number): RgbaImage {
  const data = new Uint8Array(width * height * RGBA_CHANNELS);
  let state = seed >>> 0;
  for (let i = 0; i < width * height; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const offset = i * RGBA_CHANNELS;
    data[offset] = state & 0xff;
    data[offset + 1] = (state >>> 8) & 0xff;
    data[offset + 2] = (state >>> 16) & 0xff;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Copy an image and repaint the first `count` pixels in a guaranteed
 * high-contrast colour. Naive channel inversion is not enough: inverting a
 * mid-grey produces a delta below the perceptual threshold, which would make
 * a test think it had perturbed pixels when it had not.
 */
export function withDifferingPixels(source: RgbaImage, count: number): RgbaImage {
  const data = new Uint8Array(source.data);
  for (let i = 0; i < count; i += 1) {
    const offset = i * RGBA_CHANNELS;
    const mean = ((data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0)) / 3;
    const replacement = mean < 128 ? 255 : 0;
    data[offset] = replacement;
    data[offset + 1] = replacement;
    data[offset + 2] = replacement;
    data[offset + 3] = 255;
  }
  return { width: source.width, height: source.height, data };
}
