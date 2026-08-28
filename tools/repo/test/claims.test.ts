import { describe, expect, it } from 'vitest';
import {
  formatClaimsReport,
  parseClaims,
  verifyClaim,
  verifyClaims,
  type Claim,
  type DiffOutcome,
  type DiffProbe,
} from '../src/claims.ts';

const SHA = '1946f48';

function claim(overrides: Partial<Claim> = {}): Claim {
  return { path: 'a/b.ts', commit: SHA, source: 'docs/GATES.md', line: 1, ...overrides };
}

const changed: DiffProbe = () => ({ kind: 'changed', summary: ' a/b.ts | 4 ++--' });
const unchanged: DiffProbe = () => ({ kind: 'unchanged' });
const errored: DiffProbe = () => ({ kind: 'error', message: 'bad object' });

describe('parseClaims', () => {
  it('finds a claim written inline in a sentence', () => {
    const claims = parseClaims(`The fix landed in file:packages/core/src/graph.ts @ ${SHA}.`, 'd');
    expect(claims).toEqual([
      { path: 'packages/core/src/graph.ts', commit: SHA, source: 'd', line: 1 },
    ]);
  });

  it('records the line so the failure names where to look', () => {
    expect(parseClaims(`a\nb\nfile:x.ts @ ${SHA}`, 'd')[0]?.line).toBe(3);
  });

  it('finds several claims on one line', () => {
    expect(parseClaims(`file:a.ts @ ${SHA} and file:b.ts @ abcdef1`, 'd')).toHaveLength(2);
  });

  it('tolerates spacing around the separator', () => {
    expect(parseClaims(`file:a.ts@${SHA}`, 'd')).toHaveLength(1);
  });

  it('stops the path at a table pipe, so a markdown cell parses', () => {
    expect(parseClaims(`| file:a.ts @ ${SHA} | done |`, 'd')[0]?.path).toBe('a.ts');
  });

  it('accepts a full-length sha', () => {
    const full = 'a'.repeat(40);
    expect(parseClaims(`file:a.ts @ ${full}`, 'd')[0]?.commit).toBe(full);
  });

  it('ignores prose that merely mentions a file', () => {
    expect(parseClaims('see packages/core/src/graph.ts for the repair', 'd')).toEqual([]);
  });

  it('ignores a claim with no commit behind it', () => {
    expect(parseClaims('file:packages/core/src/graph.ts', 'd')).toEqual([]);
  });

  it('ignores something that is not a sha', () => {
    expect(parseClaims('file:a.ts @ soon', 'd')).toEqual([]);
  });

  it('does not treat a short hex run as a sha', () => {
    expect(parseClaims('file:a.ts @ abc123', 'd')).toEqual([]);
  });
});

/**
 * The point of the ledger, stated as a test: a document may not describe an
 * edit that is not in the commit it names. This has happened three times, and
 * twice only a reviewer noticed.
 */
describe('verifyClaim', () => {
  it('passes a claim whose commit touches the path', () => {
    expect(verifyClaim(claim(), changed).ok).toBe(true);
  });

  it('fails a claim whose commit leaves the path untouched', () => {
    const verdict = verifyClaim(claim(), unchanged);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('does not touch');
  });

  it('fails rather than passes when git cannot answer', () => {
    // An unresolvable commit must not read as "nothing to check here".
    expect(verifyClaim(claim(), errored).ok).toBe(false);
  });

  it('reports what the commit did change, so a pass is inspectable', () => {
    expect(verifyClaim(claim(), changed).detail).toContain('a/b.ts');
  });
});

describe('verifyClaims', () => {
  it('is ok only when every claim is', () => {
    const mixed: DiffProbe = (_commit, path): DiffOutcome =>
      path === 'good.ts' ? { kind: 'changed', summary: 'x' } : { kind: 'unchanged' };
    const report = verifyClaims([claim({ path: 'good.ts' }), claim({ path: 'bad.ts' })], mixed);
    expect(report.ok).toBe(false);
    expect(report.verdicts.filter((v) => v.ok)).toHaveLength(1);
  });

  it('is ok for a document making no claims, which is not a failure', () => {
    expect(verifyClaims([], unchanged).ok).toBe(true);
  });

  it('checks every claim rather than stopping at the first failure', () => {
    const report = verifyClaims([claim(), claim(), claim()], unchanged);
    expect(report.verdicts).toHaveLength(3);
  });
});

describe('formatClaimsReport', () => {
  it('names the document and line of a failing claim', () => {
    const text = formatClaimsReport(verifyClaims([claim({ line: 42 })], unchanged));
    expect(text).toContain('docs/GATES.md:42');
    expect(text).toContain('CLAIMS FAILED');
  });

  it('says how many it verified when they all hold', () => {
    expect(formatClaimsReport(verifyClaims([claim()], changed))).toContain('CLAIMS OK: 1');
  });
});
