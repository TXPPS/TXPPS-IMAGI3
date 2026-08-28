# Changelog

All notable changes to IMAGI3. Format follows Keep a Changelog; the project is
pre-release, so versions are phase milestones rather than semantic versions.

## [Unreleased]

### Phase 1 — Core (in progress)

**Added**

- `packages/core`: scene schema v1, shaped for CRDT merge from the start —
  opaque generated ids, parent pointer plus fractional ordering key, component
  maps keyed by id, and no derived data anywhere in the document (ADR-0012).
- Canonical serializer, byte-stable across runs and processes, emitting sorted
  keys directly rather than through a rebuilt object.
- Migration registry with an identity migration that runs on every load, so the
  machinery is exercised continuously rather than first used under pressure.
- **Deterministic graph repair at load** (ADR-0014). Cycles, dangling parents
  and non-canonical ordering keys are legitimate outcomes of concurrent edits,
  so they are repaired rather than rejected: each cycle breaks at its lowest
  entity id, re-parented to the root with a key derived from that id. Property
  tested for idempotence, permutation-independence and convergence between
  peers that received the document differently ordered.
- Fuzz suite over the load boundary: every input either loads to a well-formed
  tree or is rejected with a typed error naming the path. Found that malformed
  JSON escaped as an untyped `SyntaxError`.

**Changed**

- The schema boundary validates shape only. Reference integrity moved to the
  repair, because rejecting a merged document loses a peer's work.

### Phase 1-PRE — Gate verifiability

**Added**

- Calibrated CDP CPU throttling per device profile, with a profile-ordering
  self-test that fails if the ordering inverts.
- Split gate registers: CI-VERIFIED and DEVICE-VERIFIED (DEFERRED). A deferred
  gate never closes a phase.
- Reviewer isolation via detached worktrees at a recorded SHA.
- **Claims ledger.** A documented code change must name the commit that made
  it; CI asserts the commit touches the path. Shell-based source edits are
  banned by a lint check, since they cannot report having changed nothing.
- **Guard audit** (docs/GATES.md) against a written rule: a guard must not be
  deletable by the edit that introduces the defect it catches.

**Changed**

- Throttling evidence is raw paired samples plus probe metadata; the budget
  gate derives the slowdown itself. A harness no longer reports a conclusion.
- The console incident guard is an automatic fixture. It was opt-in, and so
  absent from nine of thirteen E2E specs (RC-0007).

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

**Changed after independent role review**

Three role reviewers (QA Automation, Visual QA, Performance) raised 18 blocking
findings against the first implementation. All were fixed in code. The ones
worth knowing about:

- The screenshot comparator gained a third gate. Mean SSIM alone diluted a
  deleted control to 0.9977 — it caught 3 of 21 planted regressions — because a
  1440x900 frame averages over roughly 80,000 windows. It now also gates on the
  fraction of windows below a severe-damage floor, and each of the three gates
  has a self-test scenario in which it is the only one that fires.
- The self-test previously could not tell whether either comparator threshold
  worked: both of its scenarios breached both gates, so deleting either left the
  suite green. Verified by mutation that this is no longer true.
- Byte budgets moved from binary to decimal units. They had been silently 4.9%
  more lenient than the brief states.
- Cold load is now the later of the readiness mark and first contentful paint,
  taken as a median of three fresh-page loads. The bare mark is self-reported
  and fires before paint, so work deferred past it was invisible.
- Budgets gained plausibility floors: a harness bug reporting zero or a
  negative value used to score a perfect pass.
- `editor.bundle.gzip` moved from P3 to P0 with a real measurement harness; it
  was measurable from a build artifact all along.
- A missing screenshot baseline is now a failure instead of a silently created
  file, and the visual suite gained a browser-level negative control.
- Two assertions that could never fail were removed or replaced.
- `user-scalable=no` was removed from the viewport meta (WCAG 1.4.4).

**Known limitations**

- Screenshot baselines are not yet locked; that is the P3 gate. See GAP-003.
- No real iOS Safari, Android hardware or WebGPU verification. See GAP-001,
  GAP-002, GAP-004.
