/**
 * Source edits must not be made by shell text-munging.
 *
 * RC-0005: a batch of scripted string replacements silently no-op'd because
 * Prettier had reflowed the anchors they matched on. The replacements reported
 * success, a vacuous assertion stayed in the tree, and both a commit message
 * and a gate table recorded the fix as landed. The tool had no way to know it
 * had changed nothing, because `sed` and a heredoc have no way to know it.
 *
 * The remedy is `verified-edit.ts`, which fails on a stale anchor, an ambiguous
 * anchor, a per-replacement no-op and a batch that cancels out, then re-reads
 * the file from disk. This check is the other half: it stops the unverified
 * form from coming back.
 *
 * Scope is deliberately narrow — shell and CI files, where these constructs
 * actually appear. TypeScript cannot contain a heredoc, so scanning it would
 * only produce false positives on `<<` as a left shift.
 */

/** File extensions where a shell-style edit can actually occur. */
export const SCANNED_EXTENSIONS = ['.sh', '.bash', '.yml', '.yaml'] as const;

export interface ShellEditFinding {
  readonly file: string;
  /** 1-indexed. */
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

interface Pattern {
  readonly rule: string;
  readonly pattern: RegExp;
}

/**
 * Each pattern names a way of writing a file without being able to tell whether
 * the write did anything.
 *
 * `sed -i`, `perl -pi` and a heredoc redirected into a path all share the
 * property that produced RC-0005: they report success whether or not the text
 * they were looking for was there. A reading command is not a problem and is
 * not matched — `cat`, `grep`, `sed -n` and a heredoc piped into an interpreter
 * that only reads are all still fine.
 */
/** A path that is source, for the rules that key on the write target. */
const SOURCE_PATH = String.raw`(?:packages|apps|tools|tests)/\S+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)`;

const PATTERNS: readonly Pattern[] = [
  {
    rule: 'heredoc-redirect',
    // `<<EOF > file`, `<<'EOF' >> file`, and the tee variants.
    pattern: /<<-?\s*['"]?\w+['"]?[^\n]*(?:>>?\s*\S|\|\s*(?:sudo\s+)?tee\b)/u,
  },
  {
    rule: 'in-place-edit',
    pattern: /\b(?:sed|perl)\b[^\n]*\s-[a-z]*i\b/u,
  },
  {
    rule: 'inline-script-write',
    // `node -e`, `python -c` and friends are only a problem when they write.
    pattern:
      /\b(?:node|python3?|ruby)\b[^\n]*\s-(?:e|c)\b[^\n]*(?:writeFileSync|\.write\(|>\s*\S)/u,
  },
  {
    // `printf 'x' > packages/core/src/graph.ts`. The first three rules all key
    // on *how* the text is produced, which is why a plain redirect walked past
    // them; this one keys on what is being overwritten. A redirect cannot
    // report that it changed nothing either.
    rule: 'redirect-onto-source',
    pattern: new RegExp(String.raw`>>?\s*['"]?${SOURCE_PATH}`, 'u'),
  },
  {
    // `awk '{print}' f.ts > tmp && mv tmp packages/core/src/graph.ts`. The
    // redirect goes to a temporary, so the rule above misses it; the move is
    // the write, and it is equally blind to whether anything changed.
    rule: 'move-onto-source',
    pattern: new RegExp(String.raw`\b(?:mv|cp|install)\b[^\n]*\s['"]?${SOURCE_PATH}`, 'u'),
  },
  {
    // `ex -sc '%s/a/b/|x' file`, and `ed` driven by a script. Line editors are
    // `sed -i` with a different spelling.
    rule: 'line-editor',
    pattern: /\b(?:ex|ed)\s+-[a-z]*(?:s|c)\b/u,
  },
];

/**
 * Lines that introduce an unverified source edit, with the rule each broke.
 *
 * **There is no opt-out marker.** There was one — any line containing the
 * string `no-shell-edits` was skipped, in any scanned file — added so this
 * check could be documented without tripping itself. QA Automation found it at
 * the P1 gate: `sed -i 's/a/b/' packages/core/src/graph.ts  # no-shell-edits`
 * passed. `assertions.ts` states the rule it broke, which is that an opt-out
 * any file could write is an opt-out every file eventually writes.
 *
 * It also bought nothing. Only `.sh`, `.bash`, `.yml` and `.yaml` are scanned,
 * and no such file in this repository mentions the rule; the documentation that
 * needed protecting is in TypeScript, which is not scanned at all.
 */
export function findShellEdits(file: string, contents: string): ShellEditFinding[] {
  const findings: ShellEditFinding[] = [];
  for (const [index, text] of contents.split('\n').entries()) {
    for (const { rule, pattern } of PATTERNS) {
      if (pattern.test(text)) findings.push({ file, line: index + 1, rule, text: text.trim() });
    }
  }
  return findings;
}

export function isScannedFile(path: string): boolean {
  return SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension));
}
