import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLD_LOAD_BUDGET_IDS,
  findBudgetsNamingProfile,
  isCiHeadlessBudget,
} from '../../src/budgets/ids.ts';
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
const MANDATED: readonly (readonly [string, 'max' | 'min', number, string, string])[] = [
  ['ci-headless.editor.coldLoad', 'max', 3_000, 'P0', 'desktop'],
  ['editor.coldLoad.tablet', 'max', 6_000, 'P0', 'tablet'],
  ['editor.coldLoad.phone', 'max', 6_000, 'P0', 'phone'],
  ['editor.bundle.gzip', 'max', 5_000_000, 'P0', 'all'],
  ['runtime.bundle.gzip', 'max', 1_500_000, 'P1', 'all'],
  ['playmode.cpuFrame.tablet.reference2d', 'max', 8, 'P1', 'tablet'],
  // Deferred from P1 to P9, which is normally the silent-disable this list
  // exists to prevent. It is allowed here, and only here, because the budget
  // cannot be measured without a GPU — CI renders through SwiftShader, where an
  // empty scene already misses 60fps before the engine does anything. The
  // conditions that make the deferral legitimate are asserted below rather than
  // taken on trust. See ADR-0015, GAP-011 and DV-007.
  ['playmode.droppedFrames.tablet.reference2d', 'max', 0.05, 'P9', 'tablet'],
  ['editor.frameSpike.max', 'max', 32, 'P3', 'all'],
  ['soak.heapGrowth.ratio', 'max', 1.1, 'P3', 'all'],
  ['playmode.fps.phone.reference3d', 'min', 30, 'P6', 'phone'],
  ['playmode.heap.peak.phone', 'max', 500_000_000, 'P6', 'phone'],
  ['gpu.texture.phone', 'max', 256_000_000, 'P6', 'phone'],
];

