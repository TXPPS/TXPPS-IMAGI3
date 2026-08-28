import { diffPixels, DEFAULT_PIXEL_THRESHOLD } from './pixel-diff.ts';
import { meanSsim } from './ssim.ts';
import type { RgbaImage } from './types.ts';

export interface ComparisonThresholds {
  /** Maximum fraction of perceptually differing pixels, in [0, 1]. */
  readonly maxDiffRatio: number;
  /** Minimum acceptable mean SSIM, in [-1, 1]. */
  readonly minSsim: number;
  /** Per-pixel sensitivity handed to the perceptual diff. */
  readonly pixelThreshold: number;
}

/**
 * Gate for a screenshot compared against its own baseline on the same renderer
 * path and device profile. These runs are deterministic, so the allowance only
 * absorbs text and edge antialiasing jitter.
 */
export const BASELINE_THRESHOLDS: ComparisonThresholds = {
  maxDiffRatio: 0.001,
  minSsim: 0.995,
  pixelThreshold: DEFAULT_PIXEL_THRESHOLD,
};

/**
 * Gate for WebGPU-versus-WebGL2 parity. Exact equality across backends is not
 * achievable — different rasterisation, filtering and precision rules — so the
 * brief mandates a perceptual bound instead: fail above 0.5% differing pixels
 * or below 0.98 SSIM.
 */
export const PARITY_THRESHOLDS: ComparisonThresholds = {
  maxDiffRatio: 0.005,
  minSsim: 0.98,
  pixelThreshold: DEFAULT_PIXEL_THRESHOLD,
};

export interface ComparisonResult {
  readonly ok: boolean;
  readonly diffRatio: number;
  readonly ssim: number;
  readonly differingPixels: number;
  readonly totalPixels: number;
  /** One entry per breached threshold; empty when {@link ok} is true. */
  readonly failures: readonly string[];
  readonly mask: Uint8Array;
}

function collectFailures(
  diffRatio: number,
  ssim: number,
  thresholds: ComparisonThresholds,
): string[] {
  const failures: string[] = [];
  if (diffRatio > thresholds.maxDiffRatio) {
    failures.push(
      `differing pixels ${formatPercent(diffRatio)} exceeds ${formatPercent(thresholds.maxDiffRatio)}`,
    );
  }
  if (ssim < thresholds.minSsim) {
    failures.push(
      `SSIM ${ssim.toFixed(SSIM_DECIMALS)} is below ${thresholds.minSsim.toFixed(SSIM_DECIMALS)}`,
    );
  }
  return failures;
}

const PERCENT_SCALE = 100;
const PERCENT_DECIMALS = 4;
const SSIM_DECIMALS = 5;

function formatPercent(ratio: number): string {
  return `${(ratio * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`;
}

/** Compare two same-sized screenshots against a perceptual threshold pair. */
export function compareImages(
  baseline: RgbaImage,
  candidate: RgbaImage,
  thresholds: ComparisonThresholds = BASELINE_THRESHOLDS,
): ComparisonResult {
  const diff = diffPixels(baseline, candidate, thresholds.pixelThreshold);
  const ssim = meanSsim(baseline, candidate);
  const failures = collectFailures(diff.ratio, ssim, thresholds);
  return {
    ok: failures.length === 0,
    diffRatio: diff.ratio,
    ssim,
    differingPixels: diff.differingPixels,
    totalPixels: diff.totalPixels,
    failures,
    mask: diff.mask,
  };
}

export { formatPercent };
