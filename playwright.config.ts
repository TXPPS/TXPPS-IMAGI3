import { defineConfig, devices } from '@playwright/test';
import { ALL_DEVICE_PROFILES } from '@imagi3/audit';
import { DEV_BASE_URL, DEV_PORT, PREVIEW_BASE_URL, PREVIEW_PORT } from './tests/e2e/config.ts';

const SERVER_START_TIMEOUT_MS = 180_000;
const EXPECT_TIMEOUT_MS = 10_000;
const CI_WORKERS = 2;
const IS_CI = process.env['CI'] !== undefined;

/**
 * One Playwright project per emulated device profile. The profiles come from
 * `@imagi3/audit` so the E2E matrix, the budget scopes and the screenshot
 * baseline layout can never drift apart.
 *
 * All projects run on Chromium: it is the only browser provisioned in this
 * environment. Real iOS Safari and real Android coverage are tracked in
 * docs/GAPS.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './.audit-out/playwright',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: 0,
  ...(IS_CI ? { workers: CI_WORKERS } : {}),
  reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  expect: { timeout: EXPECT_TIMEOUT_MS },
  use: {
    baseURL: PREVIEW_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  projects: ALL_DEVICE_PROFILES.map((profile) => ({
    name: profile.id,
    use: {
      ...devices['Desktop Chrome'],
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.hasTouch,
      isMobile: profile.isMobile,
    },
  })),
  webServer: [
    {
      command: `pnpm --filter @imagi3/editor run build && pnpm --filter @imagi3/editor exec vite preview --port ${String(PREVIEW_PORT)} --strictPort`,
      url: PREVIEW_BASE_URL,
      // Never reused: the command rebuilds before previewing, so an existing
      // listener would silently serve — and be measured as — an older build.
      reuseExistingServer: false,
      timeout: SERVER_START_TIMEOUT_MS,
      stdout: 'pipe',
    },
    {
      command: `pnpm --filter @imagi3/editor exec vite --port ${String(DEV_PORT)} --strictPort`,
      url: DEV_BASE_URL,
      reuseExistingServer: !IS_CI,
      timeout: SERVER_START_TIMEOUT_MS,
      stdout: 'pipe',
    },
  ],
});
