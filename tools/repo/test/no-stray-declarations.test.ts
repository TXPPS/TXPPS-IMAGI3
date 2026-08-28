// @vitest-environment node
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findDeclarationMaps, findStrayDeclarations } from '../src/stray-declarations.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE_ROOTS = ['tools', 'apps', 'tests'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', '.audit-out', '.git']);

function walk(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, files);
      continue;
    }
    files.push(path);
  }
}

function allSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) walk(join(REPO_ROOT, root), files);
  return files;
}

/**
 * Declaration output belongs in a build directory, never beside its source.
 *
 * A misconfigured `rootDir` once made `tsc -b` emit `.d.ts` and `.d.ts.map`
 * files directly into `tools/audit/src/`. They were invisible until lint tried
 * to parse them and failed with twenty-eight confusing errors, and the cleanup
 * that removed them also removed a hand-written declaration file, which broke
 * the build in a different way.
 *
 * A generated declaration is recognisable: it sits next to a `.ts` file of the
 * same name. A hand-written one, like `tests/e2e/globals.d.ts`, has no such
 * sibling. That distinction is what this checks, so genuine declarations stay
 * legal and generated ones cannot be committed.
 */
describe('findStrayDeclarations', () => {
  it('flags a declaration sitting beside a source of the same name', () => {
    expect(findStrayDeclarations(['a/src/phases.ts', 'a/src/phases.d.ts'])).toEqual([
      'a/src/phases.d.ts',
    ]);
  });

  it('leaves a hand-written declaration with no generating source alone', () => {
    expect(findStrayDeclarations(['tests/e2e/globals.d.ts', 'tests/e2e/other.ts'])).toEqual([]);
  });

  it('does not confuse same-named files in different directories', () => {
    expect(findStrayDeclarations(['a/x.ts', 'b/x.d.ts'])).toEqual([]);
  });

  it('finds every stray, not just the first', () => {
    expect(findStrayDeclarations(['a.ts', 'a.d.ts', 'b.ts', 'b.d.ts'])).toEqual([
      'a.d.ts',
      'b.d.ts',
    ]);
  });

  it('returns nothing for a clean list', () => {
    expect(findStrayDeclarations(['a.ts', 'b.ts'])).toEqual([]);
  });
});

describe('findDeclarationMaps', () => {
  it('flags a declaration source map', () => {
    expect(findDeclarationMaps(['a/src/x.d.ts.map'])).toEqual(['a/src/x.d.ts.map']);
  });

  it('ignores ordinary source maps and sources', () => {
    expect(findDeclarationMaps(['a.js.map', 'a.ts', 'a.d.ts'])).toEqual([]);
  });
});

describe('generated declaration output', () => {
  const files = allSourceFiles();

  it('finds source files to check, so an empty pass is impossible', () => {
    expect(files.filter((f) => f.endsWith('.ts')).length).toBeGreaterThan(30);
  });

  it('leaves no declaration file beside the source it was generated from', () => {
    expect(findStrayDeclarations(files).map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('leaves no declaration source map outside a build directory', () => {
    expect(findDeclarationMaps(files).map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('still scans the directories the strays actually landed in', () => {
    // Adding 'src' to the skip list would silence this guard entirely while
    // leaving it green; naming the real directories stops that.
    for (const marker of ['tools/audit/src', 'apps/editor/src', 'tests/e2e']) {
      expect(
        files.some((f) => f.includes(marker)),
        `nothing scanned under ${marker}`,
      ).toBe(true);
    }
  });

  it('still permits a hand-written declaration with no generating source', () => {
    const handWritten = join(REPO_ROOT, 'tests/e2e/globals.d.ts');
    expect(files).toContain(handWritten);
    expect(files).not.toContain(join(REPO_ROOT, 'tests/e2e/globals.ts'));
  });
});

/**
 * Found by review: matching only on a `.ts` sibling flags files whose names
 * merely end in `.ts` before the `.d.ts`. The extension check is what stops
 * `a/x.ts` plus `a/x.ts.ts` from reading as a generated pair.
 */
describe('findStrayDeclarations extension handling', () => {
  it.each([
    ['a doubled ts extension', ['a/x.ts', 'a/x.ts.ts']],
    ['a js source with a ts sibling', ['a/x.js', 'a/x.js.ts']],
    ['a tsx source with a ts sibling', ['a/x.tsx', 'a/x.tsx.ts']],
  ])('does not flag %s', (_label, files) => {
    expect(findStrayDeclarations(files)).toEqual([]);
  });

  it('still flags the real generated pair', () => {
    expect(findStrayDeclarations(['a/x.ts', 'a/x.d.ts'])).toEqual(['a/x.d.ts']);
  });
});
