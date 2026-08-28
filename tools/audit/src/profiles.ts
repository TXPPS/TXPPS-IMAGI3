/**
 * Device profiles used by every layer of the audit system: Playwright E2E,
 * screenshot baselines, and per-profile performance budgets.
 *
 * These are EMULATED profiles. They validate layout and logic only. They are
 * not real iOS Safari or real Android hardware and prove nothing about memory
 * pressure, OPFS eviction, or GPU limits — see docs/GAPS.md.
 */

/** Stable identifiers for the three supported device classes. */
export const DEVICE_PROFILE_IDS = ['desktop', 'tablet', 'phone'] as const;

export type DeviceProfileId = (typeof DEVICE_PROFILE_IDS)[number];

/** Scope of a budget rule: one device class, or every device class. */
export type BudgetScope = DeviceProfileId | 'all';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface DeviceProfile {
  readonly id: DeviceProfileId;
  readonly label: string;
  readonly viewport: Viewport;
  readonly deviceScaleFactor: number;
  readonly hasTouch: boolean;
  readonly isMobile: boolean;
  /**
   * Multiplier passed to CDP `Emulation.setCPUThrottlingRate`. 1 is
   * unthrottled. See {@link CPU_THROTTLING} for how these were chosen.
   */
  readonly cpuThrottlingRate: number;
}

/**
 * CPU throttling rates, calibrated rather than guessed.
 *
 * Without throttling these profiles differ only in viewport, device pixel
 * ratio and touch emulation, so a budget named for a phone measures a
 * developer workstation. The evidence was unmissable: the phone profile
 * routinely measured *faster* than the desktop profile, because it was the
 * same machine.
 *
 * `pnpm calibrate:cpu` sweeps requested rates against the fixed arithmetic
 * benchmark in `bench/cpu.ts` and reports the slowdown each one actually
 * achieved. CDP takes a requested multiplier, not a guaranteed one, so the
 * achieved figure is what matters. On the reference host, 80M iterations:
 *
 * | requested | median ms | achieved |
 * | --------- | --------- | -------- |
 * | 1         | 102.7     | 1.00x    |
 * | 2         | 218.2     | 2.12x    |
 * | 3         | 328.0     | 3.19x    |
 * | 4         | 443.8     | 4.32x    |
 * | 5         | 548.9     | 5.34x    |
 * | 6         | 663.7     | 6.46x    |
 * | 8         | 853.8     | 8.31x    |
 *
 * Run-to-run variance on a shared host is roughly 10% — a repeat sweep gave
 * 4.82x and 6.76x for rates 4 and 6. Absolute slowdowns are host-dependent and
 * will differ again on a CI runner. What is host-independent, and therefore
 * what the harness asserts, is the *ordering*: see `bench/ordering.ts`.
 */
export const CPU_THROTTLING = {
  /** Unthrottled. The desktop profile makes no device claim; see ADR-0011. */
  desktop: 1,
  /** DevTools' mid-tier mobile preset; measured 4.32x-4.82x on the reference host. */
  tablet: 4,
  /** DevTools' low-tier mobile preset; measured 6.46x-6.76x on the reference host. */
  phone: 6,
} as const;

const DESKTOP: DeviceProfile = {
  id: 'desktop',
  label: 'Desktop',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
  cpuThrottlingRate: CPU_THROTTLING.desktop,
};

const TABLET: DeviceProfile = {
  id: 'tablet',
  label: 'Tablet',
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  cpuThrottlingRate: CPU_THROTTLING.tablet,
};

const PHONE: DeviceProfile = {
  id: 'phone',
  label: 'Phone',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  cpuThrottlingRate: CPU_THROTTLING.phone,
};

export const DEVICE_PROFILES: Readonly<Record<DeviceProfileId, DeviceProfile>> = {
  desktop: DESKTOP,
  tablet: TABLET,
  phone: PHONE,
};

/** All profiles in declaration order, for iterating test matrices. */
export const ALL_DEVICE_PROFILES: readonly DeviceProfile[] = DEVICE_PROFILE_IDS.map(
  (id) => DEVICE_PROFILES[id],
);

export function isDeviceProfileId(value: string): value is DeviceProfileId {
  return (DEVICE_PROFILE_IDS as readonly string[]).includes(value);
}
