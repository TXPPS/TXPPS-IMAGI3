import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  BASELINE_THRESHOLDS,
  compareImages,
  decodePng,
  formatPercent,
  readPngFile,
  renderDiffImage,
  writePngFile,
  type ComparisonResult,
  type ComparisonThresholds,
  type DeviceProfile,
  type RgbaImage,
} from '@imagi3/audit';
import { VISUAL_OUTPUT_DIR, shouldUpdateBaselines } from './config.ts';

/** Capture the viewport as an RGBA raster with fonts settled and animations frozen. */
export async function captureScreenshot(page: Page): Promise<RgbaImage> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const buffer = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  return decodePng(buffer, 'screenshot');
}

export function baselinePath(baselineDir: string, profile: DeviceProfile, name: string): string {
  return join(baselineDir, profile.id, `${name}.png`);
}

export interface BaselineOutcome {
  /**
   * `compared` ran the comparator; `written` created or refreshed a baseline;
   * `missing` means no baseline existed and the caller did not permit creating
   * one — which callers must treat as a failure.
   */
  readonly status: 'compared' | 'written' | 'missing';
  readonly path: string;
  readonly comparison?: ComparisonResult | undefined;
}

export interface BaselineOptions {
  readonly thresholds?: ComparisonThresholds | undefined;
  /**
   * Permit creating an absent baseline. Off by default: silently writing a
   * baseline and reporting success would let a renamed profile, a deleted file
   * or a wrong path self-heal to green, which is the same false-green that
   * ADR-0006 forbids for performance budgets.
   */
  readonly allowCreate?: boolean | undefined;
}

function writeFailureArtifacts(
  capture: RgbaImage,
  baselineFile: string,
  comparison: ComparisonResult | undefined,
): void {
  const stem = basename(baselineFile, '.png');
  writePngFile(join(VISUAL_OUTPUT_DIR, `${stem}.actual.png`), capture);
  if (comparison === undefined) return;
  writePngFile(join(VISUAL_OUTPUT_DIR, `${stem}.expected.png`), readPngFile(baselineFile));
  writePngFile(
    join(VISUAL_OUTPUT_DIR, `${stem}.diff.png`),
    renderDiffImage(capture, comparison.mask),
  );
}

/**
 * Compare a capture against its baseline.
 *
 * On failure the capture, the baseline it was rejected against, and a
 * highlighted diff are written under `.audit-out/visual`, so triage is
 * three-up rather than a bare assertion message.
 */
export function compareToBaseline(
  capture: RgbaImage,
  path: string,
  options: BaselineOptions = {},
): BaselineOutcome {
  const thresholds = options.thresholds ?? BASELINE_THRESHOLDS;
  const exists = existsSync(path);

  if (shouldUpdateBaselines() || (!exists && options.allowCreate === true)) {
    writePngFile(path, capture);
    return { status: 'written', path, comparison: undefined };
  }
  if (!exists) {
    writeFailureArtifacts(capture, path, undefined);
    return { status: 'missing', path, comparison: undefined };
  }

  const comparison = compareImages(readPngFile(path), capture, thresholds);
  if (!comparison.ok) writeFailureArtifacts(capture, path, comparison);
  return { status: 'compared', path, comparison };
}

const SSIM_DECIMALS = 5;

export function describeComparison(comparison: ComparisonResult): string {
  return [
    `differing pixels ${formatPercent(comparison.diffRatio)}`,
    `mean SSIM ${comparison.ssim.toFixed(SSIM_DECIMALS)}`,
    `damaged windows ${formatPercent(comparison.ssimStats.lowWindowRatio)}`,
    ...comparison.failures,
  ].join('; ');
}
