import { RENDER_BACKENDS, type RenderBackend } from './backend.ts';

/**
 * Cross-backend rendering parity.
 *
 * The claim this harness exists to support is that a scene looks the same on
 * WebGL2 and WebGPU. Right now it cannot be supported: this environment has no
 * WebGPU-capable browser, so the WebGPU leg is never rendered.
 *
 * The whole design of this module follows from one rule in the brief — **never
 * claim a gate you only simulated.** An unrendered leg reports `unmeasured`,
 * which is a third state, not a lenient `passed`. It cannot be formatted as
 * PASS, it cannot make a report `ok`, and the only place it is allowed to live
 * is the DEVICE-VERIFIED register, which never closes a phase.
 *
 * **This module's own header previously claimed a comparison that did not
 * exist** — that two WebGL2 renders were being compared today with the
 * thresholds the WebGPU leg will use. Nothing called `judgeParity` outside its
 * own unit test; the module and the comparator had never met. Visual QA found
 * it at the P1 gate by grepping for callers, which is the check the claim
 * should have invited and did not.
 *
 * It is wired now: `tests/e2e/parity.spec.ts` captures the reference scene
 * twice on WebGL2, compares them with `PARITY_THRESHOLDS`, and asserts the
 * report is *not* ok because the WebGPU leg is unmeasured. That test is what
 * makes the sentence above true, and it is the reason `required` defaults to
 * every backend rather than to whatever the caller remembers.
 */

export const PARITY_STATUSES = ['passed', 'violated', 'unmeasured'] as const;

export type ParityStatus = (typeof PARITY_STATUSES)[number];

/** Comparator verdict, shaped to match `compareImages` from `@imagi3/audit`. */
export interface ComparisonVerdict {
  readonly ok: boolean;
  readonly detail: string;
}

export interface ParityLeg {
  readonly backend: RenderBackend;
  readonly status: ParityStatus;
  readonly detail: string;
}

export interface ParityReport {
  /** True only when every leg was measured and every leg passed. */
  readonly ok: boolean;
  readonly legs: readonly ParityLeg[];
  /** Legs that were never rendered. Never empty while WebGPU is unavailable. */
  readonly unmeasured: readonly RenderBackend[];
  /** Register entry tracking the unmeasured legs, so they cannot be forgotten. */
  readonly deferredTo: string | undefined;
}

/** The deferred register entry that owns the WebGPU parity claim. */
export const WEBGPU_PARITY_GAP = 'DV-001';

export class ParityScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParityScopeError';
  }
}

/**
 * Judge a set of legs.
 *
 * A leg with no comparison is `unmeasured`. That is the entire point, so it is
 * stated in one place: `undefined` in, `unmeasured` out, and `ok` false.
 *
 * **`required` defaults to every backend, and narrowing it is an error.** Every
 * guarantee this module makes is a guarantee about legs that are in `required`;
 * a caller that simply omits the backend it did not render gets a clean report
 * with no mention of it, `ok: true`, and no deferred entry. Visual QA
 * demonstrated exactly that call at the P1 gate — it is a plausible first
 * draft, not a contrived one — and at the time no caller existed to get it
 * right. So the safe set is the default and a smaller one throws: a harness
 * that genuinely wants to test one backend in isolation should say so loudly
 * rather than by omission.
 *
 * @throws {ParityScopeError} when `required` omits a known backend or repeats
 * one, either of which makes the verdict mean less than it appears to.
 */
export function judgeParity(
  comparisons: Readonly<Partial<Record<RenderBackend, ComparisonVerdict>>>,
  required: readonly RenderBackend[] = RENDER_BACKENDS,
): ParityReport {
  const unique = new Set(required);
  if (unique.size !== required.length) {
    throw new ParityScopeError(`required lists a backend twice: ${required.join(', ')}`);
  }
  const missing = RENDER_BACKENDS.filter((backend) => !unique.has(backend));
  if (missing.length > 0) {
    throw new ParityScopeError(
      `required omits ${missing.join(', ')}, so the report would be silent about ` +
        'a backend rather than reporting it unmeasured. Parity is a claim about every ' +
        'backend or it is not a parity claim.',
    );
  }

  const legs = required.map((backend): ParityLeg => {
    const comparison = comparisons[backend];
    if (comparison === undefined) {
      return {
        backend,
        status: 'unmeasured',
        detail: `no ${backend} render was produced, so parity with it is unknown`,
      };
    }
    return {
      backend,
      status: comparison.ok ? 'passed' : 'violated',
      detail: comparison.detail,
    };
  });

  const unmeasured = legs.filter((leg) => leg.status === 'unmeasured').map((leg) => leg.backend);
  return {
    // Deliberately not `every(leg => leg.status !== 'violated')`. That reading
    // would let an unmeasured leg pass, which is the exact failure this module
    // is built to prevent.
    ok: legs.length > 0 && legs.every((leg) => leg.status === 'passed'),
    legs,
    unmeasured,
    deferredTo: unmeasured.length > 0 ? WEBGPU_PARITY_GAP : undefined,
  };
}

const STATUS_MARK: Readonly<Record<ParityStatus, string>> = {
  passed: 'PASS',
  violated: 'FAIL',
  // Not 'PASS', not blank, and not something a reader skims past. A gate this
  // harness cannot measure must look different from one it measured and liked.
  unmeasured: 'UNMEASURED',
};

export function formatParityReport(report: ParityReport): string {
  const lines = ['Renderer parity'];
  for (const leg of report.legs) {
    lines.push(`  ${STATUS_MARK[leg.status]} ${leg.backend}: ${leg.detail}`);
  }
  if (report.unmeasured.length > 0) {
    lines.push(
      '',
      `${report.unmeasured.join(', ')} was not rendered. This is tracked as ` +
        `${WEBGPU_PARITY_GAP} in the DEVICE-VERIFIED register and does not close any phase.`,
    );
  }
  lines.push('', report.ok ? 'PARITY OK' : 'PARITY NOT ESTABLISHED');
  return lines.join('\n');
}
