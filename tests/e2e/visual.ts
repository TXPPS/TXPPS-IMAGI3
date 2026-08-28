import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  /** `written` means no baseline existed yet, or a refresh was requested. */
  readonly status: 'compared' | 'written';
  readonly path: string;
  readonly comparison?: ComparisonResult | undefined;
}

function writeFailureArtifacts(
  capture: RgbaImage,
  baselineFile: string,
  comparison: ComparisonResult,
): void {
  const stem = baselineFile.replace(/[/\\]/g, '_').replace(/\.png$/, '');
  writePngFile(join(VISUAL_OUTPUT_DIR, `${stem}.actual.png`), capture);
  writePngFile(
    join(VISUAL_OUTPUT_DIR, `${stem}.diff.png`),
    renderDiffImage(capture, comparison.mask),
  );
}

/**
 * Compare a capture against its baseline, writing the baseline when none exists
 * yet or when a refresh was requested.
 *
 * On failure the actual capture and a highlighted diff are written under
 * `.audit-out/visual` so a human can review exactly what moved.
 */
export function compareToBaseline(
  capture: RgbaImage,
  path: string,
  thresholds: ComparisonThresholds = BASELINE_THRESHOLDS,
): BaselineOutcome {
  if (shouldUpdateBaselines() || !existsSync(path)) {
    writePngFile(path, capture);
    return { status: 'written', path, comparison: undefined };
  }
  const comparison = compareImages(readPngFile(path), capture, thresholds);
  if (!comparison.ok) writeFailureArtifacts(capture, path, comparison);
  return { status: 'compared', path, comparison };
}

export function describeComparison(comparison: ComparisonResult): string {
  return [
    `differing pixels ${formatPercent(comparison.diffRatio)}`,
    `SSIM ${comparison.ssim.toFixed(5)}`,
    ...comparison.failures,
  ].join('; ');
}
