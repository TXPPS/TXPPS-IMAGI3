// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UncommittedFileError, readCommitted } from '../src/git-blob.ts';

/**
 * The property under test is the one that makes the mutation sweep able to
 * report a survivor at all: a reader that sees the commit and not the disk.
 *
 * Tested against a scratch repository rather than against this one. The real
 * tree is clean when tests run, so an assertion made here about the real tree
 * would pass whether or not `readCommitted` ignored working-tree edits — which
 * is the same "assertion that cannot fail" this whole apparatus exists to find.
 * A scratch repo lets the modification actually be made.
 */

let repo: string;

const COMMITTED = 'export const answer = 42;\n';
const MUTATED = 'export const answer = 0;\n';

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'imagi3-git-blob-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'src.ts'), COMMITTED);
  git('add', 'src.ts');
  git('commit', '--quiet', '-m', 'add src');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('readCommitted', () => {
  it('returns the committed bytes for an unmodified file', () => {
    expect(readCommitted(repo, 'src.ts')).toBe(COMMITTED);
  });

  it('ignores a working-tree modification', () => {
    // The exact situation during a sweep: the file on disk carries the mutation.
    writeFileSync(join(repo, 'src.ts'), MUTATED);
    try {
      expect(readCommitted(repo, 'src.ts')).toBe(COMMITTED);
    } finally {
      writeFileSync(join(repo, 'src.ts'), COMMITTED);
    }
  });

  it('ignores a deletion of the working-tree file', () => {
    rmSync(join(repo, 'src.ts'));
    try {
      expect(readCommitted(repo, 'src.ts')).toBe(COMMITTED);
    } finally {
      writeFileSync(join(repo, 'src.ts'), COMMITTED);
    }
  });

  it('throws a named error for a file that exists on disk but not in the commit', () => {
    writeFileSync(join(repo, 'untracked.ts'), 'export const x = 1;\n');
    // Not a survivor and not a kill: a mutation aimed at uncommitted code is
    // testing nothing, and must be distinguishable from either verdict.
    expect(() => readCommitted(repo, 'untracked.ts')).toThrow(UncommittedFileError);
  });

  it('names the path and the revision it could not find', () => {
    expect(() => readCommitted(repo, 'absent.ts', 'HEAD')).toThrow(/absent\.ts.*HEAD/s);
  });
});
