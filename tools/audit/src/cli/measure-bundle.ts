import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { measureDirectory, totalGzipBytes } from '../bundle/measure.ts';
import { MEASUREMENT_DIR, writeMeasurements } from '../measurements.ts';
import { findRepoRoot } from '../repo-root.ts';

const EDITOR_DIST = 'apps/editor/dist';
const BUDGET_ID = 'editor.bundle.gzip';

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

  const path = writeMeasurements(
    'bundle-size',
    [{ id: BUDGET_ID, value: total, origin: 'tools/audit/src/cli/measure-bundle.ts' }],
    join(repoRoot, MEASUREMENT_DIR),
  );
  console.log(`Recorded ${BUDGET_ID} to ${path}`);
  return 0;
}

process.exitCode = main();
