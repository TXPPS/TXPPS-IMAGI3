// @vitest-environment node
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_PACKAGES,
  ENGINE_PACKAGES,
  ENGINE_VENDOR,
  RUNTIME_CHUNK,
  chunkFor,
} from '../src/build/chunks.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The split is a decision about every workspace package, and this is where the
 * decision is forced.
 *
 * `packages/core` was in neither the runtime chunk nor anyone's attention: the
 * predicate named `runtime`, `render` and `three`, so the scene schema, the
 * canonical serialiser, the fractional index and the graph repair all shipped
 * inside the editor's entry chunk. `runtime.bundle.gzip` measured the renderer
 * and the cold-load budget quietly paid for core.
 *
 * The share check on the other side cannot see this. It asks what fraction of
 * the build the runtime chunk is, and three.js is 97% of that chunk whether or
 * not any first-party module joined it — so a split that moved *all* the
 * first-party runtime back into the entry chunk would still read 97% and pass.
 * That is why the guard here is completeness against the directory rather than
 * a threshold on bytes.
 */
describe('the chunk split', () => {
  const workspacePackages = readdirSync(join(REPO_ROOT, 'packages'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('assigns every workspace package to a side', () => {
    // A package added tomorrow fails here until someone decides which chunk it
    // belongs in. Defaulting silently is what put core in the wrong one.
    const assigned = [...ENGINE_PACKAGES, ...Object.keys(EDITOR_PACKAGES)].sort();
    expect(assigned).toEqual(workspacePackages);
  });

  it('gives a reason for every package kept in the entry chunk', () => {
    for (const [name, reason] of Object.entries(EDITOR_PACKAGES)) {
      expect(reason.length, `${name} is in the entry chunk with no reason given`).toBeGreaterThan(
        20,
      );
    }
  });

  it.each(['core', 'runtime', 'render'])('routes packages/%s to the runtime chunk', (name) => {
    expect(chunkFor(`/home/x/repo/packages/${name}/src/index.ts`)).toBe(RUNTIME_CHUNK);
  });

  it.each(ENGINE_VENDOR)('routes %s to the runtime chunk', (name) => {
    expect(chunkFor(`/home/x/repo/node_modules/${name}/build/three.module.js`)).toBe(RUNTIME_CHUNK);
  });

  it('leaves the editor to Rollup', () => {
    expect(chunkFor('/home/x/repo/apps/editor/src/main.ts')).toBeUndefined();
  });

  it('does not route an unrelated dependency into the runtime chunk', () => {
    expect(chunkFor('/home/x/repo/node_modules/vite/dist/client.mjs')).toBeUndefined();
  });

  it('matches on a path segment, not on a bare name', () => {
    // `packages/coregraph/` is not `packages/core`.
    expect(chunkFor('/home/x/repo/packages/coregraph/src/index.ts')).toBeUndefined();
  });
});
