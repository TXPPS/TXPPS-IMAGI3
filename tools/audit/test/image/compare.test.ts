import { describe, expect, it } from 'vitest';
import { BASELINE_THRESHOLDS, PARITY_THRESHOLDS, compareImages } from '../../src/image/compare.ts';
import { noiseImage, solidImage, withScatteredShift, withWipedBlock } from '../helpers/images.ts';

const FRAME = noiseImage(320, 320, 99);
const DARK = [11, 13, 18, 255] as const;

describe('threshold constants', () => {
  it('matches the perceptual parity bounds the brief mandates', () => {
    expect(PARITY_THRESHOLDS.maxDiffRatio).toBe(0.005);
    expect(PARITY_THRESHOLDS.minSsim).toBe(0.98);
  });

  it('holds same-backend baselines to a tighter bound than cross-backend parity', () => {
    expect(BASELINE_THRESHOLDS.maxDiffRatio).toBeLessThan(PARITY_THRESHOLDS.maxDiffRatio);
    expect(BASELINE_THRESHOLDS.minSsim).toBeGreaterThan(PARITY_THRESHOLDS.minSsim);
    expect(BASELINE_THRESHOLDS.maxLowWindowRatio).toBeLessThan(PARITY_THRESHOLDS.maxLowWindowRatio);
  });

  it('sets the window floor well below the mean threshold so the two gates differ', () => {
    // Equal values would make the mean gate unreachable: a mean below the floor
    // implies a large fraction of windows below it.
    expect(PARITY_THRESHOLDS.windowFloor).toBeLessThan(PARITY_THRESHOLDS.minSsim);
  });
});

describe('compareImages', () => {
  it('passes identical images with no failures', () => {
    const result = compareImages(FRAME, FRAME, PARITY_THRESHOLDS);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.ssim).toBeCloseTo(1, 10);
    expect(result.ssimStats.lowWindowRatio).toBe(0);
  });

  it('reports the metric totals alongside the verdict', () => {
    const result = compareImages(FRAME, FRAME, PARITY_THRESHOLDS);
    expect(result.totalPixels).toBe(320 * 320);
    expect(result.differingPixels).toBe(0);
    expect(result.ssimStats.windowCount).toBeGreaterThan(0);
    expect(result.ssimStats.min).toBeCloseTo(1, 10);
  });
});

/**
 * One case per gate, each constructed so the other two stay inside their
 * bounds. If any gate were deleted, exactly one of these would start passing.
 */
describe('each gate catches a regression the others miss', () => {
  it('the pixel-ratio gate alone catches diffuse colour drift', () => {
    const result = compareImages(FRAME, withScatteredShift(FRAME, 108, 40), PARITY_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('differing pixels');
    expect(result.ssim).toBeGreaterThan(PARITY_THRESHOLDS.minSsim);
    expect(result.ssimStats.lowWindowRatio).toBeLessThanOrEqual(
      PARITY_THRESHOLDS.maxLowWindowRatio,
    );
  });

  it('the damaged-window gate alone catches one erased region', () => {
    const result = compareImages(
      FRAME,
      withWipedBlock(FRAME, { x: 40, y: 40 }, 16),
      PARITY_THRESHOLDS,
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('windows fell below');
    expect(result.diffRatio).toBeLessThanOrEqual(PARITY_THRESHOLDS.maxDiffRatio);
    expect(result.ssim).toBeGreaterThan(PARITY_THRESHOLDS.minSsim);
  });

  it('the mean-SSIM gate alone catches a sub-threshold background shift', () => {
    const result = compareImages(
      solidImage(160, 160, DARK),
      solidImage(160, 160, [14, 16, 21, 255]),
      PARITY_THRESHOLDS,
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('mean SSIM');
    // Not a single pixel crossed the perceptual threshold.
    expect(result.differingPixels).toBe(0);
    expect(result.ssimStats.lowWindowRatio).toBeLessThanOrEqual(
      PARITY_THRESHOLDS.maxLowWindowRatio,
    );
  });

  it('accepts a background shift one level smaller than the failing one', () => {
    const result = compareImages(
      solidImage(160, 160, DARK),
      solidImage(160, 160, [13, 15, 20, 255]),
      PARITY_THRESHOLDS,
    );
    expect(result.ok).toBe(true);
  });
});

describe('compound failures', () => {
  it('reports every breached gate, not just the first', () => {
    const result = compareImages(noiseImage(64, 64, 1), noiseImage(64, 64, 2), PARITY_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(1);
  });
});
