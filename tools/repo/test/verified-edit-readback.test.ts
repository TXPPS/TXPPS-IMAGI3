import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as NodeFs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * `writeFileSync` is replaced for this file only, so `editFile`'s read-back is
 * exercised against a file that changed after the write — a formatter, a
 * watcher, or a concurrent process. Reviews found the read-back's standalone
 * behaviour pinned but its wiring untested: deleting the call left the suite
 * green, which is the same shape of hole as RC-0006.
 *
 * The mock lives in its own file because it would corrupt every other test that
 * writes a fixture.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    writeFileSync: (target: string, contents: string): void => {
      const rewritten = contents.includes('SENTINEL') ? 'rewritten by something else\n' : contents;
      actual.writeFileSync(target, rewritten);
    },
  };
});

const { editFile } = await import('../src/verified-edit.ts');

describe('editFile read-back', () => {
  it('fails when what landed on disk is not what was intended', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imagi3-readback-'));
    const path = join(dir, 'file.txt');
    writeFileSync(path, 'original\n');

    expect(() => editFile(path, [{ find: 'original', replace: 'SENTINEL' }])).toThrow(
      /differs from what was intended/,
    );
    expect(readFileSync(path, 'utf8')).toBe('rewritten by something else\n');
  });

  it('passes when the write survives intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imagi3-readback-'));
    const path = join(dir, 'file.txt');
    writeFileSync(path, 'original\n');

    expect(() => editFile(path, [{ find: 'original', replace: 'replaced' }])).not.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('replaced\n');
  });
});
