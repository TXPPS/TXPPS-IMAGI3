import { toLumaPlane, RGB_MAX } from './color.ts';
import { assertSameShape, type RgbaImage } from './types.ts';

/** Stabilising constants from Wang et al. 2004, with the conventional K1/K2. */
const K1 = 0.01;
const K2 = 0.03;
const C1 = (K1 * RGB_MAX) ** 2;
const C2 = (K2 * RGB_MAX) ** 2;

/** Local window size in pixels. Uniform weighting, not Gaussian, for determinism. */
const WINDOW_SIZE = 8;
/** Window stride; half the window keeps neighbouring windows overlapping. */
const WINDOW_STRIDE = 4;

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

/**
 * Mean structural similarity between two images, in [-1, 1] where 1 is
 * identical. Computed on the Rec. 709 luma plane with uniform 8x8 windows at
 * stride 4; uniform weighting keeps the result bit-reproducible across
 * machines, which a Gaussian kernel with float weights does not guarantee.
 */
export function meanSsim(baseline: RgbaImage, candidate: RgbaImage): number {
  assertSameShape(baseline, candidate);
  const planeA = toLumaPlane(baseline);
  const planeB = toLumaPlane(candidate);
  const size = Math.min(WINDOW_SIZE, baseline.width, baseline.height);
  const xs = windowOrigins(baseline.width, size, WINDOW_STRIDE);
  const ys = windowOrigins(baseline.height, size, WINDOW_STRIDE);

  let total = 0;
  for (const y of ys) {
    for (const x of xs) {
      total += ssimFromStats(
        collectPairStats({ a: planeA, b: planeB, width: baseline.width, origin: { x, y }, size }),
      );
    }
  }
  return total / (xs.length * ys.length);
}

export { WINDOW_SIZE, WINDOW_STRIDE };
