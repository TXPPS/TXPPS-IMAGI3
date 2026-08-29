import { describe, expect, it } from 'vitest';
import { hashSnapshot } from '../src/hash.ts';
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

describe('hashSnapshot', () => {
  it('is stable for identical state', () => {
    expect(hashSnapshot(snapshot({ x: 1, vx: 2 }))).toBe(hashSnapshot(snapshot({ x: 1, vx: 2 })));
  });

  it.each(['x', 'y', 'vx', 'vy'] as const)('changes when %s changes', (field) => {
    const before = hashSnapshot(snapshot({ [field]: 0 }));
    const after = hashSnapshot(snapshot({ [field]: 1 }));
    expect(after, `${field} is not in the hash, so determinism cannot see it`).not.toBe(before);
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
