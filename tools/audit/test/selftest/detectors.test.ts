import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBudgets, findOrphanMeasurements } from '../../src/budgets/check.ts';
import { parseBudgetDocument } from '../../src/budgets/load.ts';
import type { BudgetDocument } from '../../src/budgets/types.ts';
import { evaluateIncidents } from '../../src/console/allowlist.ts';
import type { ConsoleAllowEntry } from '../../src/console/types.ts';
import { PARITY_THRESHOLDS, compareImages } from '../../src/image/compare.ts';
import { readAllMeasurements } from '../../src/measurements.ts';
import { noiseImage, solidImage, withDifferingPixels } from '../helpers/images.ts';

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
      min: undefined,
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
    detector: 'measurement drift checker',
    plantedDefect: 'a harness reporting an id with no matching budget rule',
    clean: () =>
      findOrphanMeasurements(BUDGET_DOC, [{ id: 'demo.latency', value: 1 }]).length === 0,
    planted: () => findOrphanMeasurements(BUDGET_DOC, [{ id: 'ghost', value: 1 }]).length === 0,
  },
  {
    detector: 'budget config validator',
    plantedDefect: 'a budget file whose ceiling was silently deleted',
    clean: () => canParse({ currentPhase: 'P0', rules: [BUDGET_DOC.rules[0]] }),
    planted: () =>
      canParse({ currentPhase: 'P0', rules: [{ ...BUDGET_DOC.rules[0], max: undefined }] }),
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: '2% of pixels changed, above the 0.5% parity ceiling',
    clean: () => compareImages(REFERENCE, REFERENCE, PARITY_THRESHOLDS).ok,
    planted: () =>
      compareImages(REFERENCE, withDifferingPixels(REFERENCE, 288), PARITY_THRESHOLDS).ok,
  },
  {
    detector: 'screenshot comparator',
    plantedDefect: 'a structurally unrelated frame with a passable pixel count',
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

  it('covers every detector the phase 0 harness ships', () => {
    expect(new Set(SCENARIOS.map((s) => s.detector))).toEqual(
      new Set([
        'budget checker',
        'measurement drift checker',
        'budget config validator',
        'screenshot comparator',
        'console guard',
        'measurement file reader',
      ]),
    );
  });
});
