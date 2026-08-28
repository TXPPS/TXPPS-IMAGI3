# GATES

A phase gate closes only when QA Automation, Visual QA and Performance have each
independently signed off. Sign-off is a **test artifact plus a line in this
table** — never a claim. A role that cannot verify a criterion records that
rather than assuming it.

Reviews are run as independent role reviewers with their own lane, their own
tooling, and no obligation to agree with the implementer.

---

## P0 — Foundation

**Status: NOT CLOSED.** QA Automation's re-verification is outstanding, and the
brief requires all three mandatory roles to sign before a gate closes.

**Gate criteria (brief §5):** CI green on an empty app; all three device
profiles boot; audit harness demonstrably catches a deliberately planted
failure.

### Criterion evidence

| Criterion                               | Evidence                                                                                                                                                                                                                | Status               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| CI green on an empty app                | GitHub Actions run on the branch head: `verify` (format, lint, typecheck, unit, self-test, build) and `e2e` (three profiles, budget gate)                                                                               | see run status below |
| All three device profiles boot          | `pnpm test:e2e` — 42 tests, 14 per profile, including shell render, readiness signal, no-overflow layout and manifest fetch                                                                                             | PASS                 |
| Audit harness catches a planted failure | `pnpm audit:selftest` — 38 assertions over 8 detectors, each planting a defect and asserting the clean counterpart stays green; plus `tests/e2e/planted-fault.spec.ts` driving four faults through the real running app | PASS                 |

The first CI run on this branch **failed**, on a lint error I introduced by
committing without re-running lint. That is recorded rather than hidden: it is
the pipeline demonstrating it blocks a red tree, which is the property the
criterion is actually about.

### Full sweep artifact

```
pnpm sweep
  format:check  clean
  lint          clean
  typecheck     clean
  unit tests    176 passed (17 files)
  build         clean
  bundle        1472 B gzipped
  e2e           42 passed (desktop, tablet, phone)
  budgets       4 passed, 0 violated, 0 unmeasured, 7 deferred
```

### Role sign-offs

| Role               | Verdict  | Artifact                                                                                                                                                                               | Notes                                                                                                                               |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Technical Director | PASS     | this table                                                                                                                                                                             | Arbitrated the reviews below; every blocking condition was implemented rather than argued down.                                     |
| Engine Core        | n/a      | —                                                                                                                                                                                      | No engine code exists at P0.                                                                                                        |
| Rendering          | n/a      | —                                                                                                                                                                                      | No renderer exists at P0.                                                                                                           |
| Gameplay Systems   | n/a      | —                                                                                                                                                                                      | Not reached.                                                                                                                        |
| Tools/Editor       | PASS     | `pnpm vitest --project editor` — 10 passed                                                                                                                                             | Shell renders, readiness contract published, no markup injection path.                                                              |
| Backend/Sync       | n/a      | —                                                                                                                                                                                      | Not reached.                                                                                                                        |
| Platform/Mobile    | PARTIAL  | `tests/e2e/boot.spec.ts`                                                                                                                                                               | Manifest served and layout verified on all three emulated profiles. Real device behaviour is unverified: GAP-001, GAP-004, GAP-008. |
| Scripting/Sandbox  | n/a      | —                                                                                                                                                                                      | Not reached.                                                                                                                        |
| **QA Automation**  | **PASS** | `pnpm test` 176 passed; `pnpm audit:selftest` 38 passed; mutation review of 16 harness mutations                                                                                       | Initially **FAIL**. See findings and resolutions below.                                                                             |
| **Visual QA**      | **PASS** | `pnpm test:e2e` 42 passed; independent reimplementation of SSIM verified to 7.8e-17 against Wang et al. 2004; YIQ matrix and `MAX_YIQ_DELTA` verified by brute force over the RGB cube | Conditional PASS; all three blocking conditions implemented.                                                                        |
| **Performance**    | **PASS** | `pnpm audit:budgets` — 4 passed, 0 violated, 0 unmeasured                                                                                                                              | Conditional PASS; all seven blocking conditions implemented.                                                                        |
| Security           | DEFERRED | —                                                                                                                                                                                      | No sandbox, no sync, no user input at P0. First substantive review is due at P4 (sync auth) and P7 (script sandbox).                |
| Release/Docs       | PASS     | this document, `docs/RESUME.md`, `CHANGELOG.md`                                                                                                                                        | Continuity documents complete; a cold session can resume from files alone.                                                          |

### Blocking findings and their resolutions

