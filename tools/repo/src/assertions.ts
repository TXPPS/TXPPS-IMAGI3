/**
 * Assertions about runtime behaviour, and whether anything backs them.
 *
 * The claims ledger verifies that a commit touched a path. It cannot verify
 * that the sentence next to the reference is *true*, and RC-0010 is what that
 * gap costs: `parity.ts` said a WebGL2 comparison "runs today" when nothing
 * called it, and `webgpu.ts` said the leg was "wired" when it had no caller, no
 * test, and appeared in no emitted chunk. A commit had touched both files, so
 * the ledger was satisfied.
 *
 * The rule this enforces: **a comment that asserts a runtime property must name
 * something checkable.** Not prose, not a cross-reference to another comment —
 * a spec path, a test name, or a CI job that a program can look for and
 * confirm exists.
 *
 * What it can and cannot do, stated because the last mechanism was oversold:
 *
 * - It **can** catch an assertion with no reference, and a reference naming a
 *   file, test or job that does not exist.
 * - It **cannot** confirm the referenced test actually exercises what the
 *   sentence claims. That is review's job, and this narrows what review has to
 *   look at rather than replacing it.
 *
 * The verbs are deliberately few. A long list makes the rule unlearnable and
 * pushes people to phrase around it; these are the ones that were actually
 * false in this repository.
 */

/** Verbs that assert a runtime property rather than describing intent. */
export const ASSERTION_PATTERNS: readonly { readonly verb: string; readonly pattern: RegExp }[] = [
  { verb: 'runs today', pattern: /\bruns today\b/iu },
  { verb: 'is wired', pattern: /\b(?:is|are) wired\b/iu },
  { verb: 'wired but', pattern: /\bwired (?:but|and)\b/iu },
  { verb: 'covered by', pattern: /\b(?:is|are) covered by\b/iu },
  { verb: 'verified in CI', pattern: /\bverified (?:in|by) CI\b/iu },
  { verb: 'asserted by', pattern: /\b(?:is|are) asserted by\b/iu },
  { verb: 'enforced by', pattern: /\b(?:is|are) enforced by\b/iu },
  { verb: 'exercised by', pattern: /\b(?:is|are) exercised by\b/iu },
];

/**
 * A reference a program can check.
 *
 * Three forms: a repository path with an extension, a `test:` name, or a
 * `ci:` job. Anything else is prose.
 */
const REFERENCE_PATTERNS: readonly RegExp[] = [
  /(?:packages|apps|tools|tests)\/[\w./-]+\.\w+/u,
  /\btest:\s*[\w .-]+/u,
  /\bci:\s*[\w .-]+/u,
];

export interface AssertionSite {
  readonly file: string;
  /** 1-indexed. */
  readonly line: number;
  readonly verb: string;
  readonly text: string;
  /** The checkable reference found on the line, if any. */
  readonly reference: string | undefined;
}

/**
 * Whether the line is reporting someone else's words rather than asserting.
 *
 * A markdown blockquote, or a line whose assertion sits inside quotation marks.
 * The second is checked by stripping quoted spans and re-testing: if the verb
 * survives the strip it was the document's own claim.
 */
function isQuoted(line: string): boolean {
  // The blockquote marker is tested on the raw line. Stripping leading markup
  // first — as this did — removes the `>` before looking for it, so every
  // blockquote read as an assertion. Caught by the checker's own first run
  // against docs/BUGS.md, which quotes the sentences RC-0010 is about.
  if (line.trimStart().startsWith('>')) return true;
  const stripped = line.replace(/["“][^"”]*["”]/gu, '');
  return ASSERTION_PATTERNS.some(({ pattern }) => pattern.test(line) && !pattern.test(stripped));
}

function referenceOn(line: string): string | undefined {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = pattern.exec(line);
    if (match !== null) return match[0];
  }
  return undefined;
}

/**
 * Every assertion in a file, with the reference backing it or `undefined`.
 *
 * A reference may sit on the assertion's own line or on either neighbour — a
 * sentence wrapped by a formatter should not become a violation, and requiring
 * the two on one line would only teach people to write longer lines.
 */
/**
 * Files exempt from scanning.
 *
 * Only the two that define or exercise the vocabulary. A file that lists every
 * verb the checker looks for necessarily contains every verb the checker looks
 * for, and scanning it yields nothing but reports about itself. The exemption
 * is by path and is deliberately not extensible by a comment marker — an
 * opt-out any file could write is an opt-out every file eventually writes.
 */
const EXEMPT = /(?:^|\/)assertions\.(?:test\.)?ts$/u;

/** Enough of the offending line to recognise it without wrapping the report. */
const EXCERPT_CHARS = 120;

export function isExemptFile(file: string): boolean {
  return EXEMPT.test(file);
}

export function findAssertions(file: string, contents: string): AssertionSite[] {
  if (isExemptFile(file)) return [];
  const lines = contents.split('\n');
  const sites: AssertionSite[] = [];
  for (const [index, line] of lines.entries()) {
    // A quotation reports what someone else claimed; it is not this document
    // claiming it. The incident write-ups in docs/BUGS.md quote the exact false
    // sentences they exist to record, and flagging those would make the history
    // unwritable. Narrow on purpose: only the quoted span is exempt, so an
    // assertion outside the quotes on the same line is still caught.
    if (isQuoted(line)) continue;
    for (const { verb, pattern } of ASSERTION_PATTERNS) {
      if (!pattern.test(line)) continue;
      const window = [lines[index - 1] ?? '', line, lines[index + 1] ?? '', lines[index + 2] ?? ''];
      sites.push({
        file,
        line: index + 1,
        verb,
        text: line.trim(),
        reference: window.map(referenceOn).find((r) => r !== undefined),
      });
    }
  }
  return sites;
}

export interface AssertionVerdict {
  readonly site: AssertionSite;
  readonly ok: boolean;
  readonly detail: string;
}

/** Resolves a reference: does the named path, test or job exist? */
export type ReferenceResolver = (reference: string) => boolean;

export function verifyAssertion(site: AssertionSite, resolve: ReferenceResolver): AssertionVerdict {
  if (site.reference === undefined) {
    return {
      site,
      ok: false,
      detail:
        `asserts "${site.verb}" with nothing checkable next to it. Name a spec path, ` +
        'a test, or a CI job — or say what is actually true. See RC-0010.',
    };
  }
  if (!resolve(site.reference)) {
    return {
      site,
      ok: false,
      detail: `references "${site.reference}", which does not exist`,
    };
  }
  return { site, ok: true, detail: `backed by ${site.reference}` };
}

export interface AssertionReport {
  readonly ok: boolean;
  readonly verdicts: readonly AssertionVerdict[];
}

export function verifyAssertions(
  sites: readonly AssertionSite[],
  resolve: ReferenceResolver,
): AssertionReport {
  const verdicts = sites.map((site) => verifyAssertion(site, resolve));
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

export function formatAssertionReport(report: AssertionReport): string {
  const lines = ['Runtime assertions'];
  for (const verdict of report.verdicts) {
    lines.push(
      `  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.site.file}:${String(verdict.site.line)} — ${verdict.detail}`,
    );
    if (!verdict.ok) lines.push(`         ${verdict.site.text.slice(0, EXCERPT_CHARS)}`);
  }
  const failed = report.verdicts.filter((v) => !v.ok).length;
  lines.push(
    '',
    report.ok
      ? `ASSERTIONS OK: ${String(report.verdicts.length)} backed by something checkable`
      : `ASSERTIONS FAILED: ${String(failed)} of ${String(report.verdicts.length)} assert a runtime property with nothing behind it`,
  );
  return lines.join('\n');
}
