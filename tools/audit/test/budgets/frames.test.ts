import { describe, expect, it } from 'vitest';
import {
  CPU_FRAME_EXCLUDED,
  CPU_FRAME_TERMS,
  FRAME_BUDGET_60HZ_MS,
  FrameSampleError,
  MAX_ENGINE_FRAME_SHARE,
  MIN_FRAMES,
  WARMUP_FRAMES,
  cpuFrameMsFrom,
  DROPPED_FRAME_MS,
  droppedFrameRatioFrom,
  frameRateFrom,
  type FrameSamples,
} from '../../src/budgets/frames.ts';

/**
 * Frame statistics are derived by the gate from raw per-frame durations, never
 * read from a number the page computed about itself. These tests hold the two
 * derivations to their stated reductions and to their refusals — a measurement
 * this module declines to produce is a measurement the gate cannot mistake for
 * evidence.
 */

const COUNT = WARMUP_FRAMES + MIN_FRAMES;

function samples(overrides: Partial<FrameSamples> = {}): FrameSamples {
  return {
    frameMs: Array.from({ length: COUNT }, () => 16),
    simMs: Array.from({ length: COUNT }, () => 1),
    updateMs: Array.from({ length: COUNT }, () => 1),
    presentMs: Array.from({ length: COUNT }, () => 0),
    stepsPerFrame: Array.from({ length: COUNT }, () => 1),
    entityCount: 400,
    meshCount: 400,
    steps: COUNT,
    ...overrides,
  };
}

/** `warm` values of warmup followed by the values a statistic is taken over. */
function withTail(warm: number, tail: readonly number[]): number[] {
  return [...Array.from({ length: WARMUP_FRAMES }, () => warm), ...tail];
}

function tail(...values: number[]): number[] {
  return values;
}

describe('frameRateFrom', () => {
  it('converts frame duration to a rate', () => {
    expect(frameRateFrom(samples()).fps).toBeCloseTo(1000 / 16, 6);
  });

  /**
   * The whole reason a frame budget is not stated as a mean: 27 fast frames and
   * 3 at 200ms averages to a comfortable rate while dropping a tenth of them,
   * and the dropped tenth is what a player notices.
   */
  it('is decided by the slow frames, not the average', () => {
    const hitching = samples({
      frameMs: withTail(8, [...Array.from({ length: 27 }, () => 8), 200, 200, 200]),
    });
    expect(frameRateFrom(hitching).fps).toBeCloseTo(1000 / 200, 6);
  });

  it('discards the warmup frames, where shader compilation lands', () => {
    const slowStart = samples({
      frameMs: withTail(
        5000,
        Array.from({ length: 30 }, () => 8),
      ),
    });
    expect(frameRateFrom(slowStart).fps).toBeCloseTo(1000 / 8, 6);
  });

  it('refuses to report from too few frames rather than producing a number', () => {
    expect(() => frameRateFrom(samples({ frameMs: [1, 2, 3] }))).toThrow(FrameSampleError);
  });

  it('refuses when the simulation never ran', () => {
    // A renderer drawing a frozen world meets any frame budget.
    expect(() => frameRateFrom(samples({ steps: 0 }))).toThrow(/no steps/u);
  });

  it('ignores non-positive and non-finite durations rather than dividing by them', () => {
    const clean = Array.from({ length: 30 }, () => 16);
    const dirty = samples({ frameMs: withTail(16, [0, -1, Number.NaN, ...clean]) });
    expect(frameRateFrom(dirty).fps).toBeCloseTo(1000 / 16, 6);
  });

  it('reports the entity and step counts, so a budget cannot be met by drawing less', () => {
    const detail = frameRateFrom(samples()).detail;
    expect(detail).toContain('400 entities');
  });
});

/**
 * The engine-cost statistic, and the property that makes it worth having:
 * **it must not depend on how long a frame took.**
 *
 * The first version of this measured simulation and update together, once per
 * frame. Because a frame runs `frameMs / stepMs` steps, the amount of work
 * inside each sample was set by the rasteriser, and QA Automation showed the
 * consequence at the P1 gate: tripling the work in every system did not move
 * the number, and halving the device pixel ratio — no engine change at all —
 * moved it 44%.
 */
