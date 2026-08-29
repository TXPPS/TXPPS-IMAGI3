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
 * A commit, excluding the one thing that reliably looks like one and is not.
 *
 * Hex is a superset of decimal, so `GitHub Actions run 33198049464` parses as a
 * commit under a naive `[0-9a-f]{7,40}` — and two such run ids sit in the gate
 * documents next to file paths.
 *
 * The exclusion is by **length**, not by being all digits, and that distinction
 * was found the hard way: `2520574` is a real commit in this history and is all
 * digits, so an all-digit rule silently dropped seven of the guard-audit table's
 * citations while appearing to have widened the ledger. Short SHAs here are
 * seven or eight characters and full ones are forty; a run id is eleven. A
 * nine-to-thirty-nine-digit decimal token is therefore not a commit.
 *
 * Seven is the floor rather than six. Six-hex tokens are colour literals
 * (`0x6fd3c7` is in `view.ts`) and truncated hashes, and admitting them buys a
 * short-SHA style nothing here uses at the cost of a class of false claims. A
 * stated limit: a six-character SHA citation is not checked.
 */
const COMMIT = String.raw`(?![0-9]{9,39}\b)[0-9a-f]{7,40}`;

/**
 * A repository path, any depth, with an extension.
 *
 * The previous form required the path to begin `packages|apps|tools|tests` and
 * to be immediately preceded by `(` or a backtick. QA Automation measured what
 * that left out at the P1 gate: **one of thirty** SHA mentions in the docs
 * parsed. Everything about `docs/`, `budgets.json`, `.github/`, and every claim
 * written with a relative path or without the wrapping punctuation was
 * invisible — including the citation style the guard-audit table uses
 * throughout, so the table whose rows cite commits as evidence sat entirely
 * outside the ledger.
 */
const EXTENSIONS = 'json|md|ts|tsx|js|mjs|cjs|yml|yaml';
const PATH = String.raw`(?:\.?[\w@-]+\/)+[\w.@-]+\.\w+|[\w-]+(?:\.[\w-]+)*\.(?:${EXTENSIONS})`;

/** How far apart a commit and a path may sit and still be one claim. */
const NEAR = 160;

/**
 * One commit token.
 *
 * The leading `\b` is load-bearing. Without it the scan can start part-way
 * through a longer run of digits, so `run 33191437089` yields `1437089` — seven
 * digits, short enough that the run-id lookahead no longer applies — and the
 * exclusion above is defeated by starting one character to its right.
 */
const COMMIT_TOKEN = new RegExp(String.raw`\b${COMMIT}\b`, 'giu');

/**
 * A commit named in prose next to a path, which is how these are actually
 * written: ``fixed in `abc1234` (packages/core/src/graph.ts)``, or the reverse.
 *
 * The marker form above is opt-in, and at the P1 gate the whole documentation
 * tree contained exactly one claim while dozens of bare parenthesised SHAs sat
 * in gate tables unchecked. This form is not opt-in: a document that mentions a
 * commit and a source path in the same breath is making a claim, and it is
 * checked like one.
 */
const PATH_TOKEN = new RegExp(PATH, 'giu');

function collect(line: string, pattern: RegExp, source: string, lineNumber: number): Claim[] {
  const claims: Claim[] = [];
  // `matchAll` needs the global flag, and a global regex carries lastIndex
  // between calls. Constructing per line keeps each scan independent.
  for (const match of line.matchAll(new RegExp(pattern))) {
    const path = match.groups?.['path'];
    const commit = match.groups?.['commit'];
    if (path === undefined || commit === undefined) continue;
    claims.push({ path, commit, source, line: lineNumber });
  }
  return claims;
}

/** Characters between two token spans, or 0 where they abut. */
function gapBetween(a: RegExpExecArray, b: RegExpExecArray): number {
  const aEnd = a.index + a[0].length;
  const bEnd = b.index + b[0].length;
  return a.index < b.index ? b.index - aEnd : a.index - bEnd;
}

