import { describe, expect, it } from 'vitest';
import { MUTANT_KINDS, applyMutant, enumerateMutants } from '../src/mutants/enumerate.ts';
import {
  checkRatchet,
  formatRatchet,
  killRatio,
  type CoverageBaseline,
} from '../src/mutants/baseline.ts';

/**
 * Enumeration is the floor the hand-picked list is not.
 *
 * Both holes the first sweep found were in packages three reviewers had called
 * well-guarded after choosing 22 mutations themselves. What was missing was not
 * better judgement, it was the absence of judgement — so these tests hold the
 * enumerator to covering every export rather than to covering the interesting
 * ones.
 */

const SAMPLE = `
export function keep(list: number[]): number[] {
  return list.sort((a, b) => a - b);
}

function notExported(x: number): number {
  return x * 2;
}

export const arrow = (value: string): string => {
  if (value.length > 0) {
    return value.trim();
  }
  return value;
};

export const concise = (n: number): number => n + 1;
`;

describe('enumerateMutants', () => {
  const mutants = enumerateMutants('sample.ts', SAMPLE);

  it('covers every exported function with a block body', () => {
    const targets = new Set(mutants.map((m) => m.target));
    expect(targets.has('keep')).toBe(true);
    expect(targets.has('arrow')).toBe(true);
  });

  it('ignores functions that are not exported', () => {
    // A non-exported helper is reachable only through an export, which is
    // already enumerated. Mutating both would double-count the same surface.
    expect(mutants.some((m) => m.target === 'notExported')).toBe(false);
  });

  it('ignores a concise arrow body, which has no statements to empty', () => {
    expect(mutants.some((m) => m.target === 'concise')).toBe(false);
  });

  it.each(['empty-body', 'constant-return', 'identity-return'] as const)(
    'generates a %s mutant for an exported function',
    (kind) => {
      expect(mutants.some((m) => m.target === 'keep' && m.kind === kind)).toBe(true);
    },
  );

  it('generates no identity-return for a function with no parameters', () => {
    const none = enumerateMutants('x.ts', 'export function f(): number { return 1; }');
    expect(none.some((m) => m.kind === 'identity-return')).toBe(false);
    expect(none.some((m) => m.kind === 'empty-body')).toBe(true);
  });

  it('finds sorts, filters and predicates', () => {
    expect(mutants.some((m) => m.kind === 'removed-sort')).toBe(true);
    expect(mutants.some((m) => m.kind === 'inverted-predicate')).toBe(true);
    const filtered = enumerateMutants(
      'x.ts',
      'export function f(a: number[]) { return a.filter(Boolean); }',
    );
    expect(filtered.some((m) => m.kind === 'removed-filter')).toBe(true);
  });

  it('drops the last argument only of a multi-argument call', () => {
    const many = enumerateMutants('x.ts', 'export function f(a: number) { return g(a, 1, 2); }');
    expect(many.some((m) => m.kind === 'dropped-argument')).toBe(true);
    // A single-argument call loses its arity and usually throws at once, which
    // is a kill that says nothing about whether the value was guarded.
    const one = enumerateMutants('x.ts', 'export function f(a: number) { return g(a); }');
    expect(one.some((m) => m.kind === 'dropped-argument')).toBe(false);
  });

  it('gives every mutant a unique id', () => {
    const ids = mutants.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names only known kinds', () => {
    for (const mutant of mutants) {
      expect(MUTANT_KINDS as readonly string[]).toContain(mutant.kind);
    }
  });

  it('returns mutants in descending offset order', () => {
    const starts = mutants.map((m) => m.start);
    expect([...starts].sort((a, b) => b - a)).toEqual(starts);
  });

  it('produces no mutant for an empty file', () => {
    expect(enumerateMutants('x.ts', '')).toEqual([]);
  });
});

