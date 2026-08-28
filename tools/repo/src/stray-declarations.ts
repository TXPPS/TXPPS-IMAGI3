import { basename, dirname, join } from 'node:path';

/**
 * Generated declaration output that was written beside its source.
 *
 * A misconfigured `rootDir` once made `tsc -b` emit `.d.ts` and `.d.ts.map`
 * files directly into `tools/audit/src/`. They were invisible until lint tried
 * to parse them, and the cleanup that removed them also deleted a hand-written
 * declaration, breaking the build a different way.
 *
 * The distinction is structural: a generated declaration sits beside a `.ts`
 * file of the same name; a hand-written one, like `tests/e2e/globals.d.ts`, has
 * no such sibling. Pure over a file list so it can be tested against planted
 * strays rather than only against a clean tree, where every detector passes.
 */
export function findStrayDeclarations(files: readonly string[]): string[] {
  const present = new Set(files);
  return files.filter((file) => {
    if (!file.endsWith('.d.ts')) return false;
    return present.has(join(dirname(file), `${basename(file, '.d.ts')}.ts`));
  });
}

/** Declaration source maps, which are always generated and never hand-written. */
export function findDeclarationMaps(files: readonly string[]): string[] {
  return files.filter((file) => file.endsWith('.d.ts.map'));
}
