import { keyBetween } from '../../src/fractional-index.ts';
import { createIdFactory } from '../../src/ids.ts';
import { createRandom, type Random } from '../../src/random.ts';
import { sceneFrom } from '../../src/schema/build.ts';
import type {
  Component,
  ComponentId,
  Entity,
  EntityId,
  JsonValue,
  SceneDocument,
} from '../../src/index.ts';

/**
 * Randomly generated scene graphs, for property testing.
 *
 * Everything is driven by a seeded generator, so a failure names a seed that
 * reproduces it rather than describing a run nobody can repeat.
 *
 * The generator reaches for the awkward cases the brief names: deep chains,
 * wide fans, unicode names, empty documents, numeric-looking keys, and values
 * at the edges of what JSON can carry.
 *
 * It assembles entities in one pass via `sceneFrom` rather than calling
 * `addEntity` repeatedly. Both produce the same shape, but the incremental API
 * is linear per call by design, which is quadratic for ten thousand entities —
 * measured at over half a minute before this changed.
 */

export interface GeneratorOptions {
  readonly seed: number;
  readonly entityCount: number;
  /** Chance a new entity is parented under an existing one rather than a root. */
  readonly nestingChance?: number;
  readonly maxComponentsPerEntity?: number;
}

const DEFAULT_NESTING_CHANCE = 0.75;
const DEFAULT_MAX_COMPONENTS = 3;
const MAX_VALUE_DEPTH = 3;

/** Names chosen to stress encoding, not to look like a real scene. */
const NAME_SAMPLES = [
  'Player',
  'Enemy 01',
  '',
  '   leading and trailing   ',
  'quote " backslash \\ newline \n',
  'accented éüñ',
  'ideographic 日本語',
  'emoji \u{1f3ae}\u{1f4a5}',
  'combining áé',
  'rtl אבג',
];

const COMPONENT_TYPES = ['transform', 'sprite', 'collider', 'script', 'audio.source'];
const FIELD_NAMES = ['x', 'y', 'z', 'value', '0', '10', 'nested'];

/** Numbers at the edges of what a document can carry and still round-trip. */
const NUMBER_SAMPLES = [
  0,
  -0,
  1,
  -1,
  0.1,
  -0.1,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  1e-7,
  1e21,
  123456.789,
];

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[random.nextUint32() % items.length];
  if (item === undefined) throw new Error('cannot pick from an empty list');
  return item;
}

function randomKey(random: Random): string {
  // Numeric-looking keys are included on purpose: they are the case that
  // breaks canonical serialisation built on sorting into a fresh object.
  return random.nextUint32() % 3 === 0
    ? String(random.nextUint32() % 100)
    : pick(random, NAME_SAMPLES);
}

function randomValue(random: Random, depth: number): JsonValue {
  const choice = random.nextUint32() % (depth >= MAX_VALUE_DEPTH ? 4 : 6);
  switch (choice) {
    case 0:
      return null;
    case 1:
      return random.nextUint32() % 2 === 0;
    case 2:
      return pick(random, NUMBER_SAMPLES);
    case 3:
      return pick(random, NAME_SAMPLES);
    case 4:
      return Array.from({ length: random.nextUint32() % 4 }, () => randomValue(random, depth + 1));
    default: {
      const entries: Record<string, JsonValue> = {};
      const count = random.nextUint32() % 4;
      for (let i = 0; i < count; i += 1)
        entries[randomKey(random)] = randomValue(random, depth + 1);
      return entries;
    }
  }
}

function randomComponents(
  random: Random,
  ids: { component(): ComponentId },
  maxComponents: number,
): Record<ComponentId, Component> {
  const components: Record<ComponentId, Component> = {};
  const count = random.nextUint32() % (maxComponents + 1);
  for (let i = 0; i < count; i += 1) {
    const data: Record<string, JsonValue> = {};
    const fieldCount = random.nextUint32() % 4;
    for (let f = 0; f < fieldCount; f += 1) {
      data[pick(random, FIELD_NAMES)] = randomValue(random, 0);
    }
    const id = ids.component();
    components[id] = { id, type: pick(random, COMPONENT_TYPES), data };
  }
  return components;
}

/** Build a scene document from a seed. The same seed always builds the same one. */
export function generateScene(options: GeneratorOptions): SceneDocument {
  const random = createRandom(options.seed);
  const ids = createIdFactory(createRandom(options.seed ^ 0x5f3759df));
  const nesting = options.nestingChance ?? DEFAULT_NESTING_CHANCE;
  const maxComponents = options.maxComponentsPerEntity ?? DEFAULT_MAX_COMPONENTS;

  const entities: Entity[] = [];
  const created: EntityId[] = [];
  // Last ordering key issued per parent, so appends stay linear instead of
  // rescanning the sibling list on every insertion.
  const lastOrder = new Map<EntityId | null, string>();

  for (let i = 0; i < options.entityCount; i += 1) {
    const parent = created.length > 0 && random.next() < nesting ? pick(random, created) : null;
    const order = keyBetween(lastOrder.get(parent) ?? null, null);
    lastOrder.set(parent, order);

    const id = ids.entity();
    entities.push({
      id,
      name: pick(random, NAME_SAMPLES),
      parent,
      order,
      components: randomComponents(random, ids, maxComponents),
    });
    created.push(id);
  }

  return sceneFrom(ids.scene(), pick(random, NAME_SAMPLES), entities);
}
