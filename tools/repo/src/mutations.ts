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

/**
 * Projection audits: a field silently dropped from a hash or a canonical form.
 *
 * A property test is only as strong as what it projects. The determinism suite
 * compares a digest; the round-trip test compares a canonical form. A field
 * absent from either is invisible to the test that exists to catch it changing
 * — which is exactly how velocity went missing from the state hash and nothing
 * noticed for a whole phase.
 *
 * These two mutations are the proof that the audits added for that class are
 * not vacuous. Each drops one field from one projection.
 */
const PROJECTION_AUDITS: readonly Mutation[] = [
  {
    id: 'runtime.hash.dropControlled',
    file: 'packages/runtime/src/hash.ts',
    find: '      controlled: entity.controlled,\n',
    replace: '',
    breaks: 'A field of simulation state leaves the digest the determinism gate compares.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.validate.dropOrder',
    file: 'packages/core/src/schema/validate.ts',
    find: '    parent: parent ?? null,\n    order,\n',
    replace: '    parent: parent ?? null,\n',
    breaks:
      "An entity's ordering key is accepted at the boundary and then dropped, " +
      'which the round-trip test cannot see because it compares the validated ' +
      'document to itself.',
    suite: 'unit',
    expect: 'killed',
  },
];

/** Load-bearing exports in core and runtime, one neutering mutation each. */
/**
 * The reference simulation's physics, which nothing observed until the P1 gate.
 *
 * QA Automation neutered sixteen load-bearing exports and the suite stayed
 * green for all of them; six of those were these. The cause is structural and
 * worth stating, because it generalises: **the determinism suite is invariant
 * under every deterministic change to the physics.** It runs the simulation
 * twice and compares, so drag, restitution, the world's walls and the control
 * speed can all be neutered without moving it — two runs of the broken code
 * agree exactly as well as two runs of the correct code.
 *
 * `packages/runtime/test/systems.test.ts` is the answer: each system reached
 * through the dispatch table by the name the step loop uses, asserted on what
 * it did, against literal expectations rather than against the constant being
 * mutated.
 */
const SIMULATION_PHYSICS: readonly Mutation[] = [
  {
    id: 'runtime.drag.noop',
    file: 'packages/runtime/src/simulation.ts',
    find: '  const retained = DRAG_PER_SECOND ** stepSeconds;',
    replace: '  const retained = 1;',
    breaks: 'Drag entirely. Every entity coasts forever, and 969 tests passed.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.input.controlledGuard',
    file: 'packages/runtime/src/simulation.ts',
    find: '    if (!entity.controlled) continue;',
    replace: '    if (false) continue;',
    breaks: 'Every entity in the scene is driven by the player, not just theirs.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.restitution.inelastic',
    file: 'packages/runtime/src/simulation.ts',
    find: 'export const RESTITUTION = 0.8;',
    replace: 'export const RESTITUTION = 0;',
    breaks: 'Bounces. Everything that touches a wall stops dead against it.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.bounds.unbounded',
    file: 'packages/runtime/src/simulation.ts',
    find: 'export const DEFAULT_BOUNDS: Bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };',
    replace: 'export const DEFAULT_BOUNDS: Bounds = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };',
    breaks: 'The walls. Nothing ever reaches one, so collision is unreachable.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.integrate.doubleStep',
    file: 'packages/runtime/src/simulation.ts',
    find: '    entity.x += entity.vx * stepSeconds;',
    replace: '    entity.x += entity.vx * stepSeconds * 2;',
    breaks: 'The relationship between velocity and time. Everything moves twice as fast.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.emptyInput.notNeutral',
    file: 'packages/runtime/src/input.ts',
    find: "export const EMPTY_INPUT: InputFrame = { axisX: 0, axisY: 0, pressed: [] };",
    replace: "export const EMPTY_INPUT: InputFrame = { axisX: 1, axisY: 0, pressed: [] };",
    breaks: 'The neutral frame. A run nobody touched the controls in accelerates.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.systems.rewired',
    file: 'packages/runtime/src/simulation.ts',
    find: '  drag: applyDrag,\n  integrate,',
    replace: '  drag: integrate,\n  integrate: applyDrag,',
    breaks:
      'Which function each name dispatches to. The observed system sequence is ' +
      'unchanged and the world is not: hash 89f827c3 became 405759c4.',
    suite: 'unit',
    expect: 'killed',
  },
];

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

/**
 * Hand-picked mutations.
 *
 * These **supplement** the mechanically enumerated set in `enumerate.ts`; they
 * never substitute for it. Judgement chose these, and judgement is what missed
 * the two holes the first sweep found — in packages three reviewers had
 * independently called well-guarded, using 22 mutations they had chosen
 * themselves. Enumeration is the floor; this list is what enumeration cannot
 * express, such as a field dropped from a projection.
 */
export const MUTATIONS: readonly Mutation[] = [
  ...PROVEN,
  ...PROJECTION_AUDITS,
  ...SIMULATION_PHYSICS,
  ...CORE_AND_RUNTIME,
];

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

/**
 * The mutations a sweep of this suite runs, always including the control.
 *
 * The control used to be opt-in behind a `--control` flag, which meant the runs
 * that mattered — CI, and every run anyone did by habit — carried no evidence
 * that the sweep could report a survivor at all. It could not: QA Automation
 * showed at the P1 gate that the kill signal was the sweep's own anchor test,
 * so every unit mutation read `killed` regardless, and the control was the one
 * entry exempted from the masking mechanism, which is exactly why the sweep
 * looked as though it worked. An opt-in positive control is a control nobody
 * runs on the day it would have told them something.
 *
 * Lives here rather than in the CLI so it can be tested: the CLI assigns
 * `process.exitCode` at import time and cannot be imported by a test.
 */
export function mutationsForSuite(suite: Mutation['suite'] | 'all'): Mutation[] {
  const chosen = MUTATIONS.filter((m) => suite === 'all' || m.suite === suite);
  return [...chosen, CONTROL_MUTATION];
}

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
