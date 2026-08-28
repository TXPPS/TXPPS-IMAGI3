import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLD_LOAD_BUDGET_IDS, isCiHeadlessBudget } from '../../src/budgets/ids.ts';
import { parseBudgetDocument } from '../../src/budgets/load.ts';
import { PHASE_ORDER, isPhaseId } from '../../src/phases.ts';
import { DEVICE_PROFILES } from '../../src/profiles.ts';
import type { BudgetRule } from '../../src/budgets/types.ts';
import { BUDGETS_FILENAME, findRepoRoot } from '../../src/repo-root.ts';

const repoRoot = findRepoRoot();
const document = parseBudgetDocument(
  JSON.parse(readFileSync(join(repoRoot, BUDGETS_FILENAME), 'utf8')),
);
const byId = new Map(document.rules.map((rule) => [rule.id, rule]));

function rule(id: string): BudgetRule {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`budgets.json is missing the rule "${id}"`);
  return found;
}

/**
 * The numbers the brief fixes, with the phase each starts being enforced from.
 *
 * The phase is pinned as tightly as the value. Pushing a rule's `enforcedFrom`
 * out to a later phase silently switches off its enforcement just as
 * effectively as deleting it, and would otherwise be a one-word edit nothing
 * complains about.
 */
const MANDATED: readonly (readonly [string, 'max' | 'min', number, string])[] = [
  ['ci-headless.editor.coldLoad', 'max', 3_000, 'P0'],
  ['editor.coldLoad.tablet', 'max', 6_000, 'P0'],
  ['editor.coldLoad.phone', 'max', 6_000, 'P0'],
  ['editor.bundle.gzip', 'max', 5_000_000, 'P0'],
  ['runtime.bundle.gzip', 'max', 1_500_000, 'P1'],
  ['playmode.fps.tablet.reference2d', 'min', 60, 'P1'],
  ['editor.frameSpike.max', 'max', 32, 'P3'],
  ['soak.heapGrowth.ratio', 'max', 1.1, 'P3'],
  ['playmode.fps.phone.reference3d', 'min', 30, 'P6'],
  ['playmode.heap.peak.phone', 'max', 500_000_000, 'P6'],
  ['gpu.texture.phone', 'max', 256_000_000, 'P6'],
];

describe('the committed budgets.json', () => {
  it.each(MANDATED)('pins %s %s at %d, enforced from %s', (id, bound, value, phase) => {
    expect(rule(id)[bound]).toBe(value);
    expect(rule(id).enforcedFrom).toBe(phase);
  });

  it('declares no rules beyond those pinned here', () => {
    expect([...byId.keys()].sort()).toEqual(MANDATED.map(([id]) => id).sort());
  });

  it('expresses byte budgets in decimal units, the stricter reading of the brief', () => {
    // 1.5 MiB would be 1572864 — about 4.9% more lenient. See ADR-0006.
    expect(rule('runtime.bundle.gzip').max).toBeLessThan(1024 * 1024 * 1.5);
    expect(rule('playmode.heap.peak.phone').max).toBeLessThan(1024 * 1024 * 500);
    expect(rule('gpu.texture.phone').max).toBeLessThan(1024 * 1024 * 256);
  });

  it('gives every duration and size budget a plausibility floor', () => {
    for (const id of [
      'ci-headless.editor.coldLoad',
      'editor.coldLoad.tablet',
      'editor.coldLoad.phone',
    ]) {
      expect(rule(id).min, `${id} would accept zero or a negative measurement`).toBeGreaterThan(0);
    }
    expect(rule('editor.bundle.gzip').min).toBeGreaterThan(0);
  });

  it('documents provenance for every rule', () => {
    for (const budgetRule of document.rules) {
      expect(budgetRule.source.length).toBeGreaterThan(0);
      expect(budgetRule.description.length).toBeGreaterThan(0);
    }
  });

  it('declares a phase docs/STATE.md states as a canonical phase id', () => {
    const state = readFileSync(join(repoRoot, 'docs/STATE.md'), 'utf8');
    const declared = /^\*\*Phase:\*\*\s*(\S+)/m.exec(state)?.[1];

    expect(declared, 'docs/STATE.md must open with a **Phase:** line').toBeDefined();
    expect(
      declared !== undefined && isPhaseId(declared),
      `docs/STATE.md declares phase "${String(declared)}", which is not one of ` +
        `${PHASE_ORDER.join(', ')}. That line is a machine contract with budgets.json, ` +
        'so a sub-gate name does not belong in it.',
    ).toBe(true);
    expect(
      document.currentPhase,
      'budgets.json currentPhase and docs/STATE.md disagree about the phase, so one of them is lying about what is enforced',
    ).toBe(declared);
  });
});

/**
 * A budget whose name asserts a device must be measured under something that
 * approximates that device. The one budget that runs unthrottled says so in
 * its own id.
 */
describe('device naming honesty', () => {
  it('makes every ci-headless budget declare that it carries no device signal', () => {
    let checked = 0;
    for (const budgetRule of document.rules) {
      if (!isCiHeadlessBudget(budgetRule.id)) continue;
      checked += 1;
      expect(budgetRule.description).toMatch(/NO device signal/i);
    }
    // Without this, a one-character typo in the prefix constant silences the
    // assertion entirely and the test still passes, having checked nothing.
    expect(
      checked,
      'no ci-headless budget was examined; the predicate matched nothing',
    ).toBeGreaterThan(0);
  });

  it('names no budget after a device profile that runs unthrottled', () => {
    let checked = 0;
    for (const [profileId, profile] of Object.entries(DEVICE_PROFILES)) {
      if (profile.cpuThrottlingRate > 1) continue;
      checked += 1;
      const named = document.rules.filter(
        (r) => r.id.includes(`.${profileId}`) && !isCiHeadlessBudget(r.id),
      );
      expect(
        named.map((r) => r.id),
        `${profileId} is unthrottled, so a budget named after it would claim a device signal it does not have`,
      ).toEqual([]);
    }
    expect(checked, 'no unthrottled profile was examined').toBeGreaterThan(0);
  });

  it('maps every profile to a declared cold-load budget', () => {
    for (const id of Object.values(COLD_LOAD_BUDGET_IDS)) {
      expect(byId.has(id), `${id} is referenced by COLD_LOAD_BUDGET_IDS but not declared`).toBe(
        true,
      );
    }
  });
});
