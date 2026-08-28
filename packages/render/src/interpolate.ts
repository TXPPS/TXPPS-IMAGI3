import type { EntityState, WorldSnapshot } from '@imagi3/runtime';

/**
 * Interpolated positions for drawing between two simulation steps.
 *
 * The simulation runs at a fixed rate and the display does not, so most frames
 * fall between two steps. Drawing the last completed step makes motion stutter
 * at the beat frequency between the two rates — at 60Hz simulation on a 144Hz
 * display, visibly. Drawing the interpolated position removes it.
 *
 * **Interpolation is a rendering concern and never writes back.** These values
 * exist for one frame and are thrown away; a system that read them would be
 * simulating from a value derived partly from wall-clock timing, and the run
 * would stop being reproducible.
 *
 * Matching is by id, not by index. Two snapshots can hold different entity sets
 * — one entity spawned, another despawned, between the two steps — and matching
 * positionally would interpolate one entity's position toward an unrelated
 * entity's, which draws as a smear across the screen rather than as a missing
 * object.
 */

export interface DrawState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Reusable state for allocation-free interpolation.
 *
 * The map is kept and cleared rather than rebuilt, and no result objects are
 * created, so a frame allocates nothing.
 *
 * **The measurement did not confirm the hypothesis this was built on, and that
 * is recorded rather than quietly dropped.** The suspicion was a
 * garbage-collection sawtooth: the reference scene showed a median engine frame
 * of 2.5ms against a p95 of 6.8ms, and 400 entities meant 800 allocations per
 * frame in the draw loop. Removing them changed nothing measurable — the p95
 * across runs before and after was 6.8 versus 7.6, 7.6, 8.1 and 8.7, and the
 * run-to-run spread is larger than any effect. The real cause of the spread was
 * the throttle's sleep schedule, not the collector.
 *
 * It is kept anyway, on the narrow grounds that allocating per frame in a draw
 * loop is worth not doing and the cost of not doing it here is nil, and because
 * 800 allocations at 400 entities is 4,000 at 2,000. It is **not** kept on the
 * grounds that it fixed something, because it did not.
 */
export interface InterpolationScratch {
  readonly index: Map<string, EntityState>;
}

export function createInterpolationScratch(): InterpolationScratch {
  return { index: new Map<string, EntityState>() };
}

/** Receives one entity's drawn position. Must not retain its arguments. */
export type DrawVisitor = (index: number, id: string, x: number, y: number) => void;

/**
 * Interpolate without allocating, calling `visit` for each drawn entity.
 *
 * The callback form exists because the allocation is the cost: a renderer that
 * wants positions in order gets them here and writes them straight into its
 * meshes, with nothing created per frame and nothing for the collector to
 * reclaim. {@link interpolateSnapshots} is the convenient form and is built on
 * this one, so the two cannot disagree.
 */
export function interpolateInto(
  previous: WorldSnapshot,
  current: WorldSnapshot,
  alpha: number,
  scratch: InterpolationScratch,
  visit: DrawVisitor,
): void {
  const clamped = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  scratch.index.clear();
  for (const entity of previous.entities) scratch.index.set(entity.id, entity);

  for (const [index, entity] of current.entities.entries()) {
    const from = scratch.index.get(entity.id);
    if (from === undefined) {
      visit(index, entity.id, entity.x, entity.y);
      continue;
    }
    visit(index, entity.id, lerp(from.x, entity.x, clamped), lerp(from.y, entity.y, clamped));
  }
}

/**
 * Positions to draw this frame.
 *
 * An entity present in `current` but not `previous` — one that spawned during
 * the step — is drawn at its current position rather than interpolated from
 * nowhere. An entity that vanished is simply not drawn: fading it out would be
 * a gameplay decision made in the renderer.
 */
export function interpolateSnapshots(
  previous: WorldSnapshot,
  current: WorldSnapshot,
  alpha: number,
): DrawState[] {
  const drawn: DrawState[] = [];
  interpolateInto(previous, current, alpha, createInterpolationScratch(), (_index, id, x, y) => {
    drawn.push({ id, x, y });
  });
  return drawn;
}
