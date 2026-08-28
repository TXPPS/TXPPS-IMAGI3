import { describe, expect, it } from 'vitest';
import {
  addComponent,
  addEntity,
  createIdFactory,
  createRandom,
  createScene,
  sceneFrom,
  type Entity,
  type SceneDocument,
} from '@imagi3/core';
import { createInputTape, type InputFrame } from '../src/input.ts';
import { runHeadless } from '../src/session.ts';
import { SYSTEM_ORDER } from '../src/simulation.ts';

/**
 * The P1 determinism gate: the same seed and the same input tape must produce
 * an identical entity state hash after ten thousand ticks, twice.
 *
 * "Twice" is not redundancy, it is the point. A single run establishes nothing
 * — any function returns the same value when you call it once. The claim is
 * that nothing in the simulation reads anything outside its declared inputs,
 * and the only way to see that fail is to run it again and compare.
 *
 * The hash is over the canonical serialisation of state, so this asserts a
 * property of the artifact rather than of the code that produced it.
 */

const TICKS = 10_000;
const SEED = 20260828;

/** A scene with controlled and uncontrolled entities, built from a seed. */
function referenceScene(seed: number, entityCount: number): SceneDocument {
  const random = createRandom(seed);
  const ids = createIdFactory(createRandom(seed ^ 0x9e3779b9));
  let document = createScene(ids, 'determinism reference');

  for (let i = 0; i < entityCount; i += 1) {
    const added = addEntity(document, ids, { name: `entity ${String(i)}` });
    document = addComponent(added.document, ids, added.id, 'transform', {
      x: (random.next() - 0.5) * 100,
      y: (random.next() - 0.5) * 100,
    }).document;
    document = addComponent(document, ids, added.id, 'motion', {
      vx: (random.next() - 0.5) * 20,
      vy: (random.next() - 0.5) * 20,
      controlled: i % 3 === 0,
    }).document;
  }
  return document;
}

/** An input tape that varies, so the run is not trivially input-free. */
function tape(seed: number, length: number): InputFrame[] {
  const random = createRandom(seed);
  return Array.from({ length }, () => ({
    axisX: Math.round(random.next() * 2 - 1),
    axisY: Math.round(random.next() * 2 - 1),
    pressed: random.next() < 0.05 ? ['Space'] : [],
  }));
}

const scene = referenceScene(1, 40);
const frames = tape(2, 500);

function run(overrides: { seed?: number; document?: SceneDocument } = {}): string {
  return runHeadless({
    document: overrides.document ?? scene,
    input: createInputTape(frames),
    seed: overrides.seed ?? SEED,
    ticks: TICKS,
  }).hash;
}

describe('determinism', () => {
  it('produces an identical state hash from the same seed and tape, run twice', () => {
    expect(run()).toBe(run());
  });

  it('produces the same hash a third time, from a freshly built scene', () => {
    // Rebuilding the document rules out the two runs sharing mutated state
    // through the scene rather than genuinely being independent.
    expect(run()).toBe(run({ document: referenceScene(1, 40) }));
  });

  it('produces a different hash from a different seed', () => {
    // Otherwise the test above would pass for a simulation that ignores its
    // inputs entirely, which is the failure mode a determinism test invites.
    expect(run()).not.toBe(run({ seed: SEED + 1 }));
  });

  it('produces a different hash from a different input tape', () => {
    const other = runHeadless({
      document: scene,
      input: createInputTape(tape(3, 500)),
      seed: SEED,
      ticks: TICKS,
    }).hash;
    expect(run()).not.toBe(other);
  });

  it('produces a different hash after a different number of ticks', () => {
    const shorter = runHeadless({
      document: scene,
      input: createInputTape(frames),
      seed: SEED,
      ticks: TICKS - 1,
    }).hash;
    expect(run()).not.toBe(shorter);
  });

  it('leaves no non-finite state to hash, which would fail loudly', () => {
    // The serialiser rejects NaN, so a simulation that produced one would throw
    // here rather than hash to a stable value and look deterministic.
    const { state } = runHeadless({
      document: scene,
      input: createInputTape(frames),
      seed: SEED,
      ticks: TICKS,
    });
    for (const entity of state.entities) {
      expect(Number.isFinite(entity.x) && Number.isFinite(entity.y)).toBe(true);
      expect(Number.isFinite(entity.vx) && Number.isFinite(entity.vy)).toBe(true);
    }
  });
});

/**
 * Iteration order is the thing most likely to break determinism silently, and
 * it will not announce itself: floating-point addition is not associative, so a
 * reordering produces a slightly different world that compounds over ten
 * thousand ticks.
 */
describe('iteration order', () => {
  function permuted(document: SceneDocument, seed: number): SceneDocument {
    const random = createRandom(seed);
    const entities: Entity[] = Object.values(document.entities);
    for (let i = entities.length - 1; i > 0; i -= 1) {
      const j = random.nextUint32() % (i + 1);
      const a = entities[i];
      const b = entities[j];
      if (a === undefined || b === undefined) continue;
      entities[i] = b;
      entities[j] = a;
    }
    return sceneFrom(document.id, document.name, entities);
  }

  it('does not depend on how the document happened to be assembled', () => {
    const expected = run();
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(
        run({ document: permuted(scene, seed) }),
        `insertion order ${String(seed)} simulated differently`,
      ).toBe(expected);
    }
  });

  it('actually permutes the document, so the assertion is not vacuous', () => {
    const shuffled = permuted(scene, 1);
    expect(Object.keys(shuffled.entities)).not.toEqual(Object.keys(scene.entities));
    expect(Object.keys(shuffled.entities).sort()).toEqual(Object.keys(scene.entities).sort());
  });
});

describe('system order', () => {
  it('is the declared sequence', () => {
    // Reordering systems changes behaviour — integrating before collision
    // leaves entities out of bounds for a frame, and moving the random draw
    // changes which entity gets which value. A change here should be a
    // deliberate one with this test updated alongside it.
    expect([...SYSTEM_ORDER]).toEqual(['input', 'jitter', 'drag', 'integrate', 'collide']);
  });
});
