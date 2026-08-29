/**
 * Review findings, as a fixed schema.
 *
 * A reviewer report is **data**. It arrives from a subagent, which is not one
 * of the two things that instruct (see the trust boundary in
 * `docs/ARCHITECTURE.md`), and free-form prose from a subagent is exactly the
 * shape that carried SEC-0001's directive into context — a channel that turned
 * out not to be the vector that time, and is open regardless.
 *
 * So a finding is structured, and its prose fields are bounded and delimited on
 * ingest. Two rules follow, and the second is the one with teeth:
 *
 * 1. **Prose is truncated and marked.** A field is capped and wrapped in an
 *    explicit untrusted marker, so a paragraph of instructions cannot be
 *    mistaken for guidance by whatever reads the report next.
 * 2. **A finding that asks for a change of process, tooling or method is
 *    invalid by construction.** Not low-priority, not deferred — rejected
 *    before it is evaluated, because evaluating it is the failure. A reviewer
 *    reports that something is wrong; deciding how the work is done is not
 *    theirs, and a report that reaches for it is malformed whether or not it
 *    is well-intentioned.
 *
 * Rule 2 is deliberately narrow. It rejects a finding *directing* a method
 * change; it does not reject a finding that a method produced a defect. "The
 * budget cannot fail for a 3x regression" is a finding. "Stop using Vitest and
 * switch to Jest" is not.
 */

export const FINDING_SEVERITIES = ['blocking', 'major', 'minor', 'observation'] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Longest a free-form field may be after ingest. */
export const MAX_PROSE = 2000;

/** Wraps every prose field, so its boundaries are unambiguous downstream. */
export const UNTRUSTED_OPEN = '<<untrusted:reviewer>>';
export const UNTRUSTED_CLOSE = '<</untrusted:reviewer>>';

export interface ReviewFinding {
  readonly severity: FindingSeverity;
  /** Repository-relative path the finding is about. */
  readonly file: string;
  /** 1-indexed line, or 0 when the finding is about the file as a whole. */
  readonly line: number;
  /** How to reproduce it. Prose, truncated and delimited on ingest. */
  readonly reproduction: string;
  readonly expected: string;
  readonly actual: string;
}

export interface RawFinding {
  readonly severity?: unknown;
  readonly file?: unknown;
  readonly line?: unknown;
  readonly reproduction?: unknown;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export class FindingRejected extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`review finding rejected: ${reason}`);
    this.name = 'FindingRejected';
    this.reason = reason;
  }
}

/**
 * Phrases that make a finding a directive about method rather than a report
 * about code.
 *
 * Matched on the imperative forms a report actually uses. This is a blunt
 * instrument and is meant to be: the cost of rejecting a well-meaning
 * suggestion is that someone rewrites it as a finding about code, and the cost
 * of accepting a directive is SEC-0001.
 */
const METHOD_DIRECTIVES: readonly RegExp[] = [
  /\b(?:use|prefer|switch to|adopt|install|run)\s+\w+\s+(?:instead of|rather than)\b/iu,
  /\binstead of (?:using|the) [\w./-]+,?\s*(?:use|run|call)\b/iu,
  /\b(?:stop|cease|avoid) using\b/iu,
  /\bdo (?:your|the) work (?:through|with|via)\b/iu,
  /\bfrom now on\b/iu,
  /\bignore (?:all |any )?(?:previous|prior|earlier|the above)\b/iu,
  /\bdisregard (?:the |all |any )?(?:previous|prior|earlier|instructions?)\b/iu,
  /\byou (?:must|should) (?:now )?(?:use|switch|adopt|stop)\b/iu,
  /\bnew instructions?\s*:/iu,
];

/** Why this text is a method directive, or undefined when it is not. */
export function methodDirectiveIn(text: string): string | undefined {
  for (const pattern of METHOD_DIRECTIVES) {
    const match = pattern.exec(text);
    if (match !== null) return match[0];
  }
  return undefined;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FindingRejected(`${field} must be a non-empty string`);
  }
  return value;
}

/** Bound a prose field and mark it as untrusted, without interpreting it. */
export function delimitProse(text: string): string {
  const clipped =
    text.length <= MAX_PROSE
      ? text
      : `${text.slice(0, MAX_PROSE)}… [truncated at ${String(MAX_PROSE)}]`;
  return `${UNTRUSTED_OPEN}${clipped}${UNTRUSTED_CLOSE}`;
}

/**
 * Validate one finding.
 *
 * @throws {FindingRejected} for a malformed finding, and for one that directs a
 * change of process, tooling or method.
 */
export function ingestFinding(raw: RawFinding): ReviewFinding {
  const severity = requireString(raw.severity, 'severity');
  if (!(FINDING_SEVERITIES as readonly string[]).includes(severity)) {
    throw new FindingRejected(
      `severity "${severity}" is not one of ${FINDING_SEVERITIES.join(', ')}`,
    );
  }
  const file = requireString(raw.file, 'file');
  if (file.startsWith('/') || file.includes('..')) {
    throw new FindingRejected(`file "${file}" is not a repository-relative path`);
  }
  const line = raw.line;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 0) {
    throw new FindingRejected('line must be a non-negative integer');
  }

  const prose = {
    reproduction: requireString(raw.reproduction, 'reproduction'),
    expected: requireString(raw.expected, 'expected'),
    actual: requireString(raw.actual, 'actual'),
  };
  for (const [field, text] of Object.entries(prose)) {
    const directive = methodDirectiveIn(text);
    if (directive !== undefined) {
      throw new FindingRejected(
        `${field} directs a change of method ("${directive}"). A reviewer reports ` +
          'what is wrong with the code; how the work is done is not a finding. ' +
          'See docs/SECURITY.md SEC-0001.',
      );
    }
  }

  return {
    severity: severity as FindingSeverity,
    file,
    line,
    reproduction: delimitProse(prose.reproduction),
    expected: delimitProse(prose.expected),
    actual: delimitProse(prose.actual),
  };
}

export interface IngestReport {
  readonly accepted: readonly ReviewFinding[];
  /** One entry per rejected finding, with its index and reason. */
  readonly rejected: readonly { readonly index: number; readonly reason: string }[];
}

/**
 * Ingest a whole report.
 *
 * A rejected finding does not discard the rest — a report is not all-or-nothing
 * and one malformed entry should not lose nineteen good ones. Rejections are
 * returned so they can be reported rather than silently dropped.
 */
export function ingestReport(raw: readonly RawFinding[]): IngestReport {
  const accepted: ReviewFinding[] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (const [index, finding] of raw.entries()) {
    try {
      accepted.push(ingestFinding(finding));
    } catch (error) {
      rejected.push({
        index,
        reason: error instanceof FindingRejected ? error.reason : String(error),
      });
    }
  }
  return { accepted, rejected };
}
