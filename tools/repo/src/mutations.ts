/**
 * Mutation sweep: neuter each load-bearing export and require a test to fail.
 *
 * The guard audit asks, of each detector, whether the defect it catches could
 * also delete it. That is a real property and it found two self-deleting
 * guards. It is also structurally incapable of finding a surface with **no**
 * detector, because such a surface has no row in the table — and that is not a
 * hypothetical limitation. The renderer shipped with no visual assertion of any
 * kind, and replacing `SceneView.present` with an empty function left 794 tests
 * green while the page drew nothing (RC-0009).
 *
 * This is the inverse method. It starts from production code rather than from
 * detectors: for each load-bearing export, apply a mutation that neuters it,
 * run the suite, and require at least one test to fail. A mutation that
 * survives is a coverage hole — not a warning, a build failure — and is
 * recorded in `docs/BUGS.md` with the missing assertion named.
 *
 * **Load-bearing** means removing or neutering it changes observable program
 * behaviour. A formatter, a type-only export or a pure convenience wrapper is
 * not load-bearing and is not listed; listing one produces a survivor that is
 * correct and teaches people to ignore survivors.
 *
 * Mutations are textual and exact. A mutation whose `find` is not present in
 * the file is itself a failure — the code moved and the mutation is now testing
 * nothing, which is the same rot the anchor checks in `verified-edit.ts` exist
 * to prevent.
 */

export interface Mutation {
  /** Stable id, used in reports and in BUGS.md entries. */
  readonly id: string;
  /** Repository-relative file to mutate. */
  readonly file: string;
  /** Exact text to replace. Must appear exactly once. */
  readonly find: string;
  /** What to replace it with — a neutered form of the same code. */
  readonly replace: string;
  /** What breaks in the running program when this mutation is live. */
  readonly breaks: string;
  /**
   * What a correct suite does with this mutation.
   *
   * `killed` for a real defect. `survives` for an **inverse control** — a
   * change that must *not* move a measurement, where a test failing would mean
   * the measurement is sensitive to something it claims to exclude.
   *
   * Modelled as a field rather than as a special case, because the first
   * version had only one notion of success and reported the device-pixel-ratio
   * control as a coverage hole when it did exactly the right thing. A checker
   * whose passing condition cannot express the outcome it wants is the RC-0012
   * shape, one level down.
   */
  readonly expect: 'killed' | 'survives';
  /**
   * Which suite can see it. `unit` runs in milliseconds; `e2e` needs a browser.
   *
   * Split so the fast subset can run per commit and the whole sweep per gate,
   * rather than the whole thing being too slow to run at all and therefore
   * never running.
   */
  readonly suite: 'unit' | 'e2e';
}

/**
 * The three seed mutations, each already proven decisive against this codebase.
 *
 * They are first in the list because they are the evidence that the method
 * works: every one of them survived a full suite at some point in P1, and each
 * cost a reviewer to find.
 */
const PROVEN: readonly Mutation[] = [
  {
    id: 'render.present.noop',
    file: 'packages/render/src/view.ts',
    find: '    present: () => {\n      renderer.render(scene, camera);\n    },',
    replace: '    present: () => {\n      /* mutation: draw nothing */\n    },',
    breaks: 'Every draw call in the engine. The page renders one flat colour.',
    suite: 'e2e',
    expect: 'killed',
  },
  {
    id: 'render.pixelRatio.halved',
    file: 'apps/editor/src/playmode/index.ts',
    find: 'export const MAX_PIXEL_RATIO = 2;',
    replace: 'export const MAX_PIXEL_RATIO = 1;',
    breaks:
      'Nothing in the engine. This is the inverse control: a pure rasteriser ' +
      'change must NOT move the engine frame budget. It moved it 44% once.',
    suite: 'e2e',
    expect: 'survives',
  },
  {
    id: 'runtime.systemOrder.reversed',
    file: 'packages/runtime/src/simulation.ts',
    find: '  for (const name of SYSTEM_ORDER) {',
    replace: '  for (const name of [...SYSTEM_ORDER].reverse()) {',
    breaks:
      'The order systems run in, and therefore the world. Asserting the ' +
      'SYSTEM_ORDER literal does not assert this and passed 732 tests.',
    suite: 'unit',
    expect: 'killed',
  },
];

