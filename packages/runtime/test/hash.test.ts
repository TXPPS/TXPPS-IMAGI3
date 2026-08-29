import { describe, expect, it } from 'vitest';
import { EXCLUDED_FIELDS, HASHED_FIELDS, hashSnapshot } from '../src/hash.ts';
import type { EntityState, WorldSnapshot } from '../src/simulation.ts';

/**
 * The state hash is what the determinism gate compares, so what it *includes*
 * is what determinism means here.
 *
 * These tests exist because the mutation sweep found the gap: dropping `vx` and
 * `vy` from the hashed fields left the whole suite green. Ten thousand ticks
 * compared by a hash blind to velocity would still pass while two runs diverged
 * in exactly the quantity that produces the next tick's positions — a
 * divergence the gate would report as agreement.
 *
 * One test per field, deliberately. A single test varying everything would pass
 * with three of four fields hashed, which is the shape of the hole it is here
 * to close.
 */

function snapshot(...entities: Partial<EntityState>[]): WorldSnapshot {
  return {
    entities: entities.map((overrides, index) => ({
      id: `en_${String(index)}`,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      controlled: false,
      ...overrides,
    })),
  };
}

/**
 * The audit, not the instances.
 *
 * Testing "vx changes the hash" once vx is known to be missing is closing the
 * hole after someone else found it. This closes the *class*: every field of
 * simulation state is either hashed or declared excluded with a reason, and a
 * field added to `EntityState` tomorrow fails here until somebody decides which.
 *
 * The mechanism it guards against is general — a projection compared by a
 * property test is only as strong as what it projects — so the same audit
 * exists for the canonical serialiser in `packages/core`.
 */
describe('state-hash field audit', () => {
  it('accounts for every field of simulation state', () => {
    const runtimeKeys = Object.keys(snapshot({}).entities[0] ?? {}).sort();
    const accounted = [...HASHED_FIELDS, ...EXCLUDED_FIELDS].sort();
    expect(
      runtimeKeys,
      'a field of EntityState is neither hashed nor declared excluded. Decide which, ' +
        'in packages/runtime/src/hash.ts — an undeclared field is invisible to the ' +
        'determinism suite, which is how velocity went missing. See RC-0015.',
    ).toEqual(accounted);
  });

  it('declares no field both hashed and excluded', () => {
    const overlap = HASHED_FIELDS.filter((f) => EXCLUDED_FIELDS.includes(f));
    expect(overlap).toEqual([]);
  });

  it('requires every hashed field to actually move the hash', () => {
    // The list could name a field the mapping function forgot. Each one is
    // varied in turn and must change the digest, so the declaration and the
    // implementation cannot drift apart.
    const values: Record<string, [unknown, unknown]> = {
      id: ['en_a', 'en_b'],
      x: [0, 1],
      y: [0, 1],
      vx: [0, 1],
      vy: [0, 1],
      controlled: [false, true],
    };
    for (const field of HASHED_FIELDS) {
      const pair = values[field];
      expect(pair, `${field} has no case in this test`).toBeDefined();
      const before = hashSnapshot(snapshot({ [field]: pair?.[0] }));
      const after = hashSnapshot(snapshot({ [field]: pair?.[1] }));
      expect(after, `${field} is declared hashed but does not move the hash`).not.toBe(before);
    }
  });
});

describe('hashSnapshot', () => {
  it('is stable for identical state', () => {
    expect(hashSnapshot(snapshot({ x: 1, vx: 2 }))).toBe(hashSnapshot(snapshot({ x: 1, vx: 2 })));
  });

  it.each(['x', 'y', 'vx', 'vy'] as const)('changes when %s changes', (field) => {
    const before = hashSnapshot(snapshot({ [field]: 0 }));
    const after = hashSnapshot(snapshot({ [field]: 1 }));
    expect(after, `${field} is not in the hash, so determinism cannot see it`).not.toBe(before);
  });

  it('changes when controlled changes', () => {
    expect(hashSnapshot(snapshot({ controlled: true }))).not.toBe(
      hashSnapshot(snapshot({ controlled: false })),
    );
  });

  it('changes when an entity id changes', () => {
    const a: WorldSnapshot = { entities: [{ ...snapshot({}).entities[0]!, id: 'en_a' }] };
    const b: WorldSnapshot = { entities: [{ ...snapshot({}).entities[0]!, id: 'en_b' }] };
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b));
  });

  it('changes when entity order changes, because order is part of the state', () => {
    const forward = snapshot({ x: 1 }, { x: 2 });
    const reversed: WorldSnapshot = { entities: [...forward.entities].reverse() };
    expect(hashSnapshot(reversed)).not.toBe(hashSnapshot(forward));
  });

  it('changes when an entity is added', () => {
    expect(hashSnapshot(snapshot({}, {}))).not.toBe(hashSnapshot(snapshot({})));
  });

  it('produces a fixed-width hexadecimal digest', () => {
    // Two 32-bit lanes. One would meet a coincidental collision often enough to
    // matter over ten thousand ticks compared across two runs.
    expect(hashSnapshot(snapshot({}))).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('hashes an empty world without special-casing it', () => {
    expect(hashSnapshot({ entities: [] })).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('treats negative zero as zero, inheriting the serialiser', () => {
    expect(hashSnapshot(snapshot({ x: -0 }))).toBe(hashSnapshot(snapshot({ x: 0 })));
  });

  it('throws rather than hashing a non-finite value to something stable', () => {
    // A simulation producing NaN must fail loudly, not look deterministic.
    expect(() => hashSnapshot(snapshot({ x: Number.NaN }))).toThrow();
  });
});
