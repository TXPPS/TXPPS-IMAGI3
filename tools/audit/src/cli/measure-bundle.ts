import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureDirectory, splitBundle, totalGzipBytes } from '../bundle/measure.ts';
import { MEASUREMENT_DIR, writeMeasurements } from '../measurements.ts';
import { findRepoRoot } from '../repo-root.ts';

const EDITOR_DIST = 'apps/editor/dist';
const BUDGET_ID = 'editor.bundle.gzip';

/**
 * Chunk name prefix the runtime and renderer are split into.
 *
 * Duplicated from `apps/editor/vite.config.ts` rather than imported, because
 * this CLI must not depend on the editor's build config to run. The
 * consequence — the two could drift — is handled by failing loudly below rather
 * than by reporting zero: a runtime budget that silently measured nothing is
 * precisely the failure RC-0004 was.
 */
const RUNTIME_CHUNK_PREFIX = 'imagi3-runtime';
const RUNTIME_BUDGET_ID = 'runtime.bundle.gzip';

const PERCENT = 100;

function main(): number {
  const repoRoot = findRepoRoot();
  const distDir = join(repoRoot, EDITOR_DIST);

  if (!existsSync(distDir)) {
    console.error(`${EDITOR_DIST} does not exist. Run \`pnpm build\` first.`);
    return 1;
  }

  const assets = measureDirectory(distDir);
  if (assets.length === 0) {
    console.error(`${EDITOR_DIST} contains no JS or CSS assets; the build produced nothing.`);
    return 1;
  }

  const total = totalGzipBytes(assets);
  for (const asset of assets) {
    console.log(`  ${asset.file}  ${String(asset.gzipBytes)} B gzipped`);
  }
  console.log(`  total  ${String(total)} B gzipped across ${String(assets.length)} assets`);

  // A name is not attribution, and the total is not the shell. Both halves of
  // this arithmetic live in `splitBundle`, where they are tested — they were
  // here, in a file no test can import, and both were revertible with the whole
  // suite green at the P1 gate.
  const split = splitBundle(assets, RUNTIME_CHUNK_PREFIX);
  if (split.fault !== undefined) {
    console.error(
      `${split.fault} in ${EDITOR_DIST}. Either the runtime is not built, or some of it is ` +
        'landing in another chunk and this budget would measure a stub. ' +
        'Check apps/editor/src/build/chunks.ts.',
    );
    return 1;
  }

  const runtimeTotal = split.runtimeBytes;
  const editorTotal = split.editorBytes;
  console.log(
    `  runtime  ${String(runtimeTotal)} B gzipped ` +
      `(${(split.runtimeShare * PERCENT).toFixed(1)}% of the build)`,
    `\n  editor   ${String(editorTotal)} B gzipped (total less the runtime)`,
  );

  const path = writeMeasurements(
    'bundle-size',
    [
      { id: BUDGET_ID, value: editorTotal, origin: 'tools/audit/src/cli/measure-bundle.ts' },
      {
        id: RUNTIME_BUDGET_ID,
        value: runtimeTotal,
        origin: `tools/audit/src/cli/measure-bundle.ts (${split.runtimeFiles.join(', ')})`,
      },
    ],
    join(repoRoot, MEASUREMENT_DIR),
  );
  console.log(`Recorded ${BUDGET_ID} and ${RUNTIME_BUDGET_ID} to ${path}`);
  return 0;
}

process.exitCode = main();