Every item below was raised by a review, and every one was fixed in code rather
than negotiated away.

| #   | Raised by     | Finding                                                                                                                                    | Resolution                                                                                         |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1   | QA Automation | Self-test proved neither comparator threshold was load-bearing: both scenarios breached both gates, so gutting either left the suite green | Three gates, one isolating scenario each; verified by mutation (`2520574`)                         |
| 2   | QA Automation | `docs/STATE.md` declared the phase signed against a `GATES.md` that did not exist                                                          | This document; STATE.md corrected                                                                  |
| 3   | QA Automation | `planted-fault.spec.ts` asserted `report.ok === false`, which held regardless of the planted fault                                         | Replaced with a clean-counterpart assertion (`b2ed521`)                                            |
| 4   | QA Automation | Production bundle test asserted absence of `"9000"`, which esbuild emits as `9e3` — unfalsifiable                                          | Removed, with the reason recorded inline (`b2ed521`)                                               |
| 5   | QA Automation | The CI budget entrypoint had zero coverage; deleting its exit code left every suite green                                                  | Logic extracted to `runBudgetGate`, exit contract pinned by tests (`1db70cb`)                      |
| 6   | Visual QA     | Mean SSIM diluted a deleted control to 0.9977; the mandated threshold caught 3 of 21 planted regressions                                   | Damaged-window gate added; RC-0003 (`2520574`)                                                     |
| 7   | Visual QA     | A missing baseline was written and reported as a pass                                                                                      | Absent baseline now fails; creation is opt-in (`b2ed521`)                                          |
| 8   | Visual QA     | `io.ts` had no coverage; `renderDiffImage` never executed by any test                                                                      | Unit tests added; also exercised by the planted visual regression                                  |
| 9   | Visual QA     | No browser-level visual negative control — no capture ever compared against anything but itself                                            | Planted visual regression on all three profiles (`b2ed521`)                                        |
| 10  | Visual QA     | `user-scalable=no` blocked pinch-zoom (WCAG 1.4.4)                                                                                         | Removed (`b2ed521`)                                                                                |
| 11  | Visual QA     | `MIN_TOUCH_TARGET_PX` claimed an audit that did not exist                                                                                  | Constant removed; GAP-009 records the real state                                                   |
| 12  | Performance   | Device-labelled budgets measured on unthrottled desktop hardware, with no gap recorded                                                     | GAP-006, with the phone-faster-than-desktop evidence                                               |
| 13  | Performance   | Cold load anchored solely on a self-reported mark that fires before paint                                                                  | Now the later of the mark and first contentful paint, median of three fresh-page loads (`1db70cb`) |
| 14  | Performance   | The gate accepted zero and negative measurements                                                                                           | Plausibility floors, plus self-test scenarios (`1db70cb`)                                          |
| 15  | Performance   | `enforcedFrom` and `currentPhase` were untested one-word off switches                                                                      | Phases pinned per rule; `budgets.json` must agree with STATE.md (`1db70cb`)                        |
| 16  | Performance   | `editor.bundle.gzip` deferred to P3 despite being measurable today                                                                         | Enforced from P0 with a real harness (`1db70cb`)                                                   |
| 17  | Performance   | Byte budgets used binary units against a brief written in MB — a silent 4.9% relaxation                                                    | Decimal units, asserted below their binary equivalents (`1db70cb`)                                 |
| 18  | Performance   | Reports discarded measurement provenance; `sweep` never cleared stale files                                                                | Origin and timestamp printed; `sweep` starts with `audit:clean` (`1db70cb`)                        |

### Non-blocking findings carried forward

Recorded rather than fixed, because they need work a later phase owns:

- Antialiasing edge population is 5x–9x the same-backend pixel budget, and two
  comparator thresholds are provisional — **GAP-003**, due at P3.
- No CPU or network throttling; loopback server; no long-task accounting —
  **GAP-006**, due before P5.
- The planted slow-boot proof runs against the dev server, not the gated
  preview pipeline — **GAP-007**, due at P3.
- Safe-area insets resolve to zero on every emulated profile — **GAP-008**.
- No touch target audit exists — **GAP-009**, due at P5.

### Explicitly not claimed

- Real iOS Safari or Android hardware behaviour (GAP-001, GAP-004).
- The WebGPU renderer path, which has never run against two real backends
  (GAP-002).
- Locked screenshot baselines — a P3 gate, deliberately not attempted (GAP-003).
- That a green phone cold-load row says anything about a phone (GAP-006).
