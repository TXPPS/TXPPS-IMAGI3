// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_MUTATION,
  MUTATIONS,
  formatMutationReport,
  judgeMutations,
  matchedExpectation,
  type Mutation,
  type MutationOutcome,
} from '../src/mutations.ts';
import { unguardedForControl } from '../src/unguarded.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function outcome(mutation: Mutation, killed: boolean): MutationOutcome {
  return { mutation, killed, detail: killed ? 'a test failed' : 'no test noticed' };
}

function fake(expect_: Mutation['expect']): Mutation {
  return {
    id: `fake.${expect_}`,
    file: 'x.ts',
    find: 'a',
    replace: 'b',
    breaks: 'nothing',
    suite: 'unit',
    expect: expect_,
  };
}

/**
 * The sweep's own anchors rot the same way any exact-string replacement does —
 * that is RC-0005. A mutation whose `find` no longer matches is not a survivor
 * and not a kill; it is a mutation testing nothing, and it must be visible as
 * an error rather than as either verdict.
 */
describe('mutation anchors', () => {
  /**
   * The control is excluded, and the reason is the interesting part.
   *
   * Any test that *reads* a file is killed by that file's mutation — which is
   * what you want for production code and fatal for a control, whose entire job
   * is to survive. Including `CONTROL_MUTATION` here made it read as killed:
   * with `return value;` in the file, the anchor `return value * 2;` is gone
   * and this assertion fails.
   *
   * Nothing is lost. `runMutation` checks the same anchor at sweep time and
   * throws — loudly, and distinguishably from either verdict — so the control's
   * anchor is verified where verifying it does not destroy it.
   */
  it.each(MUTATIONS.map((m) => [m.id, m] as const))(
    '%s anchors to exactly one place in its file',
    (_id, mutation) => {
      const contents = readFileSync(join(REPO_ROOT, mutation.file), 'utf8');
      const occurrences = contents.split(mutation.find).length - 1;
      expect(occurrences, `${mutation.id}: the code moved; update the mutation`).toBe(1);
    },
  );

  it('changes the file it is applied to', () => {
    // A `replace` equal to its `find` would run the whole suite to prove
    // nothing, and would read as a coverage hole in whatever it was aimed at.
    for (const mutation of [...MUTATIONS, CONTROL_MUTATION]) {
      expect(mutation.replace, `${mutation.id} replaces text with itself`).not.toBe(mutation.find);
    }
  });

  it('gives every mutation a stated consequence', () => {
    for (const mutation of MUTATIONS) {
      expect(mutation.breaks.length, `${mutation.id} does not say what it breaks`).toBeGreaterThan(
        10,
      );
    }
  });

  it('uses unique ids, so a report cannot name two things', () => {
    const ids = [...MUTATIONS, CONTROL_MUTATION].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers both core and runtime', () => {
    // The brief names these two packages. A sweep that quietly stopped covering
    // one would still report OK.
    const files = MUTATIONS.map((m) => m.file);
    expect(files.some((f) => f.startsWith('packages/core/'))).toBe(true);
    expect(files.some((f) => f.startsWith('packages/runtime/'))).toBe(true);
  });

  it('keeps the three mutations that were proven decisive against this codebase', () => {
    const ids = MUTATIONS.map((m) => m.id);
    expect(ids).toContain('render.present.noop');
    expect(ids).toContain('render.pixelRatio.halved');
    expect(ids).toContain('runtime.systemOrder.reversed');
  });
});

/**
 * The verdict is "did the outcome match the expectation", not "was it killed".
 * The first version had only the latter and reported a correct inverse control
 * as a coverage hole.
 */
describe('judgeMutations', () => {
  it('accepts a defect mutation that was killed', () => {
    expect(judgeMutations([outcome(fake('killed'), true)]).ok).toBe(true);
  });

  it('rejects a defect mutation that survived', () => {
    expect(judgeMutations([outcome(fake('killed'), false)]).ok).toBe(false);
  });

  it('accepts an inverse control that survived', () => {
    expect(judgeMutations([outcome(fake('survives'), false)]).ok).toBe(true);
  });

  it('rejects an inverse control that was killed', () => {
    // A test sensitive to something the measurement claims to exclude.
    expect(judgeMutations([outcome(fake('survives'), true)]).ok).toBe(false);
  });

  it('reports every unexpected outcome, not just the first', () => {
    const report = judgeMutations([
      outcome(fake('killed'), false),
      outcome(fake('survives'), true),
      outcome(fake('killed'), true),
    ]);
    expect(report.unexpected).toHaveLength(2);
  });

  it('is ok for an empty sweep, which reports nothing rather than passing', () => {
    expect(judgeMutations([]).ok).toBe(true);
  });
});

describe('matchedExpectation', () => {
  it.each([
    ['killed', true, true],
    ['killed', false, false],
    ['survives', false, true],
    ['survives', true, false],
  ] as const)('expect %s, killed %s -> %s', (expected, killed, matched) => {
    expect(matchedExpectation(outcome(fake(expected), killed))).toBe(matched);
  });
});

describe('formatMutationReport', () => {
  it('names a survivor and what it breaks', () => {
    const text = formatMutationReport(judgeMutations([outcome(MUTATIONS[0]!, false)]));
    expect(text).toContain(MUTATIONS[0]!.id);
    expect(text).toContain('coverage hole');
  });

  it('explains a killed inverse control differently from a survivor', () => {
    const text = formatMutationReport(judgeMutations([outcome(fake('survives'), true)]));
    expect(text).toContain('inverse control');
    expect(text).toContain('RC-0011');
  });

  it('marks an inverse control in the listing so a survivor reads correctly', () => {
    const text = formatMutationReport(judgeMutations([outcome(fake('survives'), false)]));
    expect(text).toContain('(inverse control)');
    expect(text).toContain('MUTATION SWEEP OK');
  });
});

describe('the positive control', () => {
  it('is deliberately unguarded, and this is the only test that touches it', () => {
    // Asserting the value would guard it and destroy the control. Asserting
    // that it is callable does not: the mutation changes what it returns, and
    // nothing here looks at the return.
    expect(typeof unguardedForControl).toBe('function');
  });

  it('expects to survive, so a clean sweep can still be shown to report one', () => {
    expect(CONTROL_MUTATION.expect).toBe('survives');
  });
});
