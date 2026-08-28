import { diffPixels, DEFAULT_PIXEL_THRESHOLD } from './pixel-diff.ts';
import { DEFAULT_WINDOW_FLOOR, ssimStatistics, type SsimStatistics } from './ssim.ts';
import type { RgbaImage } from './types.ts';

export interface ComparisonThresholds {
  /** Maximum fraction of perceptually differing pixels, in [0, 1]. */
  readonly maxDiffRatio: number;
  /** Minimum acceptable mean SSIM, in [-1, 1]. */
  readonly minSsim: number;
  /** SSIM below which a single window counts as structurally destroyed. */
  readonly windowFloor: number;
  /** Maximum fraction of windows allowed below {@link windowFloor}. */
  readonly maxLowWindowRatio: number;
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
  windowFloor: DEFAULT_WINDOW_FLOOR,
  maxLowWindowRatio: 0.0005,
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
  windowFloor: DEFAULT_WINDOW_FLOOR,
  maxLowWindowRatio: 0.002,
  pixelThreshold: DEFAULT_PIXEL_THRESHOLD,
};

export interface ComparisonResult {
  readonly ok: boolean;
  readonly diffRatio: number;
  /** Mean SSIM. Kept as `ssim` because it is the number the brief names. */
  readonly ssim: number;
  readonly ssimStats: SsimStatistics;
  readonly differingPixels: number;
  readonly totalPixels: number;
  /** One entry per breached threshold; empty when {@link ok} is true. */
  readonly failures: readonly string[];
  readonly mask: Uint8Array;
}

const PERCENT_SCALE = 100;
const PERCENT_DECIMALS = 4;
const SSIM_DECIMALS = 5;

function formatPercent(ratio: number): string {
  return `${(ratio * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`;
}

function collectFailures(
  diffRatio: number,
  stats: SsimStatistics,
  thresholds: ComparisonThresholds,
): string[] {
  const failures: string[] = [];
  if (diffRatio > thresholds.maxDiffRatio) {
    failures.push(
      `differing pixels ${formatPercent(diffRatio)} exceeds ${formatPercent(thresholds.maxDiffRatio)}`,
    );
  }
  if (stats.mean < thresholds.minSsim) {
    failures.push(
      `mean SSIM ${stats.mean.toFixed(SSIM_DECIMALS)} is below ${thresholds.minSsim.toFixed(SSIM_DECIMALS)}`,
    );
  }
  if (stats.lowWindowRatio > thresholds.maxLowWindowRatio) {
    failures.push(
      `${formatPercent(stats.lowWindowRatio)} of windows fell below SSIM ` +
        `${thresholds.windowFloor.toFixed(2)} (worst ${stats.min.toFixed(SSIM_DECIMALS)}), ` +
        `exceeding ${formatPercent(thresholds.maxLowWindowRatio)}`,
    );
  }
  return failures;
}

/**
 * Compare two same-sized screenshots.
 *
 * Three gates, each independently reachable — there is a regression that only
 * it can catch, which is what stops any of them from being decorative:
 *
 * - **Differing-pixel ratio** catches diffuse colour drift spread across the
 *   frame, where no single window loses enough structure to notice.
 * - **Mean SSIM** catches whole-frame structural drift, such as a background
 *   level shift too small for any pixel to cross the perceptual threshold.
 * - **Damaged-window ratio** catches a localised regression the mean dilutes
 *   into nothing: erasing one control in a 1440x900 frame moves the mean by
 *   far less than any sane threshold while destroying the windows it occupied.
 *
 * `tools/audit/test/selftest/detectors.test.ts` pins one scenario per gate in
 * which the other two stay inside their bounds.
 */
export function compareImages(
  baseline: RgbaImage,
  candidate: RgbaImage,
  thresholds: ComparisonThresholds = BASELINE_THRESHOLDS,
): ComparisonResult {
  const diff = diffPixels(baseline, candidate, thresholds.pixelThreshold);
  const ssimStats = ssimStatistics(baseline, candidate, thresholds.windowFloor);
  const failures = collectFailures(diff.ratio, ssimStats, thresholds);
  return {
    ok: failures.length === 0,
    diffRatio: diff.ratio,
    ssim: ssimStats.mean,
    ssimStats,
    differingPixels: diff.differingPixels,
    totalPixels: diff.totalPixels,
    failures,
    mask: diff.mask,
  };
}

export { formatPercent };
