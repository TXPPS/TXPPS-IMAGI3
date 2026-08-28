import { describe, expect, it } from 'vitest';
import { meanSsim } from '../../src/image/ssim.ts';
import { noiseImage, solidImage, withDifferingPixels } from '../helpers/images.ts';

describe('meanSsim', () => {
  it('scores identical images at 1', () => {
    expect(meanSsim(noiseImage(32, 32, 11), noiseImage(32, 32, 11))).toBeCloseTo(1, 10);
  });

  it('scores inverted solid images far below the parity floor', () => {
    const score = meanSsim(
      solidImage(32, 32, [0, 0, 0, 255]),
      solidImage(32, 32, [255, 255, 255, 255]),
    );
    expect(score).toBeLessThan(0.1);
  });

  it('scores uncorrelated noise well below the parity floor', () => {
    expect(meanSsim(noiseImage(32, 32, 1), noiseImage(32, 32, 2))).toBeLessThan(0.5);
  });

  it('degrades as more pixels are perturbed', () => {
    const baseline = noiseImage(32, 32, 5);
    const slight = meanSsim(baseline, withDifferingPixels(baseline, 4));
    const heavy = meanSsim(baseline, withDifferingPixels(baseline, 512));
    expect(slight).toBeGreaterThan(heavy);
    expect(slight).toBeLessThan(1);
  });

  it('handles images smaller than one window', () => {
    expect(
      meanSsim(solidImage(3, 2, [10, 20, 30, 255]), solidImage(3, 2, [10, 20, 30, 255])),
    ).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    const a = noiseImage(16, 16, 21);
    const b = noiseImage(16, 16, 22);
    expect(meanSsim(a, b)).toBeCloseTo(meanSsim(b, a), 12);
  });
});