/** Load-bearing exports in core and runtime, one neutering mutation each. */
const CORE_AND_RUNTIME: readonly Mutation[] = [
  {
    id: 'core.canonical.sortKeys',
    file: 'packages/core/src/canonical.ts',
    find: '  const keys = Object.keys(value).sort();',
    replace: '  const keys = Object.keys(value);',
    breaks: 'Byte-stable serialisation, and therefore content addressing.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.fractionalIndex.trailingZero',
    file: 'packages/core/src/fractional-index.ts',
    find: '  return isSortableIndexKey(key) && !key.endsWith(SMALLEST_DIGIT);',
    replace: '  return isSortableIndexKey(key);',
    breaks: 'The invariant that keeps every position insertable forever.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.graph.sortedIds',
    file: 'packages/core/src/graph.ts',
    find: '  return Object.keys(document.entities).sort();',
    replace: '  return Object.keys(document.entities);',
    breaks: 'Repair determinism. Peers diverge on the same merge.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.graph.lowestId',
    file: 'packages/core/src/graph.ts',
    find: '  const sorted = [...cycle].sort();',
    replace: '  const sorted = [...cycle];',
    breaks: 'Which member of a cycle is detached, and therefore convergence.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.validate.finiteNumbers',
    file: 'packages/core/src/schema/validate.ts',
    find: '    if (!Number.isFinite(value)) {\n      fail(',
    replace: '    if (Number.isFinite(value)) {\n      fail(',
    breaks: 'NaN and the infinities enter documents that cannot round-trip.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.compareSiblings.idTiebreak',
    file: 'packages/core/src/graph.ts',
    find: '  if (a.id === b.id) return 0;\n  return a.id < b.id ? -1 : 1;',
    replace: '  return 0;',
    breaks: 'The total order on siblings sharing an ordering key.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.tick.accumulator',
    file: 'packages/runtime/src/tick.ts',
    find: '    while (accumulator >= stepMs) {',
    replace: '    if (accumulator >= stepMs) {',
    breaks: 'Catching up after a slow frame. Simulated time falls behind.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.tick.frameClamp',
    file: 'packages/runtime/src/tick.ts',
    find: '    const droppedMs = Math.max(0, elapsedMs - maxFrameMs);',
    replace: '    const droppedMs = 0;',
    breaks: 'The spiral-of-death defence after a backgrounded tab.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.world.sortedOrder',
    file: 'packages/runtime/src/simulation.ts',
    find: '  const entities = Object.keys(document.entities)\n    .sort()',
    replace: '  const entities = Object.keys(document.entities)',
    breaks: 'Deterministic iteration, and therefore the whole determinism gate.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.input.clampAxis',
    file: 'packages/runtime/src/input.ts',
    find: '  return Math.min(1, Math.max(-1, value));',
    replace: '  return value;',
    breaks: 'Axis bounds. A device reporting 5 accelerates five times as fast.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.input.sortPressed',
    file: 'packages/runtime/src/input.ts',
    find: '    pressed: [...new Set(frame.pressed)].sort(),',
    replace: '    pressed: [...frame.pressed],',
    breaks: 'Device-order independence of edge-triggered actions.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.hash.fields',
    file: 'packages/runtime/src/hash.ts',
    find: '      vx: entity.vx,\n      vy: entity.vy,',
    replace: '',
    breaks: 'Velocity leaves the state hash; the determinism gate stops seeing it.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'render.interpolate.matchById',
    file: 'packages/render/src/interpolate.ts',
    find: '    const from = scratch.index.get(entity.id);',
    replace: '    const from = previous.entities[index];',
    breaks: 'Matching by id. Entities smear across the screen when the set changes.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'render.interpolate.clampAlpha',
    file: 'packages/render/src/interpolate.ts',
    find: '  const clamped = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;',
    replace: '  const clamped = alpha;',
    breaks: 'Extrapolation past the current state, drawn as jitter.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'render.view.aspect',
    file: 'packages/render/src/view.ts',
    find: '  const aspect = width / height;',
    replace: '  const aspect = 1;',
    breaks: 'Aspect correction. A square sprite draws as a rectangle.',
    suite: 'unit',
    expect: 'killed',
  },
];

export const MUTATIONS: readonly Mutation[] = [...PROVEN, ...CORE_AND_RUNTIME];

/**
 * The positive control. See `unguarded.ts` for why it lives in its own file.
 *
 * A sweep that reports no coverage holes proves nothing unless it can be shown
 * to report one, so this mutation must always survive. If it stops surviving,
 * someone has written an assertion against the function and the control needs
 * replacing — not the assertion deleting.
 */
export const CONTROL_MUTATION: Mutation = {
  id: 'control.unguarded',
  file: 'tools/repo/src/unguarded.ts',
  find: '  return value * 2;',
  replace: '  return value;',
  breaks: 'Nothing. That is the point — this mutation must survive.',
  suite: 'unit',
  expect: 'survives',
};

export interface MutationOutcome {
  readonly mutation: Mutation;
  /** True when at least one test failed, which is the required result. */
  readonly killed: boolean;
  readonly detail: string;
}

export interface MutationReport {
  readonly ok: boolean;
  readonly outcomes: readonly MutationOutcome[];
  /** Mutations whose outcome was not what the entry expects. */
  readonly unexpected: readonly MutationOutcome[];
}

/** Whether an outcome matched what its entry expects. */
export function matchedExpectation(outcome: MutationOutcome): boolean {
  return outcome.killed === (outcome.mutation.expect === 'killed');
}

export function judgeMutations(outcomes: readonly MutationOutcome[]): MutationReport {
  const unexpected = outcomes.filter((o) => !matchedExpectation(o));
  return { ok: unexpected.length === 0, outcomes, unexpected };
}

export function formatMutationReport(report: MutationReport): string {
  const lines = ['Mutation sweep'];
  for (const outcome of report.outcomes) {
    const result = outcome.killed ? 'KILLED  ' : 'SURVIVED';
    const mark = matchedExpectation(outcome) ? ' ' : '!';
    const control = outcome.mutation.expect === 'survives' ? ' (inverse control)' : '';
    lines.push(`  ${mark} ${result} ${outcome.mutation.id}${control}`);
  }
  for (const outcome of report.unexpected) {
    lines.push('');
    if (outcome.mutation.expect === 'killed') {
      lines.push(
        `  ${outcome.mutation.id} survived. Production code can be neutered with no`,
        `  test noticing: ${outcome.mutation.breaks}`,
        '  That is a coverage hole, not a warning. Name the missing assertion in',
        '  docs/BUGS.md and write it — a TODO is not a resolution.',
      );
    } else {
      lines.push(
        `  ${outcome.mutation.id} was killed, and it is an inverse control that must`,
        '  survive. A test is sensitive to something the measurement claims to',
        '  exclude, which is the RC-0011 shape. Find which test, and why.',
      );
    }
  }
  lines.push(
    '',
    report.ok
      ? `MUTATION SWEEP OK: ${String(report.outcomes.length)} mutations, every outcome as expected`
      : `MUTATION SWEEP FAILED: ${String(report.unexpected.length)} unexpected`,
  );
  return lines.join('\n');
}
