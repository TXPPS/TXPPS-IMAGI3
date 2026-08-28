// @vitest-environment node
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
describe('generated declaration output', () => {
  const files = allSourceFiles();

  it('finds source files to check, so an empty pass is impossible', () => {
    expect(files.filter((f) => f.endsWith('.ts')).length).toBeGreaterThan(30);
  });

  it('leaves no declaration file beside the source it was generated from', () => {
    const strays = files.filter((file) => {
      if (!file.endsWith('.d.ts')) return false;
      const sibling = join(dirname(file), `${basename(file, '.d.ts')}.ts`);
      return files.includes(sibling);
    });
    expect(strays.map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('leaves no declaration source map outside a build directory', () => {
    const strays = files.filter((file) => file.endsWith('.d.ts.map'));
    expect(strays.map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it('still permits a hand-written declaration with no generating source', () => {
    const handWritten = join(REPO_ROOT, 'tests/e2e/globals.d.ts');
    expect(files).toContain(handWritten);
    expect(files).not.toContain(join(REPO_ROOT, 'tests/e2e/globals.ts'));
  });
});
