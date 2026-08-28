import { describe, expect, it } from 'vitest';
import {
  PARITY_STATUSES,
  WEBGPU_PARITY_GAP,
  formatParityReport,
  judgeParity,
  type ComparisonVerdict,
} from '../src/parity.ts';

/**
 * The rule under test is the brief's, stated exactly: **never claim a gate you
 * only simulated.** A leg that was never rendered is `unmeasured`, and every
 * assertion here is a way that could quietly become `passed`.
 */

const good: ComparisonVerdict = { ok: true, detail: 'within thresholds' };
const bad: ComparisonVerdict = { ok: false, detail: '2.1% of pixels differ' };

describe('judgeParity', () => {
  it('passes a leg that was measured and matched', () => {
    const report = judgeParity({ webgl2: good }, ['webgl2']);
    expect(report.legs[0]?.status).toBe('passed');
    expect(report.ok).toBe(true);
  });

  it('violates a leg that was measured and differed', () => {
    expect(judgeParity({ webgl2: bad }, ['webgl2']).ok).toBe(false);
  });

  it('reports an unrendered leg as unmeasured, not passed', () => {
    const report = judgeParity({ webgl2: good }, ['webgl2', 'webgpu']);
    expect(report.legs.find((leg) => leg.backend === 'webgpu')?.status).toBe('unmeasured');
  });

  it('is not ok when a leg was never measured, even if every measured leg passed', () => {
    // The failure this module exists to prevent. Reading `ok` as "nothing
    // violated" would make an entirely unrendered backend indistinguishable
    // from a verified one.
    expect(judgeParity({ webgl2: good }, ['webgl2', 'webgpu']).ok).toBe(false);
  });

  it('is not ok when nothing was required, since that proves nothing', () => {
    expect(judgeParity({}, []).ok).toBe(false);
  });

  it('names the deferred register entry that owns an unmeasured leg', () => {
    expect(judgeParity({ webgl2: good }, ['webgl2', 'webgpu']).deferredTo).toBe(WEBGPU_PARITY_GAP);
  });

  it('names no deferred entry when everything was measured', () => {
    expect(judgeParity({ webgl2: good, webgpu: good }, ['webgl2', 'webgpu']).deferredTo).toBe(
      undefined,
    );
  });

  it('lists every unmeasured leg, not just the first', () => {
    expect(judgeParity({}, ['webgl2', 'webgpu']).unmeasured).toEqual(['webgl2', 'webgpu']);
  });

  it('keeps unmeasured a distinct status from passed and violated', () => {
    expect([...PARITY_STATUSES]).toEqual(['passed', 'violated', 'unmeasured']);
  });
});

describe('formatParityReport', () => {
  it('never prints PASS for a leg it did not measure', () => {
    const text = formatParityReport(judgeParity({ webgl2: good }, ['webgl2', 'webgpu']));
    const webgpuLine = text.split('\n').find((line) => line.includes('webgpu:'));
    expect(webgpuLine).toContain('UNMEASURED');
    expect(webgpuLine).not.toContain('PASS');
  });

  it('says the unmeasured leg closes no phase', () => {
    const text = formatParityReport(judgeParity({ webgl2: good }, ['webgl2', 'webgpu']));
    expect(text).toContain(WEBGPU_PARITY_GAP);
    expect(text).toContain('does not close any phase');
  });

  it('does not summarise a run with an unmeasured leg as OK', () => {
    expect(formatParityReport(judgeParity({ webgl2: good }, ['webgl2', 'webgpu']))).toContain(
      'PARITY NOT ESTABLISHED',
    );
  });

  it('summarises a fully measured, fully passing run as OK', () => {
    expect(
      formatParityReport(judgeParity({ webgl2: good, webgpu: good }, ['webgl2', 'webgpu'])),
    ).toContain('PARITY OK');
  });
});
