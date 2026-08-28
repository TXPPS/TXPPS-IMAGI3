import { test as base, expect } from '@playwright/test';
import { DEVICE_PROFILES, type DeviceProfile, type PageIncident } from '@imagi3/audit';
import { applyCpuThrottling } from '@imagi3/repo';
import { describeViolations, installIncidentCapture, judgeIncidents } from './incidents.ts';

interface AuditFixtures {
  /** Live list of failure signals the page emitted during the test. */
  readonly incidents: PageIncident[];
  /**
   * Opt out of the automatic incident assertion. Only the planted-fault proof,
   * which deliberately provokes incidents, sets this.
   */
  readonly allowIncidents: boolean;
  /** Device profile this project emulates, resolved from the Playwright project name. */
  readonly profile: DeviceProfile;
}

export const test = base.extend<AuditFixtures>({
  allowIncidents: [false, { option: true }],

  // Playwright statically requires the destructuring form for a fixture's
  // first parameter, even when the fixture depends on nothing.
  // eslint-disable-next-line no-empty-pattern
  profile: async ({}, use, testInfo) => {
    const profile = DEVICE_PROFILES[testInfo.project.name as keyof typeof DEVICE_PROFILES];
    if (profile === undefined) {
      throw new Error(`Playwright project "${testInfo.project.name}" is not a device profile`);
    }
    await use(profile);
  },

  /**
   * Every page in every test carries its profile's CPU throttling.
   *
   * Overriding the built-in `page` fixture rather than throttling per-test is
   * deliberate: a per-test opt-in is a per-test opportunity to forget, and a
   * profile named for a phone that quietly runs at desktop speed measures
   * nothing. Fresh pages opened inside a test must call
   * `applyCpuThrottling` themselves — CDP throttling is per-page.
   */
  page: async ({ page, profile }, use) => {
    await applyCpuThrottling(page, profile.cpuThrottlingRate);
    await use(page);
  },

  incidents: async ({ page, allowIncidents }, use) => {
    const incidents = await installIncidentCapture(page);
    await use(incidents);
    if (allowIncidents) return;
    const report = judgeIncidents(incidents);
    expect(
      report.ok,
      `page emitted unallowlisted failure signals:\n${describeViolations(report)}`,
    ).toBe(true);
  },
});

export { expect };
