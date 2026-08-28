import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EditError,
  editFile,
  firstDivergentLine,
  requireAbsent,
  requirePresent,
  verifyOnDisk,
} from '../src/verified-edit.ts';

function fixture(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'imagi3-edit-')), 'file.txt');
  writeFileSync(path, contents);
  return path;
}

describe('editFile', () => {
  it('applies a replacement and reports the size change', () => {
    const path = fixture('alpha\nbeta\ngamma\n');
    const outcome = editFile(path, [{ find: 'beta', replace: 'BETA!' }]);

    expect(readFileSync(path, 'utf8')).toBe('alpha\nBETA!\ngamma\n');
    expect(outcome.applied).toBe(1);
    expect(outcome.sizeAfter).toBeGreaterThan(outcome.sizeBefore);
  });

  it('applies several replacements in order', () => {
    const path = fixture('one two three\n');
    editFile(path, [
      { find: 'one', replace: '1' },
      { find: 'three', replace: '3' },
    ]);
    expect(readFileSync(path, 'utf8')).toBe('1 two 3\n');
  });

  /** The RC-0005 failure mode: the anchor is gone and the edit must not pass. */
  it('refuses an anchor that is no longer present', () => {
    const path = fixture('the file has been reformatted\n');
    expect(() => editFile(path, [{ find: 'original text', replace: 'x' }])).toThrow(EditError);
    expect(readFileSync(path, 'utf8')).toBe('the file has been reformatted\n');
  });

  it('names the stale anchor in the error', () => {
    const path = fixture('contents\n');
    expect(() => editFile(path, [{ find: 'missing anchor', replace: 'x' }])).toThrow(
      /matched 0 times, expected 1/,
    );
  });

  it('refuses an ambiguous anchor that matches more than expected', () => {
    const path = fixture('dup\ndup\n');
    expect(() => editFile(path, [{ find: 'dup', replace: 'x' }])).toThrow(/matched 2 times/);
  });

  it('accepts a repeated anchor when the count is declared', () => {
    const path = fixture('dup\ndup\n');
    editFile(path, [{ find: 'dup', replace: 'x', count: 2 }]);
    expect(readFileSync(path, 'utf8')).toBe('x\nx\n');
  });

  it('refuses an edit that would change nothing', () => {
    const path = fixture('same\n');
    expect(() => editFile(path, [{ find: 'same', replace: 'same' }])).toThrow(/no-op/);
  });

  it('refuses an empty replacement list', () => {
    expect(() => editFile(fixture('x'), [])).toThrow(EditError);
  });

  it('refuses an empty anchor, which would match everywhere', () => {
    expect(() => editFile(fixture('x'), [{ find: '', replace: 'y' }])).toThrow(EditError);
  });
});

describe('verifyOnDisk', () => {
  it('passes when the file matches what was intended', () => {
    const path = fixture('exact\n');
    expect(() => {
      verifyOnDisk(path, 'exact\n');
    }).not.toThrow();
  });

  /**
   * Simulates a formatter rewriting the file after the edit: the write
   * succeeded, but what is on disk is not what was intended.
   */
  it('fails when something rewrote the file after the edit', () => {
    const path = fixture('written by us\n');
    writeFileSync(path, 'rewritten by a formatter\n');
    expect(() => {
      verifyOnDisk(path, 'written by us\n');
    }).toThrow(/differs from what was intended/);
  });

  it('reports the first divergent line number', () => {
    const path = fixture('a\nb\nCHANGED\nd\n');
    expect(() => {
      verifyOnDisk(path, 'a\nb\nc\nd\n');
    }).toThrow(/line 3/);
  });
});

describe('firstDivergentLine', () => {
  it.each([
    ['identical', 'a\nb\n', 'a\nb\n', -1],
    ['first line', 'x\nb\n', 'a\nb\n', 0],
    ['third line', 'a\nb\nc\n', 'a\nb\nz\n', 2],
    ['actual is shorter', 'a\nb\nc\n', 'a\nb\n', 2],
    ['actual is longer', 'a\nb\n', 'a\nb\nc\n', 2],
  ])('%s', (_label, expected, actual, line) => {
    expect(firstDivergentLine(expected, actual)).toBe(line);
  });
});

describe('presence assertions', () => {
  it('requirePresent passes when every needle is there', () => {
    const path = fixture('alpha beta\n');
    expect(() => {
      requirePresent(path, ['alpha', 'beta']);
    }).not.toThrow();
  });

  it('requirePresent names what is missing', () => {
    const path = fixture('alpha\n');
    expect(() => {
      requirePresent(path, ['alpha', 'gamma']);
    }).toThrow(/gamma/);
  });

  it('requireAbsent catches text that should have been removed', () => {
    const path = fixture('expect(report.ok).toBe(false);\n');
    expect(() => {
      requireAbsent(path, ['expect(report.ok)']);
    }).toThrow(/still present/);
  });

  it('requireAbsent passes once the text is gone', () => {
    const path = fixture('clean\n');
    expect(() => {
      requireAbsent(path, ['expect(report.ok)']);
    }).not.toThrow();
  });
});