/**
 * Claims a line makes without using the marker syntax.
 *
 * Scanned positionally rather than by one regex spanning both tokens, because a
 * spanning match *consumes* what it matched: a table cell reading
 * ``| `budgets/check.ts` | … | `detectors.test.ts` (`c43c8d1`) |`` would pair
 * the sha with whichever path the engine reached first and then have no way to
 * consider the nearer one. Each commit is instead paired with the closest path
 * on its line, which is how a citation is actually read.
 *
 * One claim per commit, not per pair. The sha is the evidence token — a
 * sentence naming three files and one commit is making one claim, and emitting
 * three would fail on the two the commit was never about.
 *
 * **An ambiguous line fails, and that is the intended behaviour.** "`budgets.json`
 * must agree with STATE.md (`1db70cb`)" reads as a claim about `STATE.md`,
 * because that is the file nearest the evidence; the commit never touched it,
 * and the ledger said so. The remedy is to put the sha beside the file it is
 * evidence for, which is what an unambiguous citation looks like. A checker
 * that guessed quietly instead would be back to reporting on documents rather
 * than on the history.
 */
function collectProse(line: string, source: string, lineNumber: number): Claim[] {
  const commits = [...line.matchAll(COMMIT_TOKEN)];
  if (commits.length === 0) return [];
  const paths = [...line.matchAll(PATH_TOKEN)];
  const claims: Claim[] = [];

  for (const commit of commits) {
    let nearest: RegExpExecArray | undefined;
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const path of paths) {
      const gap = gapBetween(commit, path);
      if (gap <= NEAR && gap < nearestGap) {
        nearest = path;
        nearestGap = gap;
      }
    }
    if (nearest !== undefined) {
      claims.push({ path: nearest[0], commit: commit[0], source, line: lineNumber });
    }
  }
  return claims;
}

/** Resolves a path as written to a path the repository has, or undefined. */
export type PathResolver = (path: string) => string | undefined;

/**
 * Resolve a path as a document writes it against the paths that exist.
 *
 * Gate tables cite files the way people say them — `detectors.test.ts`,
 * `budgets/check.ts`, `graph.ts` — not by full path, and that is the right
 * choice for a table a person reads. Requiring a full path would make the
 * ledger's coverage depend on documents being written for the ledger.
 *
 * An exact match wins. Otherwise the citation must be a **path-segment
 * suffix** of exactly one tracked file: `graph.ts` resolves to
 * `packages/core/src/graph.ts` and does not match `subgraph.ts`, because the
 * boundary is a `/`. An ambiguous citation resolves to nothing rather than to a
 * guess — a claim about the wrong file is worse than an unchecked sentence, and
 * the fix is to write one more path segment.
 */
export function resolveTrackedPath(
  path: string,
  tracked: readonly string[],
): string | undefined {
  if (tracked.includes(path)) return path;
  const suffix = `/${path}`;
  const matches = tracked.filter((candidate) => candidate.endsWith(suffix));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Every claim in a document, in the order they appear, de-duplicated.
 *
 * `resolvePath` applies to the **inferred** form only, and the asymmetry is the
 * design. Widening the prose pattern enough to read the gate tables also makes
 * it read `budgets.json must agree with STATE.md (1db70cb)` as a claim about a
 * file called `STATE.md`, which is not a path this repository has. An inferred
 * claim is a guess about intent, so a guess that resolves to nothing is dropped
 * rather than failed.
 *
 * The marker form is not resolved. `file:<path> @ <sha>` is someone stating a
 * claim deliberately, and a deliberate claim naming a path that does not exist
 * is exactly the typo the ledger should catch, not quietly repair.
 *
 * Defaults to accepting every path as written, so the parser stays testable
 * without a repository behind it.
 */
export function parseClaims(text: string, source: string, resolvePath?: PathResolver): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split('\n').entries()) {
    const inferred = collectProse(line, source, index + 1).flatMap((claim) => {
      if (resolvePath === undefined) return [claim];
      const resolved = resolvePath(claim.path);
      return resolved === undefined ? [] : [{ ...claim, path: resolved }];
    });
    const found = [...collect(line, CLAIM_PATTERN, source, index + 1), ...inferred];
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
