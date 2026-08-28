import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBudgetDocument } from '../../src/budgets/load.ts';
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
  ['editor.coldLoad.desktop', 'max', 3_000, 'P0'],
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
      'editor.coldLoad.desktop',
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

  it('declares the same phase that docs/STATE.md declares', () => {
    const state = readFileSync(join(repoRoot, 'docs/STATE.md'), 'utf8');
    const declared = /^\*\*Phase:\*\*\s*(\S+)/m.exec(state)?.[1];

    expect(declared, 'docs/STATE.md must open with a **Phase:** line').toBeDefined();
    expect(
      document.currentPhase,
      'budgets.json currentPhase and docs/STATE.md disagree about the phase, so one of them is lying about what is enforced',
    ).toBe(declared);
  });
});
