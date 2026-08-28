import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBudgets, findOrphanMeasurements } from '../../src/budgets/check.ts';
import { parseBudgetDocument } from '../../src/budgets/load.ts';
import type { BudgetDocument } from '../../src/budgets/types.ts';
import { evaluateIncidents } from '../../src/console/allowlist.ts';
import { isBundleAsset, measureDirectory, totalGzipBytes } from '../../src/bundle/measure.ts';
import type { ConsoleAllowEntry } from '../../src/console/types.ts';
import { PARITY_THRESHOLDS, compareImages } from '../../src/image/compare.ts';
import { readAllMeasurements } from '../../src/measurements.ts';
import { noiseImage, solidImage, withScatteredShift, withWipedBlock } from '../helpers/images.ts';

/**
 * Phase 0 gate: the audit harness must demonstrably catch a deliberately
 * planted failure. Each scenario runs a detector twice — once on clean input,
 * once on input with a specific defect planted in it — and asserts the detector
 * distinguishes them. A detector that always fails would satisfy the "catches"
 * half alone, so the clean half is what makes this proof meaningful.
 */
interface DetectorScenario {
  readonly detector: string;
  readonly plantedDefect: string;
  /** Runs the detector on clean input; returns true when it reports green. */
  readonly clean: () => boolean;
  /** Runs the detector on defective input; returns true when it reports green. */
  readonly planted: () => boolean;
}

const BUDGET_DOC: BudgetDocument = {
  currentPhase: 'P3',
  rules: [
    {
      id: 'demo.latency',
      description: 'Demo latency budget',
      unit: 'ms',
      scope: 'all',
      max: 100,
      min: 1,
      enforcedFrom: 'P0',
      source: 'selftest',
    },
  ],
};

const ALLOWLIST: readonly ConsoleAllowEntry[] = [
  {
    pattern: 'benign notice',
    justification: 'Known-harmless notice used by the self-test.',
    trackedBy: 'selftest',
  },
];

function tempDirWith(filename: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'imagi3-selftest-'));
  writeFileSync(join(dir, filename), contents);
  return dir;
}

const REFERENCE = noiseImage(120, 120, 4242);

/**
 * Larger reference used by the comparator scenarios below. Each of those
 * scenarios is tuned so that exactly ONE of the comparator's three gates
 * fires. That isolation is the point: with a scenario that trips every gate at
 * once, deleting any single gate would leave this suite green, and the suite
 * would be certifying a comparator it never tested.
 */
const FRAME = noiseImage(320, 320, 99);

