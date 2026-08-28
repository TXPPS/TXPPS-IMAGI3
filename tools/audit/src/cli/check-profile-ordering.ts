import { join } from 'node:path';
import { checkProfileOrdering, formatOrderingReport } from '../bench/ordering.ts';
import { BENCHMARK_DIR, readProfileBenchmarks } from '../bench/store.ts';
import { findRepoRoot } from '../repo-root.ts';

const benchmarks = readProfileBenchmarks(join(findRepoRoot(), BENCHMARK_DIR));
const report = checkProfileOrdering(benchmarks);

console.log(formatOrderingReport(report));
if (!report.ok) {
  console.log('');
  console.log('CPU throttling is not producing the expected separation between profiles.');
  console.log('A profile named for a phone that runs at desktop speed measures nothing.');
}
process.exitCode = report.ok ? 0 : 1;
