import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/**
 * Asset kinds counted toward a bundle budget. Source maps are excluded: they
 * are not served to users on the critical path, and counting them would make
 * the budget react to a debugging decision rather than a shipping one.
 */
export const BUNDLE_ASSET_EXTENSIONS: readonly string[] = ['.js', '.css'];

const SOURCE_MAP_SUFFIX = '.map';

export interface AssetSize {
  /** Path relative to the measured directory, for stable reporting. */
  readonly file: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

/**
 * Gzip a buffer at maximum compression.
 *
 * Maximum level is chosen for reproducibility rather than realism: a CDN may
 * use any level, but the budget needs the same input to yield the same number
 * on every machine.
 */
export function gzipSize(contents: Uint8Array): number {
  return gzipSync(contents, { level: zlibConstants.Z_BEST_COMPRESSION }).byteLength;
}

export function isBundleAsset(fileName: string): boolean {
  if (fileName.endsWith(SOURCE_MAP_SUFFIX)) return false;
  return BUNDLE_ASSET_EXTENSIONS.includes(extname(fileName));
}

function collectFiles(directory: string, accumulator: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectFiles(path, accumulator);
      continue;
    }
    if (isBundleAsset(entry)) accumulator.push(path);
  }
}

/** Measure every bundle asset under a directory, sorted for stable output. */
export function measureDirectory(directory: string): AssetSize[] {
  const files: string[] = [];
  collectFiles(directory, files);
  return files
    .map((path) => {
      const contents = readFileSync(path);
      return {
        file: relative(directory, path),
        rawBytes: contents.byteLength,
        gzipBytes: gzipSize(contents),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function totalGzipBytes(assets: readonly AssetSize[]): number {
  return assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
}

/**
 * Least of the build the runtime chunk can be and still be the runtime.
 *
 * three.js alone is 128 KB gzipped against an editor shell of under 3 KB, so
 * the real figure is above 97%. Half is far below that and far above the 1.6%
 * a rename-only split produced, which is the range a threshold wants to sit in.
 *
 * **What it cannot see**, because Performance measured it: three.js dominates
 * the chunk, so a split that moved every first-party module *out* of the
 * runtime chunk would still read about 97% and pass. The guard against that is
 * not a threshold on bytes — it is `apps/editor/test/chunks.test.ts`, which
 * requires every workspace package to be assigned a side.
 */
export const MIN_RUNTIME_SHARE = 0.5;

/** Percentage scale, so a share reads as a percentage in the fault message. */
const PERCENT = 100;

export interface BundleSplit {
  readonly total: number;
  readonly runtimeBytes: number;
  /** The chunks attributed to the runtime, so the origin string can name them. */
  readonly runtimeFiles: readonly string[];
  /** The shell: the total **less** the runtime chunk. */
  readonly editorBytes: number;
  readonly runtimeShare: number;
  /** Why this split cannot be measured, or undefined when it can. */
  readonly fault: string | undefined;
}

/**
 * Split a measured build into the shell and the engine runtime.
 *
 * Lives here rather than in the CLI because the CLI is not importable and so
 * was not tested. Both halves of this were revertible with the whole suite
 * green at the P1 gate: `total - runtimeBytes` back to `total` restored the
 * double-count that made 97.6% of "the editor bundle" three.js, and
 * `MIN_RUNTIME_SHARE` to `0` removed the name-is-not-attribution check. Neither
 * edit failed anything, and `pnpm audit:bundle` printed the same summary line
 * either way, because the label "(total less the runtime)" is a string literal.
 */
export function splitBundle(
  assets: readonly AssetSize[],
  runtimeChunkPrefix: string,
  minRuntimeShare = MIN_RUNTIME_SHARE,
): BundleSplit {
  const total = totalGzipBytes(assets);
  const runtimeAssets = assets.filter((asset) => asset.file.includes(runtimeChunkPrefix));
  const runtimeBytes = totalGzipBytes(runtimeAssets);
  const runtimeShare = total === 0 ? 0 : runtimeBytes / total;

  const fault =
    runtimeAssets.length === 0
      ? `no chunk named "${runtimeChunkPrefix}"`
      : runtimeShare < minRuntimeShare
        ? `the chunk named "${runtimeChunkPrefix}" is only ` +
          `${(runtimeShare * PERCENT).toFixed(1)}% of the build, below the ` +
          `${String(minRuntimeShare * PERCENT)}% a bundle containing three.js and the ` +
          'runtime must be'
        : undefined;

  // The editor budget is what the shell costs, which is the total *minus* the
  // runtime. Reporting the total made 97.8% of "the editor bundle" three.js, so
  // the budget whose job is keeping the entry chunk small could not have
  // noticed the shell growing a thousandfold under its 5 MB ceiling — and the
  // two budgets double-counted every byte of the renderer.
  return {
    total,
    runtimeBytes,
    runtimeFiles: runtimeAssets.map((asset) => asset.file),
    editorBytes: total - runtimeBytes,
    runtimeShare,
    fault,
  };
}
