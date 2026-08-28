import { join } from 'node:path';
import { runBudgetGate } from '../budgets/gate.ts';
import { MEASUREMENT_DIR } from '../measurements.ts';
import { findRepoRoot } from '../repo-root.ts';

function measurementDirFromArgs(argv: readonly string[], repoRoot: string): string {
  const flagIndex = argv.indexOf('--measurements');
  if (flagIndex === -1) return join(repoRoot, MEASUREMENT_DIR);
  const value = argv[flagIndex + 1];
  if (value === undefined) throw new Error('--measurements requires a directory path');
  return value;
}

const repoRoot = findRepoRoot();
const outcome = runBudgetGate({
  repoRoot,
  measurementDir: measurementDirFromArgs(process.argv, repoRoot),
});

for (const line of outcome.lines) console.log(line);
process.exitCode = outcome.exitCode;