const SCENARIOS: readonly DetectorScenario[] = [
  {
    detector: 'budget checker',
    plantedDefect: 'a measurement 40% over its declared ceiling',
    clean: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 80 }]).ok,
    planted: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 140 }]).ok,
  },
  {
    detector: 'budget checker',
    plantedDefect: 'an enforced budget that no harness measured',
    clean: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 80 }]).ok,
    planted: () => checkBudgets(BUDGET_DOC, []).ok,
  },
  {
    detector: 'budget checker',
    plantedDefect: 'a measurement reported as NaN',
    clean: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 80 }]).ok,
    planted: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: Number.NaN }]).ok,
  },
  {
    detector: 'budget checker',
    plantedDefect: 'a physically impossible measurement of zero',
    clean: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 80 }]).ok,
    planted: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 0 }]).ok,
  },
  {
    detector: 'budget checker',
    plantedDefect: 'a negative measurement a broken harness could emit',
    clean: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: 80 }]).ok,
    planted: () => checkBudgets(BUDGET_DOC, [{ id: 'demo.latency', value: -5000 }]).ok,
  },
  {
    detector: 'measurement drift checker',
    plantedDefect: 'a harness reporting an id with no matching budget rule',
    clean: () =>
      findOrphanMeasurements(BUDGET_DOC, [{ id: 'demo.latency', value: 1 }]).length === 0,
    planted: () => findOrphanMeasurements(BUDGET_DOC, [{ id: 'ghost', value: 1 }]).length === 0,
  },
  {
    detector: 'budget config validator',
    plantedDefect: 'a budget rule left with no bound at all',
    clean: () => canParse({ currentPhase: 'P0', rules: [BUDGET_DOC.rules[0]] }),
    planted: () =>
      canParse({
        currentPhase: 'P0',
        rules: [{ ...BUDGET_DOC.rules[0], max: undefined, min: undefined }],
      }),
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: 'diffuse colour drift over 0.93% of pixels (pixel-ratio gate alone)',
    // Measured: 0.9307% differing, mean SSIM 0.99777, 0.0000% damaged windows.
    // Only the differing-pixel ratio can catch this.
    clean: () => compareImages(FRAME, FRAME, PARITY_THRESHOLDS).ok,
    planted: () => compareImages(FRAME, withScatteredShift(FRAME, 108, 40), PARITY_THRESHOLDS).ok,
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: 'a control erased from one region (damaged-window gate alone)',
    // Measured: 0.2500% differing and mean SSIM 0.99690 — both inside their
    // bounds — while 0.4006% of windows collapse to SSIM 0.00001. This is the
    // regression a mean-only SSIM gate dilutes into nothing.
    clean: () => compareImages(FRAME, FRAME, PARITY_THRESHOLDS).ok,
    planted: () =>
      compareImages(FRAME, withWipedBlock(FRAME, { x: 40, y: 40 }, 16), PARITY_THRESHOLDS).ok,
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: 'a three-level background shift no pixel crosses the threshold for',
    // Measured: 0.0000% differing pixels, mean SSIM 0.97896. Invisible to the
    // pixel gate; this is the case ADR-0005 cites to justify owning a
    // comparator with a structural metric at all.
    clean: () =>
      compareImages(
        solidImage(160, 160, [11, 13, 18, 255]),
        solidImage(160, 160, [11, 13, 18, 255]),
        PARITY_THRESHOLDS,
      ).ok,
    planted: () =>
      compareImages(
        solidImage(160, 160, [11, 13, 18, 255]),
        solidImage(160, 160, [14, 16, 21, 255]),
        PARITY_THRESHOLDS,
      ).ok,
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: 'a wholly unrelated frame',
    clean: () => compareImages(REFERENCE, REFERENCE, PARITY_THRESHOLDS).ok,
    planted: () =>
      compareImages(solidImage(120, 120, [0, 0, 0, 255]), REFERENCE, PARITY_THRESHOLDS).ok,
  },
  {
    detector: 'console guard',
    plantedDefect: 'an unlisted console error',
    clean: () =>
      evaluateIncidents([{ kind: 'console-error', text: 'benign notice' }], ALLOWLIST).ok,
    planted: () =>
      evaluateIncidents([{ kind: 'console-error', text: 'unexpected failure' }], ALLOWLIST).ok,
  },
  {
    detector: 'console guard',
    plantedDefect: 'an uncaught exception whose text matches an allowlist entry',
    clean: () =>
      evaluateIncidents([{ kind: 'console-error', text: 'benign notice' }], ALLOWLIST).ok,
    planted: () => evaluateIncidents([{ kind: 'page-error', text: 'benign notice' }], ALLOWLIST).ok,
  },
  {
    detector: 'console guard',
    plantedDefect: 'an unhandled promise rejection',
    clean: () => evaluateIncidents([], ALLOWLIST).ok,
    planted: () =>
      evaluateIncidents([{ kind: 'unhandled-rejection', text: 'benign notice' }], ALLOWLIST).ok,
  },
  {
    detector: 'console allowlist validator',
    plantedDefect: 'an allowlist entry with its justification blanked out',
    clean: () => canEvaluate([{ ...ALLOWLIST[0]!, pattern: 'x' }]),
    planted: () => canEvaluate([{ ...ALLOWLIST[0]!, justification: '   ' }]),
  },
  {
    detector: 'console allowlist validator',
    plantedDefect: 'an allowlist pattern that is not a valid regular expression',
    clean: () => canEvaluate([{ ...ALLOWLIST[0]!, pattern: 'x' }]),
    planted: () => canEvaluate([{ ...ALLOWLIST[0]!, pattern: '([' }]),
  },
  {
    detector: 'bundle measurer',
    plantedDefect: 'a build directory holding only source maps',
    clean: () => measuresSomething({ 'app.js': 'console.log(1);' }),
    planted: () => measuresSomething({ 'app.js.map': '{"version":3}' }),
  },
  {
    detector: 'measurement file reader',
    plantedDefect: 'a truncated measurement file a harness half-wrote',
    clean: () =>
      canRead(tempDirWith('good.measurements.json', '[{"id":"demo.latency","value":1}]')),
    planted: () => canRead(tempDirWith('bad.measurements.json', '[{"id":"demo.latency"}]')),
  },
];

function canParse(input: unknown): boolean {
  try {
    parseBudgetDocument(input);
    return true;
  } catch {
    return false;
  }
}

function canEvaluate(entries: readonly ConsoleAllowEntry[]): boolean {
  try {
    evaluateIncidents([], entries);
    return true;
  } catch {
    return false;
  }
}

/** True when the bundle measurer found at least one asset worth counting. */
function measuresSomething(files: Record<string, string>): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'imagi3-selftest-bundle-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  const assets = measureDirectory(dir);
  return assets.length > 0 && totalGzipBytes(assets) > 0;
}

function canRead(dir: string): boolean {
  try {
    readAllMeasurements(dir);
    return true;
  } catch {
    return false;
  }
}

describe('audit harness self-test', () => {
  it.each(SCENARIOS.map((s) => [`${s.detector}: ${s.plantedDefect}`, s] as const))(
    'catches %s',
    (_label, scenario) => {
      expect(scenario.planted()).toBe(false);
    },
  );

  it.each(SCENARIOS.map((s) => [`${s.detector}: ${s.plantedDefect}`, s] as const))(
    'stays green on the clean counterpart of %s',
    (_label, scenario) => {
      expect(scenario.clean()).toBe(true);
    },
  );

  /**
   * A change detector, and knowingly so: it cannot notice a detector that ships
   * with no scenario at all. Its job is narrower — to make removing a
   * scenario, or adding a detector without listing it here, a deliberate edit
   * to this list rather than a silent omission.
   */
  it('lists a scenario for every detector the phase 0 harness ships', () => {
    expect(new Set(SCENARIOS.map((s) => s.detector))).toEqual(
      new Set([
        'budget checker',
        'measurement drift checker',
        'budget config validator',
        'console allowlist validator',
        'screenshot comparator',
        'console guard',
        'bundle measurer',
        'measurement file reader',
      ]),
    );
  });

  it('exercises the bundle measurer on real bytes, not a stub', () => {
    expect(isBundleAsset('app.js')).toBe(true);
    expect(isBundleAsset('app.js.map')).toBe(false);
  });
});
