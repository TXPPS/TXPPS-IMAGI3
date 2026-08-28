import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  ALLOWLIST_FILENAME,
  evaluateIncidents,
  type ConsoleAllowEntry,
  type IncidentReport,
  type PageIncident,
} from '@imagi3/audit';
import { REPO_ROOT } from './config.ts';

const REJECTION_BRIDGE = '__imagi3OnUnhandledRejection';

function attachConsoleAndErrorListeners(page: Page, sink: PageIncident[]): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    sink.push({ kind: 'console-error', text: message.text(), origin: page.url() });
  });
  page.on('pageerror', (error) => {
    sink.push({ kind: 'page-error', text: error.message, origin: page.url() });
  });
}

/**
 * Unhandled promise rejections never reach Playwright's `pageerror` event, so
 * the page forwards them over an exposed binding instead.
 */
async function attachRejectionBridge(page: Page, sink: PageIncident[]): Promise<void> {
  await page.exposeFunction(REJECTION_BRIDGE, (text: string) => {
    sink.push({ kind: 'unhandled-rejection', text, origin: page.url() });
  });
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const reason: unknown = event.reason;
      const text = reason instanceof Error ? reason.message : String(reason);
      window.__imagi3OnUnhandledRejection?.(text);
    });
  });
}

/**
 * Capture every failure signal a page can emit. Must be called before the first
 * navigation. The returned array is appended to as the test runs.
 */
export async function installIncidentCapture(page: Page): Promise<PageIncident[]> {
  const incidents: PageIncident[] = [];
  attachConsoleAndErrorListeners(page, incidents);
  await attachRejectionBridge(page, incidents);
  return incidents;
}

export function loadAllowlist(): ConsoleAllowEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(REPO_ROOT, ALLOWLIST_FILENAME), 'utf8'));
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error(`${ALLOWLIST_FILENAME} must contain an "entries" array`);
  }
  return entries as ConsoleAllowEntry[];
}

export function judgeIncidents(incidents: readonly PageIncident[]): IncidentReport {
  return evaluateIncidents(incidents, loadAllowlist());
}

export function describeViolations(report: IncidentReport): string {
  return report.violations
    .map((v) => `  [${v.incident.kind}] ${v.incident.text} — ${v.reason}`)
    .join('\n');
}
