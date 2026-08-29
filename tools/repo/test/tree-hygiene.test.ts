import { describe, expect, it } from 'vitest';
import { EXPECTED_UNTRACKED, findStrays, formatStrays } from '../src/tree-hygiene.ts';

/**
 * Reviewer isolation leaked at the P1 gate: a review wrote `rv-nav.mjs` into
 * the **main** working tree, where it was found only because it broke lint.
 * Nothing had been checking, and the sweep would have measured a tree with a
 * reviewer's scratch file in it.
 *
 * Classified from porcelain text rather than from the live tree, so the cases
 * can be planted. A detector that has only seen a clean tree has never been
 * shown to detect anything.
 */

describe('findStrays', () => {
  it('flags an untracked file', () => {
    expect(findStrays('?? rv-nav.mjs')).toEqual([
      {
        path: 'rv-nav.mjs',
        reason: 'untracked file in the main tree; a reviewer writes only its report',
      },
    ]);
  });

  it('flags the exact file that prompted this', () => {
    expect(findStrays('?? rv-nav.mjs\n?? scratch.ts')).toHaveLength(2);
  });

  it.each(EXPECTED_UNTRACKED)('permits expected untracked path %s', (prefix) => {
    expect(findStrays(`?? ${prefix}`)).toEqual([]);
  });

  it('permits a file beneath an expected directory', () => {
    expect(findStrays('?? .audit-out/measurements/cold-load.json')).toEqual([]);
  });

  it('ignores a modified tracked file, which is ordinary work', () => {
    expect(findStrays(' M packages/core/src/graph.ts')).toEqual([]);
  });

  it('ignores a staged new file, since staging is how a file gets accounted for', () => {
    expect(findStrays('A  packages/core/src/new.ts')).toEqual([]);
  });

  it('ignores a deleted file', () => {
    expect(findStrays(' D packages/core/src/old.ts')).toEqual([]);
  });

  it('returns nothing for a clean tree', () => {
    expect(findStrays('')).toEqual([]);
  });

  it('tolerates blank lines in the porcelain output', () => {
    expect(findStrays('\n\n?? stray.ts\n\n')).toHaveLength(1);
  });
});

describe('formatStrays', () => {
  it('says the tree is clean when it is', () => {
    expect(formatStrays([])).toContain('TREE CLEAN');
  });

  it('names each stray and points at the incident', () => {
    const text = formatStrays(findStrays('?? rv-nav.mjs'));
    expect(text).toContain('rv-nav.mjs');
    expect(text).toContain('SEC-0001');
  });

  it('says what to do about it', () => {
    // A check that only refuses is a check people route around.
    expect(formatStrays(findStrays('?? x.ts'))).toContain('EXPECTED_UNTRACKED');
  });
});
