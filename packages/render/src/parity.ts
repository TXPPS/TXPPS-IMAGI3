import type { RenderBackend } from './backend.ts';

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
 * The comparison itself is real and runs today: two WebGL2 renders of the same
 * scene are compared with the same comparator and thresholds the WebGPU leg
 * will use. That keeps the harness honest — it is wired, exercised and known to
 * work, so when a WebGPU browser arrives the only thing that changes is which
 * pixels go in.
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

/**
 * Judge a set of legs.
 *
 * A leg with no comparison is `unmeasured`. That is the entire point, so it is
 * stated in one place: `undefined` in, `unmeasured` out, and `ok` false.
 */
export function judgeParity(
  comparisons: Readonly<Partial<Record<RenderBackend, ComparisonVerdict>>>,
  required: readonly RenderBackend[],
): ParityReport {
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
