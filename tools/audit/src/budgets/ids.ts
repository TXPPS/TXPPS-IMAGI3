import type { DeviceProfileId } from '../profiles.ts';

/**
 * Cold-load budget id per device profile.
 *
 * The desktop profile's id is deliberately not `editor.coldLoad.desktop`. That
 * profile runs unthrottled, so on a CI runner it measures the runner and
 * nothing else — naming it "desktop" would assert a device claim the harness
 * cannot support. The tablet and phone profiles run under calibrated CPU
 * throttling, which is still emulation but does carry a defensible signal, so
 * they keep their device names.
 *
 * See ADR-0011 and the DEVICE-VERIFIED register in docs/GATES.md, which holds
 * the real desktop claim as deferred.
 */
export const COLD_LOAD_BUDGET_IDS: Readonly<Record<DeviceProfileId, string>> = {
  desktop: 'ci-headless.editor.coldLoad',
  tablet: 'editor.coldLoad.tablet',
  phone: 'editor.coldLoad.phone',
};

/** Prefix marking a budget that runs unthrottled and carries no device signal. */
export const CI_HEADLESS_PREFIX = 'ci-headless.';

export function isCiHeadlessBudget(id: string): boolean {
  return id.startsWith(CI_HEADLESS_PREFIX);
}
