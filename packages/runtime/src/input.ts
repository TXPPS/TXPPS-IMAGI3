/**
 * Input, as data the simulation consumes rather than events it listens to.
 *
 * The simulation never touches a DOM event. It asks for the input state at a
 * given tick and gets a plain value back, which is what makes a session
 * replayable: record the values, feed them back, and the same seed produces the
 * same run. A simulation subscribed to events instead would depend on when
 * events arrived relative to frames — the one thing a fixed timestep exists to
 * make irrelevant.
 *
 * The same interface serves three sources: a live device, a recorded tape, and
 * a test's hand-written sequence. None of them is privileged.
 */

/** Input state for one tick. Axes are in [-1, 1]; actions are edge-triggered. */
export interface InputFrame {
  readonly axisX: number;
  readonly axisY: number;
  /** Actions that became active on this tick, sorted, so the order is stable. */
  readonly pressed: readonly string[];
}

export const EMPTY_INPUT: InputFrame = { axisX: 0, axisY: 0, pressed: [] };

export interface InputSource {
  /** Input for a tick. Must be pure: asking twice returns the same value. */
  at(tick: number): InputFrame;
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/** Normalise a frame so a tape and a live device cannot disagree about shape. */
export function normaliseInput(frame: InputFrame): InputFrame {
  return {
    axisX: clampAxis(frame.axisX),
    axisY: clampAxis(frame.axisY),
    // Sorted and de-duplicated: two devices reporting the same actions in a
    // different order must produce the same simulation, and set iteration
    // order is not something to rely on across engines.
    pressed: [...new Set(frame.pressed)].sort(),
  };
}

/**
 * A recorded sequence, replayed by tick index.
 *
 * Reading past the end yields empty input rather than throwing: a tape is a
 * recording of what a player did, and a replay that runs longer than the
 * recording is a normal thing to want, not an error.
 */
export function createInputTape(frames: readonly InputFrame[]): InputSource {
  const normalised = frames.map(normaliseInput);
  return {
    at: (tick) => {
      if (!Number.isInteger(tick) || tick < 0) {
        throw new RangeError(`tick must be a non-negative integer, got ${String(tick)}`);
      }
      return normalised[tick] ?? EMPTY_INPUT;
    },
  };
}

/** Keys mapped to axes. Deliberately data, so a rebind is a value change. */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, keyof AxisContribution>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
};

interface AxisContribution {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** Minimal event target surface, so this module needs no DOM library types. */
export interface KeyEventTarget {
  addEventListener(type: string, listener: (event: { code: string }) => void): void;
  removeEventListener(type: string, listener: (event: { code: string }) => void): void;
}

export interface LiveInput extends InputSource {
  /** Advance the edge-trigger state. Called once per completed simulation step. */
  endTick(): void;
  dispose(): void;
}

/**
 * Input from a real device.
 *
 * Held as *state*, not delivered as events: the listener records what is held
 * down, and the simulation samples that on its own schedule. Two key presses
 * inside one frame therefore cannot produce two simulation steps, and a frame
 * that runs three steps sees the same input for all three. Both are correct —
 * a fixed timestep means input is sampled, not consumed.
 *
 * `endTick` is separate from `at` because `at` must be pure. Edge-triggered
 * actions have to be cleared exactly once per step, and doing that inside a
 * getter would mean asking twice gave different answers.
 */
export function createLiveInput(
  target: KeyEventTarget,
  bindings: Readonly<Record<string, keyof AxisContribution>> = DEFAULT_KEY_BINDINGS,
): LiveInput {
  const held: AxisContribution = { left: false, right: false, up: false, down: false };
  let pressedThisTick = new Set<string>();

  const onKeyDown = (event: { code: string }): void => {
    const axis = bindings[event.code];
    if (axis !== undefined) held[axis] = true;
    pressedThisTick.add(event.code);
  };
  const onKeyUp = (event: { code: string }): void => {
    const axis = bindings[event.code];
    if (axis !== undefined) held[axis] = false;
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  return {
    at: () =>
      normaliseInput({
        // Opposite directions held together cancel, rather than one winning by
        // whichever branch is written first.
        axisX: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        axisY: (held.down ? 1 : 0) - (held.up ? 1 : 0),
        pressed: [...pressedThisTick],
      }),
    endTick: () => {
      pressedThisTick = new Set<string>();
    },
    dispose: () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
    },
  };
}

/** Record what a source produced, so a live session can be replayed. */
export function recordInput(source: InputSource, ticks: number): InputFrame[] {
  return Array.from({ length: ticks }, (_, tick) => source.at(tick));
}
