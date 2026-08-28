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

/**
 * Least of the build the runtime chunk can be and still be the runtime.
 *
 * three.js alone is 128 KB gzipped against an editor shell of under 3 KB, so
 * the real figure is above 97%. Half is far below that and far above the 1.6%
 * a rename-only split produced, which is the range a threshold wants to sit in.
 */
const MIN_RUNTIME_SHARE = 0.5;
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

  const runtimeAssets = assets.filter((asset) => asset.file.includes(RUNTIME_CHUNK_PREFIX));
  if (runtimeAssets.length === 0) {
    console.error(
      `No chunk named "${RUNTIME_CHUNK_PREFIX}" in ${EDITOR_DIST}. The runtime is either not ` +
        'built or no longer split out, and either way its budget cannot be measured. ' +
        'Check the manualChunks configuration in apps/editor/vite.config.ts.',
    );
    return 1;
  }

  // A name is not attribution. A `manualChunks` that keeps the name on one
  // small module while three.js falls into the editor's entry chunk reported
  // 2,050 bytes for a 128 KB runtime — a 98.4% under-report, green, with a
  // plausible origin string. That is the realistic accident: a package added at
  // a later phase, or a renderer path that stops matching the literal id tests.
  // So the share is checked as well as the name. Found by Performance at P1.
  const runtimeShare = totalGzipBytes(runtimeAssets) / total;
  if (runtimeShare < MIN_RUNTIME_SHARE) {
    console.error(
      `The chunk named "${RUNTIME_CHUNK_PREFIX}" is only ` +
        `${(runtimeShare * PERCENT).toFixed(1)}% of the build, below the ` +
        `${String(MIN_RUNTIME_SHARE * PERCENT)}% a bundle containing three.js and the runtime ` +
        'must be. Some of the runtime is landing in another chunk, so this budget would ' +
        'measure a stub. Check the manualChunks configuration in apps/editor/vite.config.ts.',
    );
    return 1;
  }
  const runtimeTotal = totalGzipBytes(runtimeAssets);
  // The editor budget is what the shell costs, which is the total *minus* the
  // runtime. Reporting the total made 97.8% of "the editor bundle" three.js, so
  // the budget whose job is keeping the entry chunk small could not have
  // noticed the shell growing a thousandfold under its 5 MB ceiling — and the
  // two budgets double-counted every byte of the renderer. Found by QA
  // Automation at the P1 gate; the field's description had said "excluding the
  // engine runtime chunk" since P0, when it was vacuously true.
  const editorTotal = total - runtimeTotal;
  console.log(
    `  runtime  ${String(runtimeTotal)} B gzipped across ` +
      `${String(runtimeAssets.length)} chunk(s)`,
    `\n  editor   ${String(editorTotal)} B gzipped (total less the runtime)`,
  );

  const path = writeMeasurements(
    'bundle-size',
    [
      { id: BUDGET_ID, value: editorTotal, origin: 'tools/audit/src/cli/measure-bundle.ts' },
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
