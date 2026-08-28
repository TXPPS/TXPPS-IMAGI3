import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkBudgets, findOrphanMeasurements } from '../budgets/check.ts';
import { parseBudgetDocument } from '../budgets/load.ts';
import { MEASUREMENT_DIR, readAllMeasurements } from '../measurements.ts';
import { formatBudgetReport } from '../report.ts';
import { BUDGETS_FILENAME, findRepoRoot } from '../repo-root.ts';

function measurementDirFromArgs(argv: readonly string[], repoRoot: string): string {
  const flagIndex = argv.indexOf('--measurements');
  if (flagIndex === -1) return join(repoRoot, MEASUREMENT_DIR);
  const value = argv[flagIndex + 1];
  if (value === undefined) throw new Error('--measurements requires a directory path');
  return value;
}

function main(): number {
  const repoRoot = findRepoRoot();
  const document = parseBudgetDocument(
    JSON.parse(readFileSync(join(repoRoot, BUDGETS_FILENAME), 'utf8')),
  );
  const measurements = readAllMeasurements(measurementDirFromArgs(process.argv, repoRoot));
  const orphans = findOrphanMeasurements(document, measurements);
  const report = checkBudgets(document, measurements);

  console.log(formatBudgetReport(report));
  if (orphans.length > 0) {
    console.log(`\nUnknown measurement ids reported by harnesses: ${orphans.join(', ')}`);
    console.log('Every measurement must correspond to a declared budget rule.');
  }
  return report.ok && orphans.length === 0 ? 0 : 1;
}

process.exitCode = main();