describe('cpuFrameMsFrom', () => {
  it('reports one step plus one update', () => {
    // 1ms of simulation over 1 step, plus 1ms of update, is a 2ms frame.
    expect(cpuFrameMsFrom(samples()).cpuMs).toBe(2);
  });

  it('divides simulation time by the steps that produced it', () => {
    // Ten steps costing 10ms is the same per-step cost as one step costing 1ms,
    // so the modelled frame is unchanged. This is the property the previous
    // version lacked, stated directly.
    const busy = samples({
      simMs: Array.from({ length: COUNT }, () => 10),
      stepsPerFrame: Array.from({ length: COUNT }, () => 10),
    });
    expect(cpuFrameMsFrom(busy).cpuMs).toBe(2);
  });

  it('is unmoved when the frame rate changes but the work per unit does not', () => {
    // A slower rasteriser means longer frames and more steps per frame. The
    // engine's cost per step and per update is identical, so the budget must be
    // identical. This is the DPR mutation, in a unit test.
    const slowFrames = samples({
      simMs: Array.from({ length: COUNT }, () => 4),
      stepsPerFrame: Array.from({ length: COUNT }, () => 4),
    });
    expect(cpuFrameMsFrom(slowFrames).cpuMs).toBe(cpuFrameMsFrom(samples()).cpuMs);
  });

  it('catches simulation work getting three times more expensive', () => {
    // The mutation that survived the previous version.
    const regressed = samples({ simMs: Array.from({ length: COUNT }, () => 3) });
    expect(cpuFrameMsFrom(regressed).cpuMs).toBe(4);
  });

  it('catches scene-graph work getting fifteen times more expensive', () => {
    const regressed = samples({ updateMs: Array.from({ length: COUNT }, () => 15) });
    expect(cpuFrameMsFrom(regressed).cpuMs).toBe(16);
  });

  /**
   * What the statistic is made of, audited field by field.
   *
   * The tests above pin the *reduction* — median, per-step division, the
   * refusals — and every one of them passed while `presentMs` was droppable,
   * because each fixture set it to zero. A term worth nothing in every fixture
   * is a term no assertion can be sensitive to.
   *
   * So the composition is declared in `frames.ts` and checked here: every field
   * of a sample is in exactly one list, every included term moves the number,
   * and every excluded one does not. The last part is a set of inverse
   * controls — `frameMs` moving the engine budget would mean the rasteriser had
   * got back into it, which is RC-0011.
   */
  describe('what the statistic is made of', () => {
    const bumped = (field: (typeof CPU_FRAME_TERMS)[number] | 'frameMs'): number =>
      cpuFrameMsFrom(samples({ [field]: Array.from({ length: COUNT }, () => 7) })).cpuMs;

    it('accounts for every field of a sample', () => {
      // A field added tomorrow fails here until someone decides which it is.
      const fields = Object.keys(samples()).sort();
      const accounted = [...CPU_FRAME_TERMS, ...Object.keys(CPU_FRAME_EXCLUDED)].sort();
      expect(fields).toEqual(accounted);
    });

    it('gives every excluded field a stated reason', () => {
      for (const [field, reason] of Object.entries(CPU_FRAME_EXCLUDED)) {
        expect(reason.length, `${field} is excluded with no reason given`).toBeGreaterThan(20);
      }
    });

    it('counts the present cost, which is most of the frame on real hardware', () => {
      // The mutation: `frame.updateMs + frame.presentMs` -> `frame.updateMs`.
      // 1ms per step + 1ms update + 4ms present.
      const withPresent = samples({ presentMs: Array.from({ length: COUNT }, () => 4) });
      expect(cpuFrameMsFrom(withPresent).cpuMs).toBe(6);
    });

    it('under-reports by the measured proportion if present is dropped', () => {
      // The proportions measured on this host: 0.26ms per step, 0.30ms of
      // scene-graph write, 4.40ms of draw submission. Dropping the last leaves
      // 0.56ms against an 8ms ceiling, which is the 90% under-report Performance
      // measured and nothing failed on.
      const real = samples({
        simMs: Array.from({ length: COUNT }, () => 0.26),
        updateMs: Array.from({ length: COUNT }, () => 0.3),
        presentMs: Array.from({ length: COUNT }, () => 4.4),
      });
      expect(cpuFrameMsFrom(real).cpuMs).toBeCloseTo(4.96, 10);
    });

    it.each(CPU_FRAME_TERMS)('is sensitive to %s', (field) => {
      expect(bumped(field)).not.toBe(cpuFrameMsFrom(samples()).cpuMs);
    });

    it('is not sensitive to frame length, which is the rasteriser', () => {
      // An inverse control. `frameMs` moving this number would mean vsync and
      // the rasteriser had got back inside the engine budget — RC-0011.
      expect(bumped('frameMs')).toBe(cpuFrameMsFrom(samples()).cpuMs);
    });

    it('is not sensitive to the scene-size counts', () => {
      const larger = samples({ entityCount: 4000, meshCount: 4000 });
      expect(cpuFrameMsFrom(larger).cpuMs).toBe(cpuFrameMsFrom(samples()).cpuMs);
    });
  });

  /**
   * The reduction itself, pinned. Every previous case here used a uniform tail,
   * so minimum, median and 95th percentile were indistinguishable and a
   * mutation returning the fastest frame survived the whole suite. The tails
   * below make the three statistics three different numbers.
   */
  it('takes the median, not the minimum', () => {
    const spread = samples({
      updateMs: withTail(
        1,
        tail(
          ...Array.from({ length: 10 }, () => 0.5),
          ...Array.from({ length: 15 }, () => 4),
          ...Array.from({ length: 5 }, () => 90),
        ),
      ),
      simMs: Array.from({ length: COUNT }, () => 1),
    });
    // min would give 1 + 0.5 = 1.5; p95 would give 1 + 90 = 91.
    expect(cpuFrameMsFrom(spread).cpuMs).toBe(5);
  });

  it('takes the median, not the 95th percentile', () => {
    const spread = samples({
      updateMs: withTail(
        1,
        tail(
          ...Array.from({ length: 10 }, () => 0.5),
          ...Array.from({ length: 15 }, () => 4),
          ...Array.from({ length: 5 }, () => 90),
        ),
      ),
    });
    expect(cpuFrameMsFrom(spread).cpuMs).not.toBe(91);
  });

  it('takes the median of the per-step cost, not of the raw simulation time', () => {
    // Frames alternate between 1 step at 1ms and 4 steps at 4ms. Raw simMs has
    // a median of 4; per-step cost is 1 throughout.
    const alternating = samples({
      simMs: withTail(
        1,
        Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 4)),
      ),
      stepsPerFrame: withTail(
        1,
        Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 4)),
      ),
    });
    expect(cpuFrameMsFrom(alternating).cpuMs).toBe(2);
  });

  it('ignores frames that ran no steps when costing a step', () => {
    // A frame shorter than one step is normal and carries no per-step signal.
    const idle = samples({
      simMs: withTail(
        1,
        Array.from({ length: 90 }, (_, i) => (i % 2 === 0 ? 0 : 1)),
      ),
      stepsPerFrame: withTail(
        1,
        Array.from({ length: 90 }, (_, i) => (i % 2 === 0 ? 0 : 1)),
      ),
      updateMs: Array.from({ length: WARMUP_FRAMES + 90 }, () => 1),
      presentMs: Array.from({ length: WARMUP_FRAMES + 90 }, () => 0),
    });
    expect(cpuFrameMsFrom(idle).cpuMs).toBe(2);
  });

  it('refuses when too few frames ran a step to cost one', () => {
    const stalled = samples({
      stepsPerFrame: Array.from({ length: COUNT }, () => 0),
      steps: 1,
    });
    expect(() => cpuFrameMsFrom(stalled)).toThrow(/per-step cost/u);
  });

  it('refuses to report from too few frames', () => {
    expect(() => cpuFrameMsFrom(samples({ simMs: [1, 2] }))).toThrow(FrameSampleError);
  });

  it('refuses when the simulation never ran', () => {
    expect(() => cpuFrameMsFrom(samples({ steps: 0 }))).toThrow(FrameSampleError);
  });

  it('reports both counts, so a truncated scene is visible in the artifact', () => {
    const detail = cpuFrameMsFrom(samples({ entityCount: 1, meshCount: 1 })).detail;
    expect(detail).toContain('1 entities');
    expect(detail).toContain('1 meshes');
  });

  it('drops a frame wholesale when any of its series is unusable', () => {
    // Filtering each series independently would pair a duration from one frame
    // with a step count from another.
    const holed = samples({
      simMs: withTail(1, [Number.NaN, ...Array.from({ length: 31 }, () => 1)]),
      updateMs: withTail(1, [1, ...Array.from({ length: 31 }, () => 1)]),
      stepsPerFrame: withTail(1, [1, ...Array.from({ length: 31 }, () => 1)]),
      presentMs: withTail(0, [0, ...Array.from({ length: 31 }, () => 0)]),
    });
    expect(cpuFrameMsFrom(holed).cpuMs).toBe(2);
  });
});

