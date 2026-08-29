import type { Random } from './random.ts';

/**
 * Opaque generated identifiers.
 *
 * ADR-0012 requires that identity is never positional: entities and components
 * are addressed by id, because an array index does not survive a merge. Two
 * peers inserting at index 3 do not mean the same thing, and after merging
 * neither index 3 is what either meant.
 *
 * Ids are opaque on purpose. The prefix is for humans reading a diff, and
 * nothing in the engine may parse meaning out of the rest — the moment
 * something derives behaviour from an id's content, ids stop being free to
 * generate and start being a schema.
 *
 * They are not globally unique in the cryptographic sense. They are unique
 * within a document with overwhelming probability, which is what a scene needs;
 * asset identity is content-addressed and handled separately in P2.
 */

/** Prefixes, chosen so a raw document is readable without a schema to hand. */
export const ID_PREFIX = {
  scene: 'sc',
  entity: 'en',
  component: 'cm',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/**
 * Ids are plain strings rather than branded types.
 *
 * A brand would catch passing a component id where an entity id belongs, at the
 * cost of casts at every boundary where ids arrive as data — which is every
 * boundary that matters, since documents are parsed from JSON. The validation
 * that has to exist anyway is the thing that actually catches it.
 */
export type SceneId = string;
export type EntityId = string;
export type ComponentId = string;

/** Random characters after the prefix. 62^12 is ample for one document. */
const RANDOM_LENGTH = 12;
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SEPARATOR = '_';

const ID_PATTERN = new RegExp(`^(${Object.values(ID_PREFIX).join('|')})${SEPARATOR}[0-9A-Za-z]+$`);

export interface IdFactory {
  scene(): SceneId;
  entity(): EntityId;
  component(): ComponentId;
}

/**
 * Ids come from an injected {@link Random}, never from `Math.random`.
 *
 * That is what lets a test build a scene from a seed and get the same document
 * every time, which the round-trip and determinism suites depend on. In
 * production the generator is seeded from a real entropy source.
 */
export function createIdFactory(random: Random): IdFactory {
  const generate = (kind: IdKind): string => {
    let suffix = '';
    for (let i = 0; i < RANDOM_LENGTH; i += 1) {
      suffix += ID_ALPHABET[random.nextUint32() % ID_ALPHABET.length] ?? '0';
    }
    return `${ID_PREFIX[kind]}${SEPARATOR}${suffix}`;
  };
  return {
    scene: () => generate('scene'),
    entity: () => generate('entity'),
    component: () => generate('component'),
  };
}

/** Whether a string is shaped like an id of the given kind. */
export function isId(value: string, kind: IdKind): boolean {
  return ID_PATTERN.test(value) && value.startsWith(`${ID_PREFIX[kind]}${SEPARATOR}`);
}

// `isAnyId` was here: `ID_PATTERN.test(value)`, exported, with zero callers and
// zero tests. The first enumerated mutant sweep produced three survivors from
// it, and they were not coverage holes — an export nothing calls has no
// behaviour to observe, so no assertion can be written that is not simply a
// second copy of its body.
//
// Deleted rather than tested, which is the rule this file follows now: an
// unused export is either load-bearing and has a caller, or it is not and has
// no business being enumerated forever. `isId` covers the case anyone actually
// needs, with the kind checked. If a use appears, it comes back with that use.
