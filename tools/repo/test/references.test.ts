import { describe, expect, it } from 'vitest';
import {
  MIN_REFERENCE_NAME,
  TEST_FILE,
  WORKFLOW_FILE,
  jobNamesIn,
  referenceKind,
  referenceName,
  resolvesAgainst,
  testTitlesIn,
} from '../src/references.ts';

/**
 * The bypasses QA Automation demonstrated at the P1 gate, and the shape that
 * admitted them.
 *
 * `test: e` and `ci: a` both resolved, because a reference was matched as a
 * substring against whole file contents. Every assertion in the repository was
 * therefore backed by the observation that the letter `e` occurs in it, and
 * `verify:assertions` printed OK.
 */
describe('resolvesAgainst', () => {
  const titles = ['keeps engine CPU inside the tablet budget', 'draws the reference scene'];

  it('resolves a name that identifies a title', () => {
    expect(resolvesAgainst('test: keeps engine CPU', titles)).toBe(true);
  });

  it('rejects a one-letter name', () => {
    expect(resolvesAgainst('test: e', titles)).toBe(false);
  });

  it('rejects any name below the floor, however well it matches', () => {
    // "draws" is a real substring of a real title and still cannot name it.
    expect(resolvesAgainst('test: draws', titles)).toBe(false);
    expect('draws'.length).toBeLessThan(MIN_REFERENCE_NAME);
  });

  it('rejects a name that matches nothing', () => {
    expect(resolvesAgainst('test: renders the inventory panel', titles)).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(resolvesAgainst('test:', titles)).toBe(false);
    expect(resolvesAgainst('test:    ', titles)).toBe(false);
  });
});

describe('testTitlesIn', () => {
  it('reads titles out of the declarations, not the whole file', () => {
    const source = [
      "import { thing } from './thing.ts';",
      "describe('the tick loop', () => {",
      "  it('advances by exactly one step', () => {});",
      '  // a comment mentioning advances by exactly two steps',
      '});',
    ].join('\n');
    expect(testTitlesIn(source)).toEqual(['the tick loop', 'advances by exactly one step']);
  });

  it('reads each quote style', () => {
    const source = ['it("double quoted", () => {});', 'it(`back ticked`, () => {});'].join('\n');
    expect(testTitlesIn(source)).toEqual(['double quoted', 'back ticked']);
  });

  it('reads a modified declaration', () => {
    expect(testTitlesIn("it.each([1])('parameterised %s', () => {});")).toEqual([
      'parameterised %s',
    ]);
  });

  it('does not read a name out of prose', () => {
    // The whole point: a comment is not a declaration.
    expect(testTitlesIn('// it advances by exactly one step')).toEqual([]);
  });
});

describe('jobNamesIn', () => {
  it('reads job ids and job names', () => {
    const workflow = [
      'name: CI',
      'jobs:',
      '  verify-claims:',
      '    name: Verify the claims ledger',
      '    runs-on: ubuntu-latest',
      '  mutation-sweep:',
      '    runs-on: ubuntu-latest',
    ].join('\n');
    expect(jobNamesIn(workflow)).toContain('verify-claims');
    expect(jobNamesIn(workflow)).toContain('mutation-sweep');
    expect(jobNamesIn(workflow)).toContain('Verify the claims ledger');
  });

  it('does not read a step name as a job at the wrong indent', () => {
    // Job ids sit at exactly two spaces. A deeper key is a step or a `with:`.
    expect(jobNamesIn('    some-step:\n')).toEqual([]);
  });
});

describe('reference shapes', () => {
  it.each([
    ['test: a thing', 'test'],
    ['ci: a job', 'ci'],
    ['tests/e2e/render.spec.ts', undefined],
    ['packages/core/src/graph.ts', undefined],
  ] as const)('classifies %s', (reference, kind) => {
    expect(referenceKind(reference)).toBe(kind);
  });

  it('trims the name', () => {
    expect(referenceName('test:   spaced out   ')).toBe('spaced out');
  });
});

describe('file selectors', () => {
  it.each(['packages/core/test/graph.test.ts', 'tests/e2e/render.spec.ts'])(
    'recognises %s as a test file',
    (path) => {
      expect(TEST_FILE.test(path)).toBe(true);
    },
  );

  it('does not recognise a source file as a test file', () => {
    expect(TEST_FILE.test('packages/core/src/graph.ts')).toBe(false);
  });

  it('recognises a workflow only under .github/workflows', () => {
    expect(WORKFLOW_FILE.test('.github/workflows/ci.yml')).toBe(true);
    expect(WORKFLOW_FILE.test('tools/repo/ci.yml')).toBe(false);
  });
});
