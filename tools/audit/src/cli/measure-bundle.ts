import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureDirectory, totalGzipBytes } from '../bundle/measure.ts';
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

  const runtimeAssets = assets.filter((asset) => asset.file.includes(RUNTIME_CHUNK_PREFIX));
  if (runtimeAssets.length === 0) {
    console.error(
      `No chunk named "${RUNTIME_CHUNK_PREFIX}" in ${EDITOR_DIST}. The runtime is either not ` +
        'built or no longer split out, and either way its budget cannot be measured. ' +
        'Check the manualChunks configuration in apps/editor/vite.config.ts.',
    );
    return 1;
  }
  const runtimeTotal = totalGzipBytes(runtimeAssets);
  console.log(
    `  runtime  ${String(runtimeTotal)} B gzipped across ` +
      `${String(runtimeAssets.length)} chunk(s)`,
  );

  const path = writeMeasurements(
    'bundle-size',
    [
      { id: BUDGET_ID, value: total, origin: 'tools/audit/src/cli/measure-bundle.ts' },
      {
        id: RUNTIME_BUDGET_ID,
        value: runtimeTotal,
        origin: `tools/audit/src/cli/measure-bundle.ts (${runtimeAssets.map((a) => a.file).join(', ')})`,
      },
    ],
    join(repoRoot, MEASUREMENT_DIR),
  );
  console.log(`Recorded ${BUDGET_ID} and ${RUNTIME_BUDGET_ID} to ${path}`);
  return 0;
}

process.exitCode = main();
