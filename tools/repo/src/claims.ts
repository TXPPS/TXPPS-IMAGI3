/**
 * The claims ledger.
 *
 * Three times in this project a fix was recorded as made before it was made.
 * Twice a reviewer caught it; once it survived into a gate table and was quoted
 * back as evidence. The pattern is always the same — an edit reported without
 * being verified on disk, then a document describing the result of an edit that
 * does not exist. Discipline has now failed at this three times, so the remedy
 * is not more discipline.
 *
 * The rule: **a document that claims a code change must name the file and the
 * commit that changed it**, in the form
 *
 *     file:packages/core/src/graph.ts @ 1946f48
 *
 * and CI asserts, for every such reference, that the named commit really does
 * touch the named path. A claim about an edit that never landed produces an
 * empty diff, and an empty diff fails the build.
 *
 * What it cannot do, stated so it is not oversold: it proves a commit touched a
 * file, not that the change does what the sentence next to it says. It closes
 * the specific failure that has actually happened here — the claim with nothing
 * behind it at all — and leaves the general problem of a claim that overstates
 * a real change to review.
 */

/** Marker introducing a claim reference. Chosen to be greppable and unlikely in prose. */
export const CLAIM_PREFIX = 'file:';

/**
 * A claim that a named commit changed a named path.
 *
 * Paths are repository-relative. Commit-ish is anything `git` can resolve, but
 * in practice an abbreviated SHA: a tag would be worse, because this
 * environment's proxy refuses tag pushes and a local-only tag identifies a tree
 * to nobody else.
 */
export interface Claim {
  readonly path: string;
  readonly commit: string;
  /** Where the claim was written, for an error message that can be acted on. */
  readonly source: string;
  /** 1-indexed line within {@link source}. */
  readonly line: number;
}

/**
 * `file:<path> @ <commit>`, with the path allowed any non-space character.
 *
 * Anchored on the marker rather than on line structure so a claim can sit
 * inside a sentence, a table cell or a bullet. Documents are written for people
 * first; a format that only parses at the start of a line would be obeyed for a
 * week and then quietly worked around.
 */
const CLAIM_PATTERN = /file:`?(?<path>[^\s`|]+)`?\s*@\s*(?<commit>[0-9a-f]{7,40})\b/giu;

/**
 * A commit named in prose next to a path, which is how these are actually
 * written: ``fixed in `abc1234` (packages/core/src/graph.ts)``, or the reverse.
 *
 * The marker form above is opt-in, and at the P1 gate the whole documentation
 * tree contained exactly one claim while dozens of bare parenthesised SHAs sat
 * in gate tables unchecked. QA Automation demonstrated that the ledger caught
 * only what someone had volunteered in one exact syntax. This form is not
 * opt-in: a document that mentions a commit and a source path in the same
 * breath is making a claim, and it is checked like one.
 */
const PROSE_PATTERN =
  /`?(?<commit>[0-9a-f]{7,40})`?[^\n]{0,80}?[(`](?<path>(?:packages|apps|tools|tests)\/[^\s`)]+\.\w+)|[(`](?<path2>(?:packages|apps|tools|tests)\/[^\s`)]+\.\w+)[^\n]{0,80}?`?(?<commit2>[0-9a-f]{7,40})`?/giu;

function collect(line: string, pattern: RegExp, source: string, lineNumber: number): Claim[] {
  const claims: Claim[] = [];
  // `matchAll` needs the global flag, and a global regex carries lastIndex
  // between calls. Constructing per line keeps each scan independent.
  for (const match of line.matchAll(new RegExp(pattern))) {
    const path = match.groups?.['path'] ?? match.groups?.['path2'];
    const commit = match.groups?.['commit'] ?? match.groups?.['commit2'];
    if (path === undefined || commit === undefined) continue;
    claims.push({ path, commit, source, line: lineNumber });
  }
  return claims;
}

/** Every claim in a document, in the order they appear, de-duplicated. */
export function parseClaims(text: string, source: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split('\n').entries()) {
    const found = [
      ...collect(line, CLAIM_PATTERN, source, index + 1),
      ...collect(line, PROSE_PATTERN, source, index + 1),
    ];
    for (const claim of found) {
      // Both patterns can match the same claim; the marker form contains a path
      // and a sha, which is what the prose form looks for.
      const key = `${claim.path}@${claim.commit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push(claim);
    }
  }
  return claims;
}

export interface ClaimVerdict {
  readonly claim: Claim;
  readonly ok: boolean;
  /** Why the claim failed, or what it was found to have changed. */
  readonly detail: string;
}

/** Runs `git diff --stat <commit>^ <commit> -- <path>`, or reports why it could not. */
export type DiffProbe = (commit: string, path: string) => DiffOutcome;

export type DiffOutcome =
  | { readonly kind: 'changed'; readonly summary: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'error'; readonly message: string };

export function verifyClaim(claim: Claim, diff: DiffProbe): ClaimVerdict {
  const outcome = diff(claim.commit, claim.path);
  if (outcome.kind === 'error') {
    return { claim, ok: false, detail: outcome.message };
  }
  if (outcome.kind === 'unchanged') {
    return {
      claim,
      ok: false,
      detail:
        `commit ${claim.commit} does not touch ${claim.path}. ` +
        'The document claims a change that is not in that commit.',
    };
  }
  return { claim, ok: true, detail: outcome.summary };
}

export interface ClaimsReport {
  readonly ok: boolean;
  readonly verdicts: readonly ClaimVerdict[];
}

export function verifyClaims(claims: readonly Claim[], diff: DiffProbe): ClaimsReport {
  const verdicts = claims.map((claim) => verifyClaim(claim, diff));
  return { ok: verdicts.every((verdict) => verdict.ok), verdicts };
}

export function formatClaimsReport(report: ClaimsReport): string {
  const lines = ['Claims ledger'];
  for (const verdict of report.verdicts) {
    const where = `${verdict.claim.source}:${String(verdict.claim.line)}`;
    lines.push(
      `  ${verdict.ok ? 'OK  ' : 'FAIL'} ${where} -> ${verdict.claim.path} @ ${verdict.claim.commit}`,
      `         ${verdict.detail}`,
    );
  }
  const failed = report.verdicts.filter((verdict) => !verdict.ok).length;
  lines.push(
    '',
    report.ok
      ? `CLAIMS OK: ${String(report.verdicts.length)} verified against the history`
      : `CLAIMS FAILED: ${String(failed)} of ${String(report.verdicts.length)} claim a change that is not there`,
  );
  return lines.join('\n');
}