describe('the budget derivation', () => {
  it('states a 60Hz frame as 16.67ms', () => {
    expect(FRAME_BUDGET_60HZ_MS).toBeCloseTo(16.67, 2);
  });

  it('gives the engine at most half of it', () => {
    // The other half covers rasterisation, compositing and the gameplay a real
    // project adds. The committed ceiling of 8ms is this, rounded down.
    expect(FRAME_BUDGET_60HZ_MS * MAX_ENGINE_FRAME_SHARE).toBeGreaterThan(8);
    expect(FRAME_BUDGET_60HZ_MS * MAX_ENGINE_FRAME_SHARE).toBeLessThan(9);
  });
});

/**
 * The statistic that replaced a budget nothing could satisfy.
 *
 * `frameRateFrom` derives a rate from the 95th-percentile interval between
 * animation-frame callbacks, and that interval is set by the compositor's 60Hz
 * frame source. Performance measured an empty page — no engine, no WebGL, no
 * scene — at a p95 of 16.90ms, which converts to 59.2fps. A `min: 60` on it
 * could never have passed, on any hardware, and the manual procedure written to
 * close it on a real device would have failed on a flawless one.
 *
 * The positive control is therefore the important test here: a budget with no
 * run that passes it is not a budget.
 */
describe('droppedFrameRatioFrom', () => {
  const vsync = 1000 / 60;

  it('reports no dropped frames for a page locked to its refresh rate', () => {
    // The empty-page figures Performance measured: 16.30 to 17.10ms, all of
    // which are on time. This is the positive control the old statistic lacked.
    const onTime = samples({
      frameMs: withTail(
        vsync,
        Array.from({ length: 40 }, (_, i) => 16.3 + (i % 9) * 0.1),
      ),
    });
    expect(droppedFrameRatioFrom(onTime).ratio).toBe(0);
  });

  it('counts a frame that missed a vsync', () => {
    const dropping = samples({
      frameMs: withTail(vsync, [...Array.from({ length: 39 }, () => 16.7), 33.4]),
    });
    expect(droppedFrameRatioFrom(dropping).ratio).toBeCloseTo(1 / 40, 6);
  });

  it('counts every dropped frame, not just the worst', () => {
    const dropping = samples({
      frameMs: withTail(vsync, [
        ...Array.from({ length: 30 }, () => 16.7),
        ...Array.from({ length: 10 }, () => 50),
      ]),
    });
    expect(droppedFrameRatioFrom(dropping).ratio).toBeCloseTo(0.25, 6);
  });

  it('reports every frame dropped for a scene the host cannot keep up with', () => {
    // The throttled tablet under SwiftShader: ~100ms frames, all of them late.
    const struggling = samples({
      frameMs: withTail(
        100,
        Array.from({ length: 40 }, () => 100),
      ),
    });
    expect(droppedFrameRatioFrom(struggling).ratio).toBe(1);
  });

  it('tolerates jitter short of a missed vsync', () => {
    // 1.5 refresh intervals: a frame that overran its slot lands on the next
    // one, so anything under this demonstrably did not drop a frame.
    expect(DROPPED_FRAME_MS).toBeCloseTo(25, 6);
    const jittery = samples({
      frameMs: withTail(
        vsync,
        Array.from({ length: 40 }, () => 24.9),
      ),
    });
    expect(droppedFrameRatioFrom(jittery).ratio).toBe(0);
  });

  it('refuses to report from too few frames', () => {
    expect(() => droppedFrameRatioFrom(samples({ frameMs: [16, 16] }))).toThrow(FrameSampleError);
  });

  it('refuses when the simulation never ran', () => {
    expect(() => droppedFrameRatioFrom(samples({ steps: 0 }))).toThrow(FrameSampleError);
  });

  it('says how many frames of how many were late', () => {
    expect(droppedFrameRatioFrom(samples()).detail).toContain('of 30 frames exceeded');
  });
});
