import type { Entity, EntityId, JsonValue, Random, SceneDocument } from '@imagi3/core';
import type { InputFrame } from './input.ts';

/**
 * The simulation: entity state, and the systems that advance it.
 *
 * Two rules decide everything here, and both come from the determinism
 * requirement rather than from taste.
 *
 * **Iteration order is sorted entity id, everywhere.** Not insertion order,
 * which differs between a document built by an editor and the same document
 * parsed from disk; not `Object.keys`, which is insertion order with integer-
 * like keys hoisted. Floating-point addition is not associative, so a different
 * iteration order is a different answer, and the difference compounds over ten
 * thousand ticks into a visibly different world. The same rule governs the
 * graph repair in core, for the same reason.
 *
 * **Systems run in a fixed, declared sequence.** `SYSTEM_ORDER` is the sequence
 * and it is data, so a reader can see it without tracing calls, and a test can
 * assert it has not silently changed.
 */

/** Per-entity simulation state. Mutable, and owned solely by the simulation. */
export interface EntityState {
  readonly id: EntityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether input drives this entity. Read from the scene, never inferred. */
  readonly controlled: boolean;
}

export interface World {
  /** Entities in the documented stable order: ascending id. */
  readonly entities: readonly EntityState[];
  readonly bounds: Bounds;
  readonly random: Random;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const DEFAULT_BOUNDS: Bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

/** Component types the runtime reads. Everything else is data it carries. */
export const TRANSFORM_COMPONENT = 'transform';
export const MOTION_COMPONENT = 'motion';

function numberField(data: Readonly<Record<string, JsonValue>>, key: string): number {
  const value = data[key];
  // A field of the wrong type is zero, not a throw. Component data is open by
  // design and belongs to whoever owns the type; the runtime reading a field it
  // does not recognise must not take down a scene the schema already accepted.
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stateFor(entity: Entity): EntityState {
  const components = Object.values(entity.components);
  const transform = components.find((component) => component.type === TRANSFORM_COMPONENT);
  const motion = components.find((component) => component.type === MOTION_COMPONENT);

  return {
    id: entity.id,
    x: transform === undefined ? 0 : numberField(transform.data, 'x'),
    y: transform === undefined ? 0 : numberField(transform.data, 'y'),
    vx: motion === undefined ? 0 : numberField(motion.data, 'vx'),
    vy: motion === undefined ? 0 : numberField(motion.data, 'vy'),
    controlled: motion?.data['controlled'] === true,
  };
}

/**
 * Build simulation state from a scene document.
 *
 * The document is read once and never consulted again during the run. Scene
 * data is the *initial condition*; a simulation that kept reading it would make
 * a mid-run edit change history, which is exactly what play mode must not do.
 */
export function createWorld(
  document: SceneDocument,
  random: Random,
  bounds: Bounds = DEFAULT_BOUNDS,
): World {
  const entities = Object.keys(document.entities)
    .sort()
    .map((id) => {
      const entity = document.entities[id];
      if (entity === undefined) throw new Error(`no entity "${id}" in this document`);
      return stateFor(entity);
    });
  return { entities, bounds, random };
}

/** Milliseconds per second, so the step-to-seconds conversion is not a literal. */
const MS_PER_SECOND = 1000;
/** Centre of the unit interval, so jitter is symmetric about zero. */
const HALF = 0.5;

/** Units per second an input axis contributes. */
export const CONTROL_SPEED = 40;
/** Fraction of velocity retained per second by an uncontrolled entity. */
export const DRAG_PER_SECOND = 0.5;
/** Velocity retained after a bounce. */
export const RESTITUTION = 0.8;
/**
 * Random jitter applied per second.
 *
 * Its purpose is to put a seeded draw inside the step, so an ordering mistake
 * shows up as a hash mismatch rather than as a rounding difference nobody
 * notices — asserted by `packages/runtime/test/determinism.test.ts`.
 */
export const JITTER = 0.25;

type System = (world: World, input: InputFrame, stepSeconds: number) => void;

function applyInput(world: World, input: InputFrame, stepSeconds: number): void {
  for (const entity of world.entities) {
    if (!entity.controlled) continue;
    entity.vx += input.axisX * CONTROL_SPEED * stepSeconds;
    entity.vy += input.axisY * CONTROL_SPEED * stepSeconds;
  }
}

function applyDrag(world: World, _input: InputFrame, stepSeconds: number): void {
  const retained = DRAG_PER_SECOND ** stepSeconds;
  for (const entity of world.entities) {
    entity.vx *= retained;
    entity.vy *= retained;
  }
}

/**
 * Random jitter, drawn in the stable iteration order.
 *
 * A seeded generator is a sequence, so *which entity gets which draw* is part
 * of the result. Iterating in a different order does not merely shuffle the
 * jitter, it produces a different world — which is why this system exists in
 * the reference simulation at all: it makes an ordering mistake visible as a
 * hash mismatch instead of as a rounding difference nobody notices.
 */
function applyJitter(world: World, _input: InputFrame, stepSeconds: number): void {
  for (const entity of world.entities) {
    entity.vx += (world.random.next() - HALF) * JITTER * stepSeconds;
    entity.vy += (world.random.next() - HALF) * JITTER * stepSeconds;
  }
}

function integrate(world: World, _input: InputFrame, stepSeconds: number): void {
  for (const entity of world.entities) {
    entity.x += entity.vx * stepSeconds;
    entity.y += entity.vy * stepSeconds;
  }
}

function bounceAxis(
  position: number,
  velocity: number,
  low: number,
  high: number,
): { position: number; velocity: number } {
  if (position < low) return { position: low, velocity: -velocity * RESTITUTION };
  if (position > high) return { position: high, velocity: -velocity * RESTITUTION };
  return { position, velocity };
}

function collide(world: World): void {
  const { bounds } = world;
  for (const entity of world.entities) {
    const x = bounceAxis(entity.x, entity.vx, bounds.minX, bounds.maxX);
    const y = bounceAxis(entity.y, entity.vy, bounds.minY, bounds.maxY);
    entity.x = x.position;
    entity.vx = x.velocity;
    entity.y = y.position;
    entity.vy = y.velocity;
  }
}

/**
 * The system sequence, as data.
 *
 * Order is part of the observable behaviour, not an implementation detail:
 * integrating before collision leaves entities outside the bounds for a frame,
 * and drawing a random number before or after input changes which draw each
 * entity gets. A test asserts this list, so a reordering is a deliberate change
 * with a failing test attached rather than a silent one.
 */
export const SYSTEM_ORDER = ['input', 'jitter', 'drag', 'integrate', 'collide'] as const;

export type SystemName = (typeof SYSTEM_ORDER)[number];

/**
 * What each name dispatches to.
 *
 * **Exported so it can be tested through, not merely read.** The observer below
 * reports the loop variable, which is the *key* — so swapping two values here
 * (`drag: integrate, integrate: applyDrag`) produces the identical observed
 * sequence over a materially different world, and QA Automation demonstrated
 * exactly that at the P1 gate with all 911 tests green. That is the same defect
 * as reading `SYSTEM_ORDER` instead of the loop, one level further down: a
 * guard on the label rather than on the behaviour.
 *
 * `packages/runtime/test/systems.test.ts` closes it by asserting each name's
 * characteristic effect through this record — drag slows and does not move,
 * integrate moves and does not slow, and so on — so a rewiring fails on what
 * the system did rather than on what it was called.
 *
 * `collide` is a plain reference rather than the wrapper arrow it used to be.
 * A `System` may accept fewer parameters, so the wrapper bought nothing, and an
 * arrow assigned to a property takes its name from the property — which is the
 * one function here whose identity would have followed a swap.
 */
export const SYSTEMS: Readonly<Record<SystemName, System>> = {
  input: applyInput,
  jitter: applyJitter,
  drag: applyDrag,
  integrate,
  collide,
};

/**
 * Advance the world by exactly one fixed step.
 *
 * `observer` exists so a test can assert the order systems actually run in.
 * Asserting the `SYSTEM_ORDER` literal is not the same claim and does not imply
 * it: QA Automation reversed the iteration here while leaving the array
 * untouched, and all 732 tests passed on a materially different world. A guard
 * that reads the declaration rather than the behaviour is a guard the defect
 * walks past.
 */
export function stepWorld(
  world: World,
  input: InputFrame,
  stepMs: number,
  observer?: (name: SystemName) => void,
): void {
  const stepSeconds = stepMs / MS_PER_SECOND;
  for (const name of SYSTEM_ORDER) {
    observer?.(name);
    SYSTEMS[name](world, input, stepSeconds);
  }
}

/** A snapshot for interpolation and hashing. Never fed back into simulation. */
export interface WorldSnapshot {
  readonly entities: readonly EntityState[];
}

export function snapshot(world: World): WorldSnapshot {
  return { entities: world.entities.map((entity) => ({ ...entity })) };
}
