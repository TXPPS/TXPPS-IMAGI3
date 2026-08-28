import type { BudgetReport, BudgetResult, BudgetStatus } from './budgets/types.ts';

const STATUS_MARK: Readonly<Record<BudgetStatus, string>> = {
  passed: 'PASS',
  violated: 'FAIL',
  unmeasured: 'MISS',
  deferred: 'defer',
};

const ID_COLUMN_SLACK = 2;
const STATUS_COLUMN_WIDTH = 5;

function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatRow(result: BudgetResult, idWidth: number): string {
  const mark = padEnd(STATUS_MARK[result.status], STATUS_COLUMN_WIDTH);
  return `  ${mark} ${padEnd(result.rule.id, idWidth)} ${result.detail}`;
}

/** Render a budget report as a fixed-width text table for CI logs. */
export function formatBudgetReport(report: BudgetReport): string {
  const idWidth = Math.max(...report.results.map((r) => r.rule.id.length), 0) + ID_COLUMN_SLACK;
  const lines = [
    `Budget report (phase ${report.currentPhase})`,
    ...report.results.map((result) => formatRow(result, idWidth)),
    '',
    summarise(report),
  ];
  return lines.join('\n');
}

function summarise(report: BudgetReport): string {
  const { counts } = report;
  const parts = [
    `${String(counts.passed)} passed`,
    `${String(counts.violated)} violated`,
    `${String(counts.unmeasured)} unmeasured`,
    `${String(counts.deferred)} deferred`,
  ];
  return `${report.ok ? 'BUDGETS OK' : 'BUDGETS FAILED'}: ${parts.join(', ')}`;
}
