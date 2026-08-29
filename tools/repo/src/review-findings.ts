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
 *
 * That narrowness was claimed before it was true. The first filter matched
 * phrases anywhere in the text and rejected six of nine legitimate findings
 * when QA Automation measured it — a false-positive rate that makes the gate
 * quieter rather than safer, since a suppressed finding leaves no trace. The
 * test is structural now; {@link methodDirectiveIn} carries the reasoning and
 * the residual.
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
 * What separates a directive from a finding is grammar, not vocabulary.
 *
 * The first version of this filter matched phrases anywhere in the text, and QA
 * Automation measured the result at the P1 gate: **six of nine legitimate
 * findings rejected**, including the verbatim pass-1 finding this gate exists
 * to verify. `stop using`, `avoid using`, `from now on` and
 * `prefer X rather than Y` are ordinary English for reporting a defect —
 * "interpolateInto must stop using the stale scratch index" is a bug report,
 * and it was thrown away.
 *
 * A filter that eats the review is not a conservative filter. It is the gate
 * failing in the direction nobody measures, because a suppressed finding leaves
 * no trace: rule 2's blunt-instrument note weighed the cost of a rejected
 * suggestion as "someone rewrites it", and at a 67% false-positive rate nobody
 * rewrites anything, they conclude the reviewer found less than it did.
 *
 * So the test is structural. A directive is addressed **to the reader about how
 * the reader works**; a finding is a statement **about the code**. Three
 * classes, and where each applies:
 *
 * - {@link READER_DIRECTIVES} — second person about the reader's own process.
 *   "Do your work through the Bash tool" is never a bug report.
 * - {@link INJECTION_MARKERS} — the discourse moves that exist to displace a
 *   previous instruction, anywhere in the text.
 * - {@link TOOLING_IMPERATIVES} — a bare imperative to change tooling, and only
 *   at the start of a sentence, which is what makes "**Stop using** Vitest"
 *   different from "interpolateInto must **stop using**".
 *
 * **Residual, stated rather than papered over.** A directive written in the
 * third person — "the reviewer should switch to Jest" — is not caught. It is
 * also not addressed to anyone, which is the property the trust boundary turns
 * on; a report is data either way, and this filter is not the boundary, only a
 * check that the schema is being used as a schema.
 */
const READER_DIRECTIVES: readonly RegExp[] = [
  /\byou (?:must|should|shall|need to|are to|will now|may now)\b/iu,
  /\bdo (?:your|the) work\b/iu,
  /\byour (?:workflow|process|tooling|toolchain|method|approach)\b/iu,
];

const INJECTION_MARKERS: readonly RegExp[] = [
  /\bignore (?:all |any )?(?:previous|prior|earlier|the above)\b/iu,
  /\bdisregard (?:the |all |any )?(?:previous|prior|earlier|instructions?)\b/iu,
  /\b(?:new|updated|revised|revised set of) instructions?\s*:/iu,
];

/**
 * Sentence-initial only. The anchor is the whole point.
 *
 * Every phrase here was in the original filter unanchored, and unanchored is
 * what produced the false positives. `stop using` is how one says that a
 * function should stop doing something — "interpolateInto must stop using the
 * stale scratch index". `from now on` is how one says that a consequence
 * persists — "from now on every phone run is scored against a number no phone
 * produced". `use X rather than Y` is how one recommends a fix — "it should use
 * p95 instead of the minimum". Anchored to the start of a sentence, each of
 * them is an instruction and nothing else.
 *
 * The verb matters as much as the anchor. `run` is absent deliberately: "run
 * pnpm instead of npm" is a reproduction step, and the original filter rejected
 * it.
 */
const TOOLING_IMPERATIVES: readonly RegExp[] = [
  /^(?:please,?\s+)?(?:stop|cease|avoid)\s+using\b/iu,
  /^(?:please,?\s+)?switch\s+to\b/iu,
  /^(?:please,?\s+)?adopt\b/iu,
  /^(?:please,?\s+)?use\s+[\w./-]+\s+(?:instead of|rather than)\b/iu,
  /^(?:please,?\s+)?from now on\b/iu,
];

/**
 * Sentence-ish segments, so a pattern can be anchored to the start of one.
 *
 * Splits on terminators followed by whitespace, and on line breaks. A colon
 * counts, so "Reproduction: run pnpm …" puts the command at a segment start;
 * a colon *not* followed by whitespace does not, which keeps `mutation:sweep`
 * in one piece.
 */
function segments(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Why this text is a method directive, or undefined when it is not.
 *
 * Every field is checked the same way. An earlier attempt at this fix exempted
 * `reproduction` on the grounds that it carries commands, which would have let
 * "Stop using Vitest and switch to Jest" through in the one field a reviewer
 * fills with imperatives. It is not needed: dropping `run` from the verb set is
 * what makes "run pnpm instead of npm" a reproduction step again, and that is a
 * statement about which verbs direct method, not about which field is trusted.
 */
export function methodDirectiveIn(text: string): string | undefined {
  for (const pattern of [...READER_DIRECTIVES, ...INJECTION_MARKERS]) {
    const match = pattern.exec(text);
    if (match !== null) return match[0];
  }
  for (const segment of segments(text)) {
    for (const pattern of TOOLING_IMPERATIVES) {
      const match = pattern.exec(segment);
      if (match !== null) return match[0];
    }
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
