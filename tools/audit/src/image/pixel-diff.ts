import { ALPHA_OFFSET, RGBA_CHANNELS, assertSameShape, type RgbaImage } from './types.ts';
import { RGB_MAX, RGB_TO_YIQ } from './color.ts';

/**
 * YIQ weights and normalisation used for the perceptual per-pixel delta.
 * These are the weights popularised by the `pixelmatch` algorithm: differences
 * in luma dominate, chroma differences are discounted, which is what makes a
 * cross-backend renderer comparison tractable at all.
 */
const YIQ_Y_WEIGHT = 0.5053;
const YIQ_I_WEIGHT = 0.299;
const YIQ_Q_WEIGHT = 0.1957;

/** Largest possible weighted YIQ delta between two 8-bit RGB colours. */
const MAX_YIQ_DELTA = 35215;

/** Default per-pixel sensitivity. Smaller values flag more pixels as different. */
export const DEFAULT_PIXEL_THRESHOLD = 0.1;

interface Yiq {
  readonly y: number;
  readonly i: number;
  readonly q: number;
}

function toYiq(r: number, g: number, b: number): Yiq {
  return {
    y: r * RGB_TO_YIQ.y.r + g * RGB_TO_YIQ.y.g + b * RGB_TO_YIQ.y.b,
    i: r * RGB_TO_YIQ.i.r + g * RGB_TO_YIQ.i.g + b * RGB_TO_YIQ.i.b,
    q: r * RGB_TO_YIQ.q.r + g * RGB_TO_YIQ.q.g + b * RGB_TO_YIQ.q.b,
  };
}

function readPixel(image: RgbaImage, offset: number): Yiq {
  const { data } = image;
  const alpha = (data[offset + ALPHA_OFFSET] ?? RGB_MAX) / RGB_MAX;
  const r = (data[offset] ?? 0) * alpha + RGB_MAX * (1 - alpha);
  const g = (data[offset + 1] ?? 0) * alpha + RGB_MAX * (1 - alpha);
  const b = (data[offset + 2] ?? 0) * alpha + RGB_MAX * (1 - alpha);
  return toYiq(r, g, b);
}

/** Weighted perceptual distance between two pixels, in the same units as {@link MAX_YIQ_DELTA}. */
function pixelDelta(a: RgbaImage, b: RgbaImage, index: number): number {
  const offset = index * RGBA_CHANNELS;
  const pa = readPixel(a, offset);
  const pb = readPixel(b, offset);
  const dy = pa.y - pb.y;
  const di = pa.i - pb.i;
  const dq = pa.q - pb.q;
  return YIQ_Y_WEIGHT * dy * dy + YIQ_I_WEIGHT * di * di + YIQ_Q_WEIGHT * dq * dq;
}

export interface PixelDiffResult {
  /** Count of pixels whose perceptual delta exceeded the threshold. */
  readonly differingPixels: number;
  readonly totalPixels: number;
  /** {@link differingPixels} divided by {@link totalPixels}, in [0, 1]. */
  readonly ratio: number;
  /** Per-pixel mask, 1 where the pixel differs. Useful for writing diff images. */
  readonly mask: Uint8Array;
}

/**
 * Count perceptually different pixels between two equally sized images.
 *
 * @param threshold Sensitivity in [0, 1]; the squared threshold scales
 * {@link MAX_YIQ_DELTA} to produce the per-pixel cutoff.
 */
export function diffPixels(
  baseline: RgbaImage,
  candidate: RgbaImage,
  threshold: number = DEFAULT_PIXEL_THRESHOLD,
): PixelDiffResult {
  assertSameShape(baseline, candidate);
  if (threshold < 0 || threshold > 1) {
    throw new RangeError(`pixel threshold must be within [0, 1], got ${String(threshold)}`);
  }

  const totalPixels = baseline.width * baseline.height;
  const cutoff = MAX_YIQ_DELTA * threshold * threshold;
  const mask = new Uint8Array(totalPixels);
  let differingPixels = 0;

  for (let index = 0; index < totalPixels; index += 1) {
    if (pixelDelta(baseline, candidate, index) <= cutoff) continue;
    mask[index] = 1;
    differingPixels += 1;
  }

  return {
    differingPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : differingPixels / totalPixels,
    mask,
  };
}

export { MAX_YIQ_DELTA };
