import type { Mutation } from '../mutations.ts';

/**
 * The sixteen load-bearing exports that survived the whole suite at the P1 gate.
 *
 * QA Automation neutered each of these and 911 tests stayed green. They fall
 * into two groups, and both causes are structural rather than accidental.
 *
 * **The simulation's physics.** The determinism suite is invariant under every
 * deterministic change to them: it runs the simulation twice and compares, so
 * drag, restitution, the world's walls and the control speed can all be
 * neutered without moving it — two runs of the broken code agree exactly as
 * well as two runs of the correct code. `packages/runtime/test/systems.test.ts`
 * is the answer: each system reached through the dispatch table by the name the
 * step loop uses, asserted on what it did, against literal expectations rather
 * than against the constant being mutated.
 *
 * **The measurement harness.** Everything that decides what a budget measures
 * lived in a CLI or behind a fixture that zeroed the term under test. A
 * statistic is a guard, and one nobody audits is a guard that can be quietly
 * emptied — dropping `presentMs` under-reported the gated frame cost by 90%
 * with the entire suite, the E2E run and the budget gate green.
 *
 * Kept in its own file because `mutations.ts` outgrew the line limit, and
 * because these share a provenance worth keeping together: they are what one
 * adversarial pass found in code three reviewers had called well-guarded.
 */
export const P1_SURVIVORS: readonly Mutation[] = [
  {
    id: 'audit.frames.dropPresent',
    file: 'tools/audit/src/budgets/frames.ts',
    find: '  const perUpdate = sorted(frames.map((frame) => frame.updateMs + frame.presentMs));',
    replace: '  const perUpdate = sorted(frames.map((frame) => frame.updateMs));',
    breaks:
      'The measurement boundary. The gated statistic falls 4.4ms to 0.557ms — a ' +
      '90% under-report against an 8ms ceiling — and RC-0011 is back. Survived ' +
      '911 unit tests, the E2E suite and the budget gate at the P1 gate.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'audit.frames.noWarmup',
    file: 'tools/audit/src/budgets/frames.ts',
    find: 'export const WARMUP_FRAMES = 30;',
    replace: 'export const WARMUP_FRAMES = 0;',
    breaks:
      'The separation of cold-load cost from sustained cost. Shader ' +
      'compilation and JIT tiering enter a budget about steady state.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.session.previousStuck',
    file: 'packages/runtime/src/session.ts',
    find: '        previous = current;',
    replace: '        void current;',
    breaks:
      'Interpolation after the first frame. `previous` stays pinned to the ' +
      'initial snapshot, so every frame smears from the origin.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'runtime.session.ignoresBounds',
    file: 'packages/runtime/src/session.ts',
    // Anchored through the following line: `runHeadless` makes the identical
    // call, and an anchor matching twice is a mutation testing nothing.
    find:
      '  const world = createWorld(options.document, createRandom(options.seed), options.bounds);\n' +
      '  const loop = createTickLoop(',
    replace:
      '  const world = createWorld(options.document, createRandom(options.seed));\n' +
      '  const loop = createTickLoop(',
    breaks: 'A documented option. The world silently uses DEFAULT_BOUNDS instead.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'core.random.seedGuard',
    file: 'packages/core/src/random.ts',
    find: '  if (!Number.isInteger(seed)) {',
    replace: '  if (false) {',
    breaks:
      'A documented RangeError. A fractional seed truncates silently, so two ' +
      'runs a reader expects to differ produce the same sequence.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'render.interpolate.staleScratch',
    file: 'packages/render/src/interpolate.ts',
    find: '  scratch.index.clear();',
    replace: '  void scratch;',
    breaks:
      'Reuse of the scratch index across frames. Departed entities are never ' +
      'forgotten, the map grows without bound, and a returning id interpolates ' +
      'from wherever it was when it left.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'audit.bundle.doubleCount',
    file: 'tools/audit/src/bundle/measure.ts',
    find: '    editorBytes: total - runtimeBytes,',
    replace: '    editorBytes: total,',
    breaks:
      'The separation of the two bundle budgets. 97.6% of "the editor bundle" ' +
      'becomes three.js, and every byte of the renderer is counted twice.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'audit.bundle.shareFloor',
    file: 'tools/audit/src/bundle/measure.ts',
    find: 'export const MIN_RUNTIME_SHARE = 0.5;',
    replace: 'export const MIN_RUNTIME_SHARE = 0;',
    breaks:
      'The name-is-not-attribution check. A rename-only split reporting 2,050 ' +
      'bytes for a 128 KB runtime passes.',
    suite: 'unit',
    expect: 'killed',
  },
  {
    id: 'editor.chunks.dropCore',
    file: 'apps/editor/src/build/chunks.ts',
    find: "export const ENGINE_PACKAGES: readonly string[] = ['core', 'runtime', 'render'];",
    replace: "export const ENGINE_PACKAGES: readonly string[] = ['runtime', 'render'];",
    breaks:
      'The chunk split. The scene schema, serialiser and graph repair ship in ' +
      "the editor's entry chunk, and the share check cannot see it because " +
      'three.js is 97% of the runtime chunk either way.',
    suite: 'unit',
    expect: 'killed',
  },
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
