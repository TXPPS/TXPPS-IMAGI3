import { DEVICE_PROFILE_IDS, DEVICE_PROFILES, type DeviceProfileId } from '../profiles.ts';

/**
 * One profile's result from the fixed arithmetic benchmark.
 *
 * Deliberately not a performance *budget*: the absolute figure is
 * host-dependent and says nothing about any real device. It exists so the
 * harness can verify that CPU throttling is actually in effect.
 */
export interface ProfileBenchmark {
  readonly profile: DeviceProfileId;
  readonly medianMs: number;
  /** Rate requested of CDP, recorded so a mismatch with the profile is visible. */
  readonly requestedRate: number;
}

/**
 * Minimum ratio between adjacent profiles.
 *
 * Derived from the calibration in `profiles.ts`, then cut well below it so
 * scheduler noise on a slower CI runner cannot produce a false failure, while
 * staying far above 1.0 so removing throttling cannot produce a false pass:
 *
 * | pair              | expected | required | on removal |
 * | ----------------- | -------- | -------- | ---------- |
 * | tablet / desktop  | 4.82x    | 2.0x     | ~1.0x      |
 * | phone / tablet    | 1.40x    | 1.15x    | ~1.0x      |
 *
 * The absolute slowdown varies by host. The ordering does not, which is why it
 * is the property worth asserting in CI.
 */
export const MINIMUM_RATIOS = {
  tabletOverDesktop: 2.0,
  phoneOverTablet: 1.15,
} as const;

interface RequiredPair {
  readonly slower: DeviceProfileId;
  readonly faster: DeviceProfileId;
  readonly minimumRatio: number;
}

const REQUIRED_PAIRS: readonly RequiredPair[] = [
  { slower: 'tablet', faster: 'desktop', minimumRatio: MINIMUM_RATIOS.tabletOverDesktop },
  { slower: 'phone', faster: 'tablet', minimumRatio: MINIMUM_RATIOS.phoneOverTablet },
];

export interface PairResult {
  readonly slower: DeviceProfileId;
  readonly faster: DeviceProfileId;
  readonly minimumRatio: number;
  readonly observedRatio?: number | undefined;
  readonly ok: boolean;
  readonly detail: string;
}

export interface OrderingReport {
  readonly ok: boolean;
  readonly pairs: readonly PairResult[];
  /** Profiles that reported no benchmark at all. */
  readonly missing: readonly DeviceProfileId[];
  /** Profiles whose reported rate disagrees with their declared rate. */
  readonly rateMismatches: readonly string[];
}

const RATIO_DECIMALS = 2;

function evaluatePair(
  pair: RequiredPair,
  byProfile: ReadonlyMap<DeviceProfileId, ProfileBenchmark>,
): PairResult {
  const slower = byProfile.get(pair.slower);
  const faster = byProfile.get(pair.faster);
  if (slower === undefined || faster === undefined) {
    return {
      ...pair,
      observedRatio: undefined,
      ok: false,
      detail: `no benchmark reported for ${slower === undefined ? pair.slower : pair.faster}`,
    };
  }
  if (faster.medianMs <= 0) {
    return {
      ...pair,
      observedRatio: undefined,
      ok: false,
      detail: `${pair.faster} reported a non-positive time`,
    };
  }

  const observedRatio = slower.medianMs / faster.medianMs;
  const ok = observedRatio >= pair.minimumRatio;
  return {
    ...pair,
    observedRatio,
    ok,
    detail:
      `${pair.slower} took ${observedRatio.toFixed(RATIO_DECIMALS)}x the time of ${pair.faster} ` +
      `(${slower.medianMs.toFixed(1)}ms vs ${faster.medianMs.toFixed(1)}ms), ` +
      `${ok ? 'at or above' : 'below'} the required ${pair.minimumRatio.toFixed(RATIO_DECIMALS)}x`,
  };
}

function findRateMismatches(benchmarks: readonly ProfileBenchmark[]): string[] {
  return benchmarks
    .filter((b) => b.requestedRate !== DEVICE_PROFILES[b.profile].cpuThrottlingRate)
    .map(
      (b) =>
        `${b.profile} ran at rate ${String(b.requestedRate)} but its profile declares ` +
        String(DEVICE_PROFILES[b.profile].cpuThrottlingRate),
    );
}

/**
 * Verify that CPU throttling is actually in effect.
 *
 * This is the mutation test for the throttling itself. If
 * `Emulation.setCPUThrottlingRate` stops being applied — removed, silently
 * failing, or unsupported by a future browser — every ratio collapses toward
 * 1.0 and this fails. Without it, a profile named "phone" could go on
 * measuring a developer workstation, which is exactly the state GAP-006
 * recorded at the end of P0.
 */
export function checkProfileOrdering(benchmarks: readonly ProfileBenchmark[]): OrderingReport {
  const byProfile = new Map(benchmarks.map((b) => [b.profile, b]));
  const missing = DEVICE_PROFILE_IDS.filter((id) => !byProfile.has(id));
  const pairs = REQUIRED_PAIRS.map((pair) => evaluatePair(pair, byProfile));
  const rateMismatches = findRateMismatches(benchmarks);

  return {
    ok: missing.length === 0 && rateMismatches.length === 0 && pairs.every((p) => p.ok),
    pairs,
    missing,
    rateMismatches,
  };
}

export function formatOrderingReport(report: OrderingReport): string {
  const lines = ['Profile ordering (CPU throttling verification)'];
  for (const pair of report.pairs) {
    lines.push(`  ${pair.ok ? 'PASS ' : 'FAIL '} ${pair.detail}`);
  }
  for (const profile of report.missing) {
    lines.push(`  MISS  ${profile} reported no benchmark`);
  }
  for (const mismatch of report.rateMismatches) {
    lines.push(`  FAIL  ${mismatch}`);
  }
  lines.push('', report.ok ? 'PROFILE ORDERING OK' : 'PROFILE ORDERING FAILED');
  return lines.join('\n');
}