describe('the committed budgets.json', () => {
  it.each(MANDATED)(
    'pins %s %s at %d, enforced from %s, scoped to %s',
    (id, bound, value, phase, scope) => {
      expect(rule(id)[bound]).toBe(value);
      expect(rule(id).enforcedFrom).toBe(phase);
      // Scope is load-bearing, not decorative: widening a device-scoped budget
      // to "all" exempts it from the throttling-evidence check entirely, which
      // is a one-word edit that would otherwise pass unremarked.
      expect(rule(id).scope).toBe(scope);
    },
  );

  it('declares no rules beyond those pinned here', () => {
    expect([...byId.keys()].sort()).toEqual(MANDATED.map(([id]) => id).sort());
  });

  /**
   * A deferred budget is only honest if something still measures what can be
   * measured. Deferring `playmode.fps.tablet.reference2d` is the one place this
   * repository has pushed a budget's enforcement out, and these are the
   * conditions that were argued for it — asserted, so the argument cannot decay
   * into a precedent for deferring anything inconvenient.
   */
  describe('the one deferred budget', () => {
    const deferred = rule('playmode.droppedFrames.tablet.reference2d');

    it('is not enforced before P9, because no GPU here can measure it', () => {
      expect(deferred.enforcedFrom).toBe('P9');
    });

    it('keeps the full 60fps target, stated so the instrument can express it', () => {
      // Deferring a measurement is not the same as lowering a bar. The target
      // is unchanged — "60fps" means "drops no frames at 60Hz" — but the
      // original statistic, a p95 rAF interval, reads 59.2fps on an empty page
      // and so could never have passed. See RC-0012.
      expect(deferred.max).toBe(0.05);
    });

    it('says in its own source why it is deferred and where the claim lives', () => {
      expect(deferred.source).toContain('DV-007');
      expect(deferred.source).toContain('GAP-011');
    });

    it('leaves a CI-measurable counterpart enforced from P1', () => {
      // The substitution that makes the deferral defensible: the part this
      // environment can measure is still gated, at the same phase.
      const counterpart = rule('playmode.cpuFrame.tablet.reference2d');
      expect(counterpart.enforcedFrom).toBe('P1');
      expect(counterpart.scope).toBe(deferred.scope);
    });

    it('is the only budget whose enforcement was pushed past its brief phase', () => {
      // Everything else enforced from P9 would be a second deferral nobody
      // argued for. There is exactly one, and it is this one.
      const atP9 = document.rules.filter((r) => r.enforcedFrom === 'P9').map((r) => r.id);
      expect(atP9).toEqual(['playmode.droppedFrames.tablet.reference2d']);
    });
  });

  it('expresses byte budgets in decimal units, the stricter reading of the brief', () => {
    // 1.5 MiB would be 1572864 — about 4.9% more lenient. See ADR-0006.
    expect(rule('runtime.bundle.gzip').max).toBeLessThan(1024 * 1024 * 1.5);
    expect(rule('playmode.heap.peak.phone').max).toBeLessThan(1024 * 1024 * 500);
    expect(rule('gpu.texture.phone').max).toBeLessThan(1024 * 1024 * 256);
  });

  /**
   * ADR-0006: a `max` alone accepts zero, so a harness bug that measures
   * nothing reports a perfect score. This test was named "every duration and
   * size budget" and iterated a hardcoded list of the four P0 ones — so the
   * three rules P1 added had no floor and nobody noticed. Performance broke the
   * play-mode instrument to `performance.now() - performance.now()` and the
   * gate printed "0 ms within budget".
   *
   * Derived from the document now, so a rule cannot be added without one.
   */
  it('gives every ceiling budget a floor, whatever it measures', () => {
    // Generalised by *shape*, not by unit. The previous version selected
    // `unit === 'ms' || unit === 'bytes'`, which is the same hardcoded-list
    // mistake one level up: `soak.heapGrowth.ratio` is a ceiling in a third
    // unit, and a harness reporting 0 for it scored perfectly. Performance
    // found it at pass 2. The property is "a max alone accepts zero", and that
    // has nothing to do with the unit.
    const ceilings = document.rules.filter((r) => r.max !== undefined);
    expect(ceilings.length, 'no ceiling budgets were examined').toBeGreaterThan(4);
    for (const budgetRule of ceilings) {
      expect(
        budgetRule.min,
        `${budgetRule.id} has no floor, so a harness measuring nothing would score perfectly`,
      ).toBeDefined();
    }
  });

  it('makes a floor of zero a stated decision rather than an omission', () => {
    // `min: 0` is legitimate where zero is a real result — no dropped frames is
    // the ideal, not a broken instrument. It is only legitimate when someone
    // decided it, so the rule has to say why.
    for (const budgetRule of document.rules.filter((r) => r.min === 0)) {
      expect(
        budgetRule.description.toLowerCase(),
        `${budgetRule.id} has a floor of zero and does not say why zero is a real measurement`,
      ).toContain('zero');
    }
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
      const named = findBudgetsNamingProfile(
        document.rules.map((r) => r.id),
        profileId as keyof typeof DEVICE_PROFILES,
      ).map((id) => ({ id }));
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

/**
 * Positive controls for the device-naming detector. A review found this guard
 * had none: gutting its filter expression left the suite green, because a clean
 * budget file gives it nothing to find. It was load-bearing against real
 * regressions, but nothing pinned the expression itself.
 */
describe('findBudgetsNamingProfile', () => {
  it('flags a budget named after a profile', () => {
    expect(findBudgetsNamingProfile(['editor.coldLoad.desktop'], 'desktop')).toEqual([
      'editor.coldLoad.desktop',
    ]);
  });

  it('flags a profile name in any segment, not only the last', () => {
    expect(findBudgetsNamingProfile(['desktop.editor.coldLoad'], 'desktop')).toEqual([
      'desktop.editor.coldLoad',
    ]);
  });

  it('exempts an id that admits it is ci-headless', () => {
    expect(findBudgetsNamingProfile(['ci-headless.editor.coldLoad'], 'desktop')).toEqual([]);
  });

  it('does not flag a different profile', () => {
    expect(findBudgetsNamingProfile(['editor.coldLoad.tablet'], 'desktop')).toEqual([]);
  });

  it('does not flag a substring that is not its own segment', () => {
    expect(findBudgetsNamingProfile(['editor.desktopish.coldLoad'], 'desktop')).toEqual([]);
  });

  it('returns nothing for an empty list', () => {
    expect(findBudgetsNamingProfile([], 'desktop')).toEqual([]);
  });
});