describe('applyMutant', () => {
  const mutants = enumerateMutants('sample.ts', SAMPLE);

  it('changes the source', () => {
    for (const mutant of mutants) {
      expect(applyMutant(SAMPLE, mutant), `${mutant.id} changed nothing`).not.toBe(SAMPLE);
    }
  });

  it('empties the body it targets', () => {
    const empty = mutants.find((m) => m.target === 'keep' && m.kind === 'empty-body');
    expect(empty).toBeDefined();
    expect(applyMutant(SAMPLE, empty!)).toContain(
      'export function keep(list: number[]): number[] {',
    );
    expect(applyMutant(SAMPLE, empty!)).not.toContain('return list.sort');
  });

  it('removes the sort while keeping the receiver', () => {
    const sort = mutants.find((m) => m.kind === 'removed-sort');
    expect(sort).toBeDefined();
    expect(applyMutant(SAMPLE, sort!)).toContain('return list;');
  });

  it('inverts the predicate it targets', () => {
    const predicate = mutants.find((m) => m.kind === 'inverted-predicate');
    expect(predicate).toBeDefined();
    expect(applyMutant(SAMPLE, predicate!)).toContain('!(value.length > 0)');
  });
});

/**
 * The ratchet. Its job is not to demand perfection — a required ratio of 1
 * produces assertions written to satisfy the ratchet — but to forbid going
 * backwards, and to make new unguarded code lower the number automatically.
 */
describe('checkRatchet', () => {
  const baseline: CoverageBaseline = {
    packages: { 'packages/core': { enumerated: 100, killed: 90 } },
    recordedAt: 'test',
  };

  it('accepts an unchanged measurement', () => {
    expect(checkRatchet(baseline, { 'packages/core': { enumerated: 100, killed: 90 } }).ok).toBe(
      true,
    );
  });

  it('accepts improved coverage', () => {
    expect(checkRatchet(baseline, { 'packages/core': { enumerated: 100, killed: 95 } }).ok).toBe(
      true,
    );
  });

  it('rejects a lost kill', () => {
    expect(checkRatchet(baseline, { 'packages/core': { enumerated: 100, killed: 89 } }).ok).toBe(
      false,
    );
  });

  /**
   * The case the ratchet exists for: new code enters the enumeration by
   * existing, and if it is unguarded the ratio falls even though nothing was
   * un-tested. Nobody has to remember to register anything.
   */
  it('rejects new unguarded exports, even with no kills lost', () => {
    const report = checkRatchet(baseline, { 'packages/core': { enumerated: 120, killed: 90 } });
    expect(report.ok).toBe(false);
    expect(report.verdicts[0]?.detail).toContain('unguarded');
  });

  it('accepts new exports that are guarded', () => {
    expect(checkRatchet(baseline, { 'packages/core': { enumerated: 120, killed: 110 } }).ok).toBe(
      true,
    );
  });

  it('rejects a package the baseline does not know', () => {
    const report = checkRatchet(baseline, {
      'packages/core': { enumerated: 100, killed: 90 },
      'packages/new': { enumerated: 10, killed: 10 },
    });
    expect(report.ok).toBe(false);
    expect(report.verdicts.find((v) => v.package === 'packages/new')?.detail).toContain(
      'not in the baseline',
    );
  });

  it('rejects a package that vanished from the measurement', () => {
    // Otherwise deleting a package's tests and its entry would read as a pass.
    expect(checkRatchet(baseline, {}).ok).toBe(false);
  });

  it('reports every package, not just the first failure', () => {
    const two: CoverageBaseline = {
      packages: { a: { enumerated: 10, killed: 10 }, b: { enumerated: 10, killed: 10 } },
      recordedAt: 'test',
    };
    const report = checkRatchet(two, {
      a: { enumerated: 10, killed: 9 },
      b: { enumerated: 10, killed: 8 },
    });
    expect(report.verdicts.filter((v) => !v.ok)).toHaveLength(2);
  });
});

describe('killRatio', () => {
  it('is the killed fraction', () => {
    expect(killRatio({ enumerated: 4, killed: 3 })).toBe(0.75);
  });

  it('is 1 for a package with nothing in it', () => {
    // Reporting 0 would fail the ratchet for a package not yet written.
    expect(killRatio({ enumerated: 0, killed: 0 })).toBe(1);
  });
});

describe('formatRatchet', () => {
  it('says which package lost coverage', () => {
    const baseline: CoverageBaseline = {
      packages: { 'packages/core': { enumerated: 10, killed: 10 } },
      recordedAt: 'test',
    };
    const text = formatRatchet(
      checkRatchet(baseline, { 'packages/core': { enumerated: 10, killed: 5 } }),
    );
    expect(text).toContain('packages/core');
    expect(text).toContain('RATCHET FAILED');
  });

  it('reports a clean run', () => {
    expect(formatRatchet({ ok: true, verdicts: [] })).toContain('RATCHET OK');
  });
});
