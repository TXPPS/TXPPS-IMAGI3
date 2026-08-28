import { toLumaPlane, RGB_MAX } from './color.ts';
import { assertSameShape, type RgbaImage } from './types.ts';

/** Stabilising constants from Wang et al. 2004, with the conventional K1/K2. */
const K1 = 0.01;
const K2 = 0.03;
const C1 = (K1 * RGB_MAX) ** 2;
const C2 = (K2 * RGB_MAX) ** 2;

/**
 * Local window size in pixels, with uniform rather than Gaussian weighting.
 *
 * Wang et al. adopt a Gaussian kernel to suppress blocking artifacts in the
 * SSIM map. That matters when the map itself is the output; here the map is
 * reduced to summary statistics, so the simpler uniform window is adequate and
 * has one fewer parameter to justify.
 */
const WINDOW_SIZE = 8;
/** Window stride; half the window keeps neighbouring windows overlapping. */
const WINDOW_STRIDE = 4;

/**
 * Per-window score below which a window counts as structurally destroyed.
 *
 * Deliberately well below the whole-frame threshold, so the two SSIM gates
 * detect different things rather than one subsuming the other: the mean catches
 * broad drift where every window degrades slightly, and this catches severe
 * damage confined to a small region. Setting both to the same value would make
 * the mean gate unreachable, since a mean below 0.98 implies a large fraction
 * of windows below 0.98.
 */
export const DEFAULT_WINDOW_FLOOR = 0.9;

interface WindowRequest {
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly width: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly size: number;
}

interface PairStats {
  readonly meanA: number;
  readonly meanB: number;
  readonly varianceA: number;
  readonly varianceB: number;
  readonly covariance: number;
}

function collectPairStats(request: WindowRequest): PairStats {
  const { a, b, width, origin, size } = request;
  const count = size * size;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;

  for (let dy = 0; dy < size; dy += 1) {
    const rowStart = (origin.y + dy) * width + origin.x;
    for (let dx = 0; dx < size; dx += 1) {
      const va = a[rowStart + dx] ?? 0;
      const vb = b[rowStart + dx] ?? 0;
      sumA += va;
      sumB += vb;
      sumAA += va * va;
      sumBB += vb * vb;
      sumAB += va * vb;
    }
  }

  const meanA = sumA / count;
  const meanB = sumB / count;
  return {
    meanA,
    meanB,
    varianceA: sumAA / count - meanA * meanA,
    varianceB: sumBB / count - meanB * meanB,
    covariance: sumAB / count - meanA * meanB,
  };
}

function ssimFromStats(stats: PairStats): number {
  const { meanA, meanB, varianceA, varianceB, covariance } = stats;
  const luminance = 2 * meanA * meanB + C1;
  const structure = 2 * covariance + C2;
  const normaliser = (meanA * meanA + meanB * meanB + C1) * (varianceA + varianceB + C2);
  return (luminance * structure) / normaliser;
}

function windowOrigins(extent: number, size: number, stride: number): number[] {
  if (extent <= size) return [0];
  const origins: number[] = [];
  for (let start = 0; start + size <= extent; start += stride) origins.push(start);
  const last = extent - size;
  if (origins[origins.length - 1] !== last) origins.push(last);
  return origins;
}

export interface SsimStatistics {
  /** Mean structural similarity over all windows, in [-1, 1]. */
  readonly mean: number;
  /** The single worst window score. */
  readonly min: number;
  readonly windowCount: number;
  /** Windows scoring below the per-window floor. */
  readonly lowWindowCount: number;
  /** {@link lowWindowCount} over {@link windowCount}, in [0, 1]. */
  readonly lowWindowRatio: number;
}

/**
 * Structural similarity summarised several ways.
 *
 * The mean alone is a poor gate at UI resolutions: a 1440x900 frame yields on
 * the order of 80,000 windows, so deleting a whole control divides its
 * structural collapse by 80,000 and lands well inside any sane mean threshold.
 * The proportion of damaged windows is what actually detects a localised
 * regression, so it is reported and gated alongside the mean.
 */
export function ssimStatistics(
  baseline: RgbaImage,
  candidate: RgbaImage,
  windowFloor: number = DEFAULT_WINDOW_FLOOR,
): SsimStatistics {
  assertSameShape(baseline, candidate);
  const planeA = toLumaPlane(baseline);
  const planeB = toLumaPlane(candidate);
  const size = Math.min(WINDOW_SIZE, baseline.width, baseline.height);
  const xs = windowOrigins(baseline.width, size, WINDOW_STRIDE);
  const ys = windowOrigins(baseline.height, size, WINDOW_STRIDE);

  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let lowWindowCount = 0;

  for (const y of ys) {
    for (const x of xs) {
      const score = ssimFromStats(
        collectPairStats({ a: planeA, b: planeB, width: baseline.width, origin: { x, y }, size }),
      );
      total += score;
      if (score < min) min = score;
      if (score < windowFloor) lowWindowCount += 1;
    }
  }

  const windowCount = xs.length * ys.length;
  return {
    mean: total / windowCount,
    min,
    windowCount,
    lowWindowCount,
    lowWindowRatio: lowWindowCount / windowCount,
  };
}

/** Mean structural similarity, in [-1, 1] where 1 is identical. */
export function meanSsim(baseline: RgbaImage, candidate: RgbaImage): number {
  return ssimStatistics(baseline, candidate).mean;
}

export { WINDOW_SIZE, WINDOW_STRIDE };
