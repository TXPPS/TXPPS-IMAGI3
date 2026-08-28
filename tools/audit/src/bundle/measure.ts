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
