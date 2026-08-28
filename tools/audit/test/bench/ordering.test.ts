import { describe, expect, it } from 'vitest';
import {
  MINIMUM_RATIOS,
  checkProfileOrdering,
  formatOrderingReport,
} from '../../src/bench/ordering.ts';
import type { ProfileBenchmark } from '../../src/bench/ordering.ts';
import { DEVICE_PROFILES } from '../../src/profiles.ts';

/** Ratios roughly matching a correctly throttled run. */
function throttled(): ProfileBenchmark[] {
  return [
    { profile: 'desktop', medianMs: 100, requestedRate: DEVICE_PROFILES.desktop.cpuThrottlingRate },
    { profile: 'tablet', medianMs: 430, requestedRate: DEVICE_PROFILES.tablet.cpuThrottlingRate },
    { profile: 'phone', medianMs: 650, requestedRate: DEVICE_PROFILES.phone.cpuThrottlingRate },
  ];
}

describe('checkProfileOrdering', () => {
  it('passes a correctly throttled run', () => {
    const report = checkProfileOrdering(throttled());
    expect(report.ok).toBe(true);
    expect(report.pairs.every((p) => p.ok)).toBe(true);
  });

  /**
   * The mutation this whole mechanism exists for. With throttling removed all
   * three profiles run at the same speed, every ratio collapses to 1.0, and a
   * budget named for a phone is measuring a workstation.
   */
  it('fails when throttling is not in effect and every profile runs at one speed', () => {
    const report = checkProfileOrdering([
      { profile: 'desktop', medianMs: 100, requestedRate: 1 },
      { profile: 'tablet', medianMs: 100, requestedRate: 4 },
      { profile: 'phone', medianMs: 100, requestedRate: 6 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.pairs.filter((p) => !p.ok)).toHaveLength(2);
  });

  it('fails when the ordering is inverted', () => {
    const report = checkProfileOrdering([
      { profile: 'desktop', medianMs: 650, requestedRate: 1 },
      { profile: 'tablet', medianMs: 430, requestedRate: 4 },
      { profile: 'phone', medianMs: 100, requestedRate: 6 },
    ]);
    expect(report.ok).toBe(false);
  });

  it('fails when only the tablet is throttled', () => {
    const report = checkProfileOrdering([
      { profile: 'desktop', medianMs: 100, requestedRate: 1 },
      { profile: 'tablet', medianMs: 430, requestedRate: 4 },
      { profile: 'phone', medianMs: 430, requestedRate: 6 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.pairs.find((p) => p.slower === 'phone')?.ok).toBe(false);
    expect(report.pairs.find((p) => p.slower === 'tablet')?.ok).toBe(true);
  });

  it('fails when a profile reported no benchmark at all', () => {
    const report = checkProfileOrdering(throttled().filter((b) => b.profile !== 'phone'));
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['phone']);
  });

  it('fails when a run used a rate its profile does not declare', () => {
    const benchmarks = throttled();
    const report = checkProfileOrdering([
      ...benchmarks.filter((b) => b.profile !== 'tablet'),
      { profile: 'tablet', medianMs: 430, requestedRate: 2 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.rateMismatches[0]).toContain('tablet ran at rate 2');
  });

  it('fails on a non-positive baseline rather than dividing by zero', () => {
    const report = checkProfileOrdering([
      { profile: 'desktop', medianMs: 0, requestedRate: 1 },
      { profile: 'tablet', medianMs: 430, requestedRate: 4 },
      { profile: 'phone', medianMs: 650, requestedRate: 6 },
    ]);
    expect(report.ok).toBe(false);
    expect(report.pairs.some((p) => p.detail.includes('non-positive'))).toBe(true);
  });

  it('accepts a ratio exactly on the minimum', () => {
    const report = checkProfileOrdering([
      { profile: 'desktop', medianMs: 100, requestedRate: 1 },
      { profile: 'tablet', medianMs: 100 * MINIMUM_RATIOS.tabletOverDesktop, requestedRate: 4 },
      {
        profile: 'phone',
        medianMs: 100 * MINIMUM_RATIOS.tabletOverDesktop * MINIMUM_RATIOS.phoneOverTablet,
        requestedRate: 6,
      },
    ]);
    expect(report.ok).toBe(true);
  });

  it('keeps the required ratios well below the calibrated values and well above 1', () => {
    // Calibration measured 4.32x-4.82x for tablet and 1.40x-1.51x for phone.
    expect(MINIMUM_RATIOS.tabletOverDesktop).toBeGreaterThan(1);
    expect(MINIMUM_RATIOS.tabletOverDesktop).toBeLessThan(4.3);
    expect(MINIMUM_RATIOS.phoneOverTablet).toBeGreaterThan(1);
    expect(MINIMUM_RATIOS.phoneOverTablet).toBeLessThan(1.4);
  });
});

describe('formatOrderingReport', () => {
  it('says OK only when the report is ok', () => {
    expect(formatOrderingReport(checkProfileOrdering(throttled()))).toContain(
      'PROFILE ORDERING OK',
    );
  });

  it('says FAILED and names the collapsed pair', () => {
    const text = formatOrderingReport(
      checkProfileOrdering([
        { profile: 'desktop', medianMs: 100, requestedRate: 1 },
        { profile: 'tablet', medianMs: 100, requestedRate: 4 },
        { profile: 'phone', medianMs: 100, requestedRate: 6 },
      ]),
    );
    expect(text).toContain('PROFILE ORDERING FAILED');
    expect(text).toContain('below the required');
  });
});
