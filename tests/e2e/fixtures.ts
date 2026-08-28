import { test as base, expect, type Page } from '@playwright/test';
import { DEVICE_PROFILES, type DeviceProfile, type PageIncident } from '@imagi3/audit';
import { applyVerifiedCpuThrottling, type ThrottleVerification } from '@imagi3/repo';
import { describeViolations, installIncidentCapture, judgeIncidents } from './incidents.ts';

/** Opens a page that is guaranteed to carry this profile's CPU throttling. */
export type OpenThrottledPage = () => Promise<Page>;

/**
 * Throttling measured per page.
 *
 * A map rather than a fixture depending on a fixture: `page` must apply the
 * throttling, and `throttle` must report what `page` measured, which as two
 * mutually dependent fixtures is a cycle Playwright rejects outright.
 */
const verifiedThrottling = new WeakMap<Page, ThrottleVerification>();

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
  /** Throttling actually measured on the fixture page. */
  readonly throttle: ThrottleVerification;
  /**
   * Open an additional page carrying this profile's throttling.
   *
   * CDP throttling is per-page, so a page opened with `context.newPage()`
   * inherits nothing. Every such page in the suite is opened through here, and
   * pages are closed at teardown, so no spec has to remember either.
   */
  readonly openPage: OpenThrottledPage;
}

/**
 * Throttling verified for a page, or undefined if it was never verified.
 *
 * Exposed so a spec can demand evidence about the exact page it measured,
 * rather than trusting whatever opened it. The producer proving its own work is
 * how RC-0006 stayed invisible.
 */
export function throttlingFor(page: Page): ThrottleVerification | undefined {
  return verifiedThrottling.get(page);
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
   * Every page in every test carries its profile's CPU throttling, and proves
   * it: the rate is applied and then measured on the page itself.
   *
   * Overriding the built-in `page` fixture rather than throttling per-test is
   * deliberate — a per-test opt-in is a per-test opportunity to forget. That is
   * not hypothetical: the first version of this shipped throttling on the
   * fixture page only, while the cold-load spec measured pages it opened
   * itself, so every device-named budget was unthrottled. See RC-0006.
   */
  page: async ({ page, profile }, use) => {
    verifiedThrottling.set(page, await applyVerifiedCpuThrottling(page, profile.cpuThrottlingRate));
    await use(page);
  },

  throttle: async ({ page }, use) => {
    const verification = verifiedThrottling.get(page);
    if (verification === undefined) {
      throw new Error('the page fixture did not record its throttling verification');
    }
    await use(verification);
  },

  openPage: async ({ page, profile }, use) => {
    const opened: Page[] = [];
    const open: OpenThrottledPage = async () => {
      const fresh = await page.context().newPage();
      verifiedThrottling.set(
        fresh,
        await applyVerifiedCpuThrottling(fresh, profile.cpuThrottlingRate),
      );
      opened.push(fresh);
      return fresh;
    };
    await use(open);
    for (const fresh of opened) await fresh.close();
  },

  /**
   * Automatic, not opt-in.
   *
   * Playwright instantiates a fixture only for tests that destructure it, so
   * for as long as this was an ordinary fixture the console guard silently did
   * not run for any test that did not ask for it — nine of the thirteen specs
   * in this suite. The guard was not weak; for most of the suite it was absent,
   * and nothing said so. Found by the guard audit in docs/GATES.md.
   *
   * `auto` makes it run everywhere and makes opting out explicit, via
   * `allowIncidents`, which only the planted-fault proof sets. The proof that
   * it is still automatic is a test in that spec which does not destructure
   * this fixture and is expected to fail.
   */
  incidents: [
    async ({ page, allowIncidents }, use) => {
      const incidents = await installIncidentCapture(page);
      await use(incidents);
      if (allowIncidents) return;
      const report = judgeIncidents(incidents);
      expect(
        report.ok,
        `page emitted unallowlisted failure signals:\n${describeViolations(report)}`,
      ).toBe(true);
    },
    { auto: true },
  ],
});

export { expect };
