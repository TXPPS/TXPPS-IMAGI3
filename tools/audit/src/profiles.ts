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
}

const DESKTOP: DeviceProfile = {
  id: 'desktop',
  label: 'Desktop',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  hasTouch: false,
  isMobile: false,
};

const TABLET: DeviceProfile = {
  id: 'tablet',
  label: 'Tablet',
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

const PHONE: DeviceProfile = {
  id: 'phone',
  label: 'Phone',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
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
