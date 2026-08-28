import { describe, expect, it } from 'vitest';
import { AllowlistConfigError, evaluateIncidents } from '../../src/console/allowlist.ts';
import type { ConsoleAllowEntry, PageIncident } from '../../src/console/types.ts';

const ENTRY: ConsoleAllowEntry = {
  pattern: 'ResizeObserver loop',
  justification: 'Benign browser notification with no user impact.',
  trackedBy: 'ADR-0007',
};

function incident(overrides: Partial<PageIncident> = {}): PageIncident {
  return { kind: 'console-error', text: 'boom', origin: 'test', ...overrides };
}

describe('evaluateIncidents', () => {
  it('passes when nothing happened', () => {
    expect(evaluateIncidents([], []).ok).toBe(true);
  });

  it('fails an unlisted console error', () => {
    const report = evaluateIncidents([incident()], []);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]!.reason).toContain('not covered');
  });

  it('allows a console error matching a justified entry', () => {
    const report = evaluateIncidents([incident({ text: 'ResizeObserver loop limit' })], [ENTRY]);
    expect(report.ok).toBe(true);
    expect(report.verdicts[0]!.matchedPattern).toBe(ENTRY.pattern);
    expect(report.verdicts[0]!.reason).toBe(ENTRY.justification);
  });

  it('never allows an uncaught exception, even with a matching pattern', () => {
    const report = evaluateIncidents(
      [incident({ kind: 'page-error', text: 'ResizeObserver loop limit' })],
      [ENTRY],
    );
    expect(report.ok).toBe(false);
    expect(report.violations[0]!.reason).toContain('never be allowlisted');
  });

  it('never allows an unhandled rejection', () => {
    const report = evaluateIncidents(
      [incident({ kind: 'unhandled-rejection', text: 'ResizeObserver loop limit' })],
      [ENTRY],
    );
    expect(report.ok).toBe(false);
  });

  it('rejects an allowlist entry without a justification', () => {
    expect(() => evaluateIncidents([], [{ ...ENTRY, justification: '  ' }])).toThrow(
      AllowlistConfigError,
    );
  });

  it('rejects an allowlist entry without a tracking reference', () => {
    expect(() => evaluateIncidents([], [{ ...ENTRY, trackedBy: '' }])).toThrow(
      AllowlistConfigError,
    );
  });

  it('rejects an invalid regular expression', () => {
    expect(() => evaluateIncidents([], [{ ...ENTRY, pattern: '([' }])).toThrow(
      AllowlistConfigError,
    );
  });
});
