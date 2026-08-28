// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findShellEdits, isScannedFile } from '../src/no-shell-edits.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_ROOTS = ['tools', '.github', 'apps', 'tests', 'packages'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', '.audit-out', '.git']);

function walk(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, files);
      continue;
    }
    if (isScannedFile(path)) files.push(path);
  }
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), files);
  return files;
}

/**
 * Each case is a line that writes a file without being able to tell whether the
 * write did anything, which is the mechanism behind RC-0005.
 */
describe('findShellEdits', () => {
  it.each([
    ['a quoted heredoc redirected to a file', "cat <<'EOF' > src/a.ts"],
    ['an unquoted heredoc redirected to a file', 'cat <<EOF > src/a.ts'],
    ['an appending heredoc', 'cat <<EOF >> src/a.ts'],
    ['a heredoc piped into tee', "cat <<'EOF' | tee src/a.ts"],
    ['an indented heredoc', "cat <<-'EOF' > src/a.ts"],
    ['sed in place', "sed -i 's/a/b/' src/a.ts"],
    ['sed in place with a backup suffix', "sed -i.bak 's/a/b/' src/a.ts"],
    ['perl in place', "perl -pi -e 's/a/b/' src/a.ts"],
    ['node writing a file inline', 'node -e "require(\'fs\').writeFileSync(p, s)"'],
    ['python writing a file inline', 'python3 -c "open(p).write(s)"'],
  ])('flags %s', (_label, line) => {
    expect(findShellEdits('x.sh', line)).toHaveLength(1);
  });

  /**
   * Reading is not the problem and must stay legal. A check that also banned
   * `cat` and `grep` would be turned off within a week, and then the part that
   * matters would be off too.
   */
  it.each([
    ['cat', 'cat src/a.ts'],
    ['grep', "grep -n 'thing' src/a.ts"],
    ['sed printing a range', "sed -n '1,20p' src/a.ts"],
    ['a heredoc piped into a reader', "python3 - <<'PY'"],
    ['node evaluating without writing', 'node -e "console.log(1)"'],
    ['a yaml block scalar, which is not a heredoc', '        run: |'],
    ['a left shift in prose', 'the value is 1 << 3'],
  ])('leaves %s alone', (_label, line) => {
    expect(findShellEdits('x.sh', line)).toEqual([]);
  });

  it('reports the line number and the rule broken', () => {
    const [finding] = findShellEdits('x.sh', "echo hi\nsed -i 's/a/b/' f.ts");
    expect(finding?.line).toBe(2);
    expect(finding?.rule).toBe('in-place-edit');
  });

  it('finds every offending line, not just the first', () => {
    expect(findShellEdits('x.sh', "sed -i 's/a/b/' f\nperl -pi -e 's/a/b/' f")).toHaveLength(2);
  });
});

describe('isScannedFile', () => {
  it.each(['a.sh', 'a.bash', 'a.yml', 'a.yaml'])('scans %s', (name) => {
    expect(isScannedFile(name)).toBe(true);
  });

  it.each(['a.ts', 'a.md', 'a.json'])('does not scan %s', (name) => {
    // TypeScript cannot contain a heredoc, and `<<` in it is a left shift.
    expect(isScannedFile(name)).toBe(false);
  });
});

describe('committed tooling', () => {
  const files = scannedFiles();

  it('finds files to scan, so an empty pass is impossible', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('still scans the CI workflow, where such a line would do most damage', () => {
    expect(files).toContain(join(REPO_ROOT, '.github/workflows/ci.yml'));
  });

  it('contains no unverified source edit', () => {
    const findings = files.flatMap((file) =>
      findShellEdits(relative(REPO_ROOT, file), readFileSync(file, 'utf8')),
    );
    expect(
      findings.map((f) => `${f.file}:${String(f.line)} (${f.rule}) ${f.text}`),
      'edits go through tools/repo/src/verified-edit.ts, which fails on a no-op',
    ).toEqual([]);
  });
});
