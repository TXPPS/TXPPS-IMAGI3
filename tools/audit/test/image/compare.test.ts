import { describe, expect, it } from 'vitest';
import { BASELINE_THRESHOLDS, PARITY_THRESHOLDS, compareImages } from '../../src/image/compare.ts';
import { noiseImage, solidImage, withDifferingPixels } from '../helpers/images.ts';

describe('threshold constants', () => {
  it('matches the perceptual parity bounds the brief mandates', () => {
    expect(PARITY_THRESHOLDS.maxDiffRatio).toBe(0.005);
    expect(PARITY_THRESHOLDS.minSsim).toBe(0.98);
  });

  it('holds same-backend baselines to a tighter bound than cross-backend parity', () => {
    expect(BASELINE_THRESHOLDS.maxDiffRatio).toBeLessThan(PARITY_THRESHOLDS.maxDiffRatio);
    expect(BASELINE_THRESHOLDS.minSsim).toBeGreaterThan(PARITY_THRESHOLDS.minSsim);
  });
});

describe('compareImages', () => {
  it('passes identical images with no failures', () => {
    const image = noiseImage(64, 64, 9);
    const result = compareImages(image, image);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.ssim).toBeCloseTo(1, 10);
  });

  it('fails on the diff ratio when too many pixels move', () => {
    const baseline = solidImage(100, 100, [20, 20, 20, 255]);
    const candidate = withDifferingPixels(baseline, 200);
    const result = compareImages(baseline, candidate, PARITY_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.diffRatio).toBeCloseTo(0.02, 10);
    expect(result.failures.join(' ')).toContain('differing pixels');
  });

  it('accepts a change that stays under both parity bounds', () => {
    const baseline = solidImage(200, 200, [128, 128, 128, 255]);
    const candidate = withDifferingPixels(baseline, 100);
    const result = compareImages(baseline, candidate, PARITY_THRESHOLDS);
    expect(result.diffRatio).toBeCloseTo(0.0025, 10);
    expect(result.ok).toBe(true);
  });

  it('reports the structural failure when images are unrelated', () => {
    const result = compareImages(noiseImage(64, 64, 1), noiseImage(64, 64, 2), PARITY_THRESHOLDS);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('SSIM');
  });

  it('surfaces both metrics for reporting', () => {
    const result = compareImages(noiseImage(32, 32, 4), noiseImage(32, 32, 4));
    expect(result.totalPixels).toBe(1024);
    expect(result.differingPixels).toBe(0);
  });
});
