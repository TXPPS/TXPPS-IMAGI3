# Changelog

All notable changes to IMAGI3. Format follows Keep a Changelog; the project is
pre-release, so versions are phase milestones rather than semantic versions.

## [Unreleased]

### Phase 0 — Foundation

**Added**

- pnpm workspace monorepo with TypeScript strict mode, ESLint flat config
  enforcing the project's coding standards mechanically (400-line file cap,
  nesting depth 3, no magic numbers, no `any`, no `@ts-ignore`), and Prettier.
- `tools/audit`: the audit harness as a first-class package.
  - Phase-gated performance budget model, where an enforced-but-unmeasured
    budget is a failure rather than a pass.
  - Console incident guard with a justification-required allowlist; uncaught
    exceptions and unhandled rejections are never suppressible.
  - Perceptual image comparator: YIQ-weighted differing-pixel ratio plus mean
    SSIM, with the brief's 0.5% / 0.98 cross-backend parity thresholds.
  - Measurement collection that fails on unknown ids, so a renamed budget
    cannot silently stop being enforced.
- Harness self-test proving each detector catches a planted defect and stays
  green on its clean counterpart.
- `apps/editor`: application shell that boots and publishes a readiness signal,
  with dev-only fault injection eliminated from production builds.
- Playwright E2E across three device profiles (desktop, tablet, phone),
  including a planted-fault proof run against the real running app.
- Cold-load measurement harness feeding the budget gate.
- GitHub Actions CI: static analysis and unit tests, then E2E inside a pinned
  Playwright container.
- Continuity documentation: STATE, RESUME, ARCHITECTURE, DECISIONS, BUDGETS,
  BUGS, GAPS, GATES.

**Known limitations**

- Screenshot baselines are not yet locked; that is the P3 gate. See GAP-003.
- No real iOS Safari, Android hardware or WebGPU verification. See GAP-001,
  GAP-002, GAP-004.
