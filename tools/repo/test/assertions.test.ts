import { describe, expect, it } from 'vitest';
import {
  findAssertions,
  formatAssertionReport,
  isExemptFile,
  verifyAssertions,
} from '../src/assertions.ts';

/**
 * RC-0010: two doc comments asserted runtime properties that were false, and
 * the claims ledger could not see it because a commit had touched both files.
 * This checks the other half — that a sentence claiming a runtime property
 * names something a program can look for.
 */

const resolveAll = (): boolean => true;
const resolveNone = (): boolean => false;

describe('findAssertions', () => {
  it.each([
    ['runs today', ' * The comparison runs today: two renders are compared.'],
    ['is wired', ' * The WebGPU leg is wired behind a dynamic import.'],
    ['covered by', ' * The exit contract is covered by tests.'],
    ['verified in CI', ' * Throttling is verified in CI on every run.'],
    ['exercised by', ' * The migration path is exercised by every load.'],
    ['enforced by', ' * The floor is enforced by the budget gate.'],
  ])('finds an unbacked "%s"', (_verb, line) => {
    const sites = findAssertions('x.ts', line);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.reference).toBeUndefined();
  });

  it('accepts an assertion backed by a path on the same line', () => {
    const sites = findAssertions('x.ts', ' * is covered by tools/audit/test/budgets/gate.test.ts');
    expect(sites).toHaveLength(1);
    expect(sites[0]?.reference).toBe('tools/audit/test/budgets/gate.test.ts');
  });

  it('accepts a reference on a following line, since formatters wrap', () => {
    const text = ' * The exit contract is covered by\n * `tools/audit/test/budgets/gate.test.ts`.';
    expect(findAssertions('x.ts', text)[0]?.reference).toBeDefined();
  });

  it('accepts a test name as a reference', () => {
    expect(findAssertions('x.ts', ' * is wired — test: renderer parity')[0]?.reference).toContain(
      'test:',
    );
  });

  it('ignores prose with no assertion verb', () => {
    expect(findAssertions('x.ts', ' * This module draws entity snapshots.')).toEqual([]);
  });

  /**
   * A quotation reports what someone else claimed. The incident write-ups in
   * docs/BUGS.md quote the exact false sentences they exist to record, and
   * flagging those would make the history unwritable.
   */
  it('ignores a markdown blockquote', () => {
    expect(findAssertions('d.md', '> The comparison runs today.')).toEqual([]);
  });

  it('ignores an indented blockquote', () => {
    expect(findAssertions('d.md', '   > The leg is wired.')).toEqual([]);
  });

  it('ignores an assertion inside quotation marks', () => {
    expect(findAssertions('d.md', 'The header said "the leg is wired" and it was not.')).toEqual(
      [],
    );
  });

  it('still catches an assertion outside the quotes on the same line', () => {
    const line = 'It said "something else" and the harness is wired.';
    expect(findAssertions('d.md', line)).toHaveLength(1);
  });

  it('reports the line number', () => {
    expect(findAssertions('x.ts', 'a\nb\n * runs today')[0]?.line).toBe(3);
  });

  it('exempts the file that defines the vocabulary', () => {
    // Otherwise every pattern is reported as an assertion about itself.
    expect(isExemptFile('tools/repo/src/assertions.ts')).toBe(true);
    expect(isExemptFile('tools/repo/test/assertions.test.ts')).toBe(true);
    expect(isExemptFile('packages/core/src/graph.ts')).toBe(false);
  });

  it('exempts by exact path, not by filename', () => {
    // The exemption was a filename pattern, so any file named `assertions.ts`
    // anywhere was exempt — the filename-shaped opt-out this checker's own
    // docstring rules out. Found by QA Automation at the P1 gate.
    expect(isExemptFile('packages/core/src/assertions.ts')).toBe(false);
    expect(isExemptFile('apps/editor/src/schema/assertions.test.ts')).toBe(false);
  });

  it('still catches an assertion outside the quotes on a quoted line', () => {
    // The previous version skipped the whole line once anything on it was
    // quoted, so this produced no site at all — while its comment claimed
    // "only the quoted span is exempt". RC-0010's own sentence, hidden behind
    // an unrelated quotation.
    const line = ' * A note said "is wired"; the WebGPU leg runs today.';
    const sites = findAssertions('x.ts', line);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.verb).toBe('runs today');
  });

  it('still exempts a verb that is only inside quotes', () => {
    expect(
      findAssertions('x.ts', ' * The comment said "the leg is wired" and it was not.'),
    ).toEqual([]);
  });
});

describe('verifyAssertions', () => {
  const unbacked = findAssertions('x.ts', ' * The leg is wired.');
  const backed = findAssertions('x.ts', ' * is wired — see tests/e2e/render.spec.ts');

  it('fails an assertion with nothing checkable', () => {
    expect(verifyAssertions(unbacked, resolveAll).ok).toBe(false);
  });

  it('says what to do about it', () => {
    expect(verifyAssertions(unbacked, resolveAll).verdicts[0]?.detail).toContain('RC-0010');
  });

  /**
   * The case that occurred: `parity.ts` cited `tests/e2e/parity.spec.ts`, a
   * file that has never existed. RC-0010 recurring inside the fix for RC-0010,
   * caught by this checker's first run.
   */
  it('fails a reference naming something that does not exist', () => {
    const report = verifyAssertions(backed, resolveNone);
    expect(report.ok).toBe(false);
    expect(report.verdicts[0]?.detail).toContain('does not exist');
  });

  it('passes an assertion whose reference resolves', () => {
    expect(verifyAssertions(backed, resolveAll).ok).toBe(true);
  });

  it('is ok when there is nothing to check', () => {
    expect(verifyAssertions([], resolveAll).ok).toBe(true);
  });
});

describe('formatAssertionReport', () => {
  it('names the file and line of a failure', () => {
    const text = formatAssertionReport(
      verifyAssertions(findAssertions('a/b.ts', ' * is wired.'), resolveAll),
    );
    expect(text).toContain('a/b.ts:1');
    expect(text).toContain('ASSERTIONS FAILED');
  });

  it('counts what it verified when everything holds', () => {
    const sites = findAssertions('x.ts', ' * is wired — tests/e2e/render.spec.ts');
    expect(formatAssertionReport(verifyAssertions(sites, resolveAll))).toContain('ASSERTIONS OK');
  });
});
