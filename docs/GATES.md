# GATES

Two registers, because two different things were being called "a gate".

## Register 1 — CI-VERIFIED

Criteria the harness can close by itself, on every run, without a human or a
device. **A phase closes when its CI-VERIFIED criteria are signed**, by QA
Automation, Visual QA and Performance independently. Sign-off is a **test
artifact plus a line in a table** — never a claim. A role that cannot verify a
criterion records that rather than assuming it.

## Register 2 — DEVICE-VERIFIED (DEFERRED)

Criteria that need physical hardware, a real GPU, or a human looking at a
screen. **A deferred gate never closes a phase.** It is tracked to P9 and
blocks the Definition of Done. Nothing here may be reported as passing, and no
phase may be described as complete on the strength of a deferred entry.

The split exists because the two were previously mixed, and mixing them makes
the stronger claim absorb the weaker one. "The P6 gate is green" reads as "this
works on a phone" unless the register makes explicit that no phone was
involved.

### Reviewer isolation

Every review runs in a **detached `git worktree` at a tagged commit**, and each
report records the SHA it ran against. Reviewing a mutable working tree is a
process failure and is logged as one: it happened during P0, where source files
changed two seconds before a reviewer's end-to-end run finished, and the
resulting artifact was described as frozen when it was not.

```
git tag -a review/<phase>-<n> -m "..."          # implementer, before requesting review
git worktree add --detach ../review-<role> review/<phase>-<n>
cd ../review-<role> && pnpm install --frozen-lockfile
```

---

## P0 — Foundation

**Status: CLOSED.** All three mandatory roles signed independently.

**Gate criteria (brief §5):** CI green on an empty app; all three device
profiles boot; audit harness demonstrably catches a deliberately planted
failure.

### Criterion evidence

| Criterion                               | Evidence                                                                                                                                                                                                                                                                                              | Status |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| CI green on an empty app                | GitHub Actions run 33191437089 on commit `a1069d3`: both jobs `success`. `verify` ran format, lint, typecheck, unit tests, the harness self-test and build; `e2e` built, measured the bundle, ran all three profiles inside `mcr.microsoft.com/playwright:v1.56.1-noble`, then passed the budget gate | PASS   |
| All three device profiles boot          | `pnpm test:e2e` — 42 tests, 14 per profile, including shell render, readiness signal, no-overflow layout and manifest fetch                                                                                                                                                                           | PASS   |
| Audit harness catches a planted failure | `pnpm audit:selftest` — 38 assertions over 8 detectors, each planting a defect and asserting the clean counterpart stays green; plus `tests/e2e/planted-fault.spec.ts` driving four faults through the real running app                                                                               | PASS   |

Two of the five CI runs on this branch **failed**, and both are recorded rather
than hidden — a pipeline that has never gone red has not demonstrated it can
block anything.

Run 1 failed on a lint error committed without re-running lint. Run 3 failed on
the budget gate: `editor.bundle.gzip` had moved to P0 while no CI step produced
its measurement, so the gate refused to report green for a budget nobody
measured. That is ADR-0006's central rule firing in production for the first
time, on its own author. See RC-0004.

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

| Role               | Verdict  | Artifact                                                                                                                                                                                                                                                          | Notes                                                                                                                                                                      |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical Director | PASS     | this table                                                                                                                                                                                                                                                        | Arbitrated the reviews; every blocking condition was implemented rather than argued down. Two record-accuracy defects the re-verification found are corrected below.       |
| Engine Core        | n/a      | —                                                                                                                                                                                                                                                                 | No engine code exists at P0.                                                                                                                                               |
| Rendering          | n/a      | —                                                                                                                                                                                                                                                                 | No renderer exists at P0.                                                                                                                                                  |
| Gameplay Systems   | n/a      | —                                                                                                                                                                                                                                                                 | Not reached.                                                                                                                                                               |
| Tools/Editor       | PASS     | `pnpm vitest --project editor` — 10 passed                                                                                                                                                                                                                        | Shell renders, readiness contract published, no markup injection path.                                                                                                     |
| Backend/Sync       | n/a      | —                                                                                                                                                                                                                                                                 | Not reached.                                                                                                                                                               |
| Platform/Mobile    | PARTIAL  | `tests/e2e/boot.spec.ts`                                                                                                                                                                                                                                          | Manifest served and layout verified on all three emulated profiles. Real device behaviour is unverified: GAP-001, GAP-004, GAP-008.                                        |
| Scripting/Sandbox  | n/a      | —                                                                                                                                                                                                                                                                 | Not reached.                                                                                                                                                               |
| **QA Automation**  | **PASS** | Re-verified independently: `pnpm test:e2e` 42 passed across all three profiles, `pnpm test` 176 passed, `pnpm audit:selftest` 38 passed, `pnpm audit:budgets` exit 0; plus its own mutation run confirming each comparator gate fails the self-test when disabled | Returned **FAIL** on the first review with five conditions. Signed only after re-running every criterion itself, including the three-profile boot it had declined to sign. |
| **Visual QA**      | **PASS** | `pnpm test:e2e` 42 passed; independent reimplementation of SSIM verified to 7.8e-17 against Wang et al. 2004; YIQ matrix and `MAX_YIQ_DELTA` verified by brute force over the RGB cube                                                                            | Conditional PASS; all three blocking conditions implemented.                                                                                                               |
| **Performance**    | **PASS** | `pnpm audit:budgets` — 4 passed, 0 violated, 0 unmeasured                                                                                                                                                                                                         | Conditional PASS; all seven blocking conditions implemented.                                                                                                               |
| Security           | DEFERRED | —                                                                                                                                                                                                                                                                 | No sandbox, no sync, no user input at P0. First substantive review is due at P4 (sync auth) and P7 (script sandbox).                                                       |
| Release/Docs       | PASS     | this document, `docs/RESUME.md`, `CHANGELOG.md`                                                                                                                                                                                                                   | Continuity documents complete; a cold session can resume from files alone.                                                                                                 |

### Blocking findings and their resolutions

Every item below was raised by a review, and every one was fixed in code rather
than negotiated away.

| #   | Raised by     | Finding                                                                                                                                    | Resolution                                                                                                                                                                                                        |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | QA Automation | Self-test proved neither comparator threshold was load-bearing: both scenarios breached both gates, so gutting either left the suite green | Three gates, one isolating scenario each; verified by mutation (`2520574`)                                                                                                                                        |
| 2   | QA Automation | `docs/STATE.md` declared the phase signed against a `GATES.md` that did not exist                                                          | This document; STATE.md corrected                                                                                                                                                                                 |
| 3   | QA Automation | `planted-fault.spec.ts` asserted `report.ok === false`, which held regardless of the planted fault                                         | Replaced with a clean-counterpart assertion. **This row previously claimed a fix that had not landed** — the edit silently failed to apply and was reported as done; caught by the re-verification and corrected. |
| 4   | QA Automation | Production bundle test asserted absence of `"9000"`, which esbuild emits as `9e3` — unfalsifiable                                          | Removed, with the reason recorded inline (`b2ed521`)                                                                                                                                                              |
| 5   | QA Automation | The CI budget entrypoint had zero coverage; deleting its exit code left every suite green                                                  | Logic extracted to `runBudgetGate`, exit contract pinned by tests (`1db70cb`)                                                                                                                                     |
| 6   | Visual QA     | Mean SSIM diluted a deleted control to 0.9977; the mandated threshold caught 3 of 21 planted regressions                                   | Damaged-window gate added; RC-0003 (`2520574`)                                                                                                                                                                    |
| 7   | Visual QA     | A missing baseline was written and reported as a pass                                                                                      | Absent baseline now fails; creation is opt-in (`b2ed521`)                                                                                                                                                         |
| 8   | Visual QA     | `io.ts` had no coverage; `renderDiffImage` never executed by any test                                                                      | Unit tests added; also exercised by the planted visual regression                                                                                                                                                 |
| 9   | Visual QA     | No browser-level visual negative control — no capture ever compared against anything but itself                                            | Planted visual regression on all three profiles (`b2ed521`)                                                                                                                                                       |
| 10  | Visual QA     | `user-scalable=no` blocked pinch-zoom (WCAG 1.4.4)                                                                                         | Removed (`b2ed521`)                                                                                                                                                                                               |
| 11  | Visual QA     | `MIN_TOUCH_TARGET_PX` claimed an audit that did not exist                                                                                  | Constant removed; GAP-009 records the real state                                                                                                                                                                  |
| 12  | Performance   | Device-labelled budgets measured on unthrottled desktop hardware, with no gap recorded                                                     | GAP-006, with the phone-faster-than-desktop evidence                                                                                                                                                              |
| 13  | Performance   | Cold load anchored solely on a self-reported mark that fires before paint                                                                  | Now the later of the mark and first contentful paint, median of three fresh-page loads (`1db70cb`)                                                                                                                |
| 14  | Performance   | The gate accepted zero and negative measurements                                                                                           | Plausibility floors, plus self-test scenarios (`1db70cb`)                                                                                                                                                         |
| 15  | Performance   | `enforcedFrom` and `currentPhase` were untested one-word off switches                                                                      | Phases pinned per rule; `budgets.json` must agree with STATE.md (`1db70cb`)                                                                                                                                       |
| 16  | Performance   | `editor.bundle.gzip` deferred to P3 despite being measurable today                                                                         | Enforced from P0 with a real harness (`1db70cb`)                                                                                                                                                                  |
| 17  | Performance   | Byte budgets used binary units against a brief written in MB — a silent 4.9% relaxation                                                    | Decimal units, asserted below their binary equivalents (`1db70cb`)                                                                                                                                                |
| 18  | Performance   | Reports discarded measurement provenance; `sweep` never cleared stale files                                                                | Origin and timestamp printed; `sweep` starts with `audit:clean` (`1db70cb`)                                                                                                                                       |

### Process failures in this gate, recorded rather than smoothed over

Two of these were found by the re-verification, not by me, and both are the
same failure mode: **reporting an edit as done without confirming it applied.**

1. **A fix was claimed that had not landed.** The change to
   `planted-fault.spec.ts` was written as a string replacement whose anchor no
   longer matched, because the formatter had reflowed the surrounding lines. The
   replacement silently did nothing, and the result was recorded in this table
   and in a commit message as complete. The same failure hit the sign-off rows
   of this document, which continued to read PASS after being "changed" to
   PENDING — and that stale PASS was then quoted back to the reviewer as
   evidence. Every edit of this kind now asserts its anchor matched.

2. **The tree was not frozen when re-verification was requested.** Three source
   files were edited two seconds before the reviewer's end-to-end run finished,
   and the CI workflow after it. The edits were benign, but the artifact was
   produced against a moving tree and was described as frozen. Freeze means
   freeze.

Neither changed a verdict. Both are recorded because a gate register that
launders its own process failures is worth nothing.

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
- Cold load anchors its lower bound but does not measure interactivity: work
  deferred past both the readiness mark and first contentful paint is still
  invisible. Due when the editor has panels to mount, at P3.
- `cli/check-budgets.ts` retains seven lines of untested CLI wiring around the
  tested `runBudgetGate`.

---

## P1-PRE — Gate verifiability

**Status: CLOSED.**

**Why it exists.** P0 closed with a working harness whose device-named budgets
could not fail for the reason they named. The phone profile measured faster than
the desktop profile. Fixing that after building P1 on top of it would have meant
re-deriving every budget the new code introduced, so it was made blocking.

### Criterion evidence

| Criterion                                                               | Evidence                                                                                                                                                                                                                                                                                                | Status |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| CPU throttling applied and calibrated                                   | `pnpm calibrate:cpu` sweeps seven requested rates against a fixed 80M-iteration integer workload in a real page, median of five after two warmups. Rates chosen from measured slowdown: tablet 4 (4.32x), phone 6 (6.46x). Recorded in `docs/BUDGETS.md` and `profiles.ts`.                             | PASS   |
| Profile ordering asserted                                               | `pnpm audit:profile-ordering` — tablet 4.12x desktop (required 2.0x), phone 1.51x tablet (required 1.15x)                                                                                                                                                                                               | PASS   |
| Ordering check is the mutation test for throttling                      | Rates forced to 1 and the suite re-run: every ratio collapsed to exactly **1.00x**, check exited 1. Restored, exited 0.                                                                                                                                                                                 | PASS   |
| Unthrottled budgets renamed honestly                                    | `editor.coldLoad.desktop` → `ci-headless.editor.coldLoad`; `real-config.test.ts` asserts no budget is named after an unthrottled profile, and that every `ci-headless.` budget says it carries no device signal                                                                                         | PASS   |
| Deferred register populated                                             | Register 2 below, DV-001 through DV-006                                                                                                                                                                                                                                                                 | PASS   |
| Planted perf regression caught by the throttled budget and nothing else | `tests/e2e/planted-perf.spec.ts` — the same fixed-work regression is `passed` on the unthrottled profile (2.4s vs a 3s ceiling) and `violated` on the throttled tablet (7.9s vs a 6s ceiling) and phone (12.4s). The console guard reports nothing and the screenshot comparator reports no difference. | PASS   |
| That proof is itself load-bearing                                       | Throttling removed and the tablet leg re-run: it loaded in 2.07s, the budget returned `passed`, and the test failed with `Expected "violated"`.                                                                                                                                                         | PASS   |

### What this cost

DV-004. The desktop cold-load budget previously carried the brief's 3s desktop
ceiling under a device name and reported green. It now reports green under a
name that admits it measures a CI runner, and the device claim it used to imply
sits unverified in Register 2. That is a real loss of apparent coverage and an
exact gain in honesty.

### Note on the fixed-work regression

The first design for the planted regression was a wall-clock busy-wait, which
would have proved nothing: a spin on `performance.now()` takes the same wall
time however slow the CPU is, so it breaches every profile equally. The fault
performs a fixed number of arithmetic operations instead. Recorded in ADR-0011
because it is the kind of mistake that produces a confidently green test.

---

# Register 2 — DEVICE-VERIFIED (DEFERRED)

Every entry below is a claim the automated suite **cannot** make. None of them
may be counted toward closing a phase. All of them block the Definition of Done
in P9.

| ID     | Claim                                                                                               | Blocked phase gate | Why CI cannot close it                                                                                                                                                                                      | Procedure |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| DV-001 | The WebGPU renderer path matches WebGL2 within the mandated perceptual bound                        | P1                 | CI runners have no GPU; the development container has no working Docker daemon. The comparator and its thresholds exist and are unit-tested, but have never been run against two real backends.             | GAP-002   |
| DV-002 | The editor loads, plays and survives a soak on real iPhone hardware within the memory budget        | P6                 | Emulated Chromium at 390x844 is not iOS Safari. Tab termination under memory pressure, OPFS eviction on idle, WebAudio unlock and PWA install from the share sheet are all unobservable here.               | GAP-001   |
| DV-003 | Screenshot baselines are locked against a reproducible rendering environment                        | P3                 | Font rasterisation differs between environments; baselines captured in the development container would fail in CI. Antialiasing-susceptible edge pixels measure 5x-9x the entire same-backend pixel budget. | GAP-003   |
| DV-004 | The editor cold-loads within 3s on real desktop hardware                                            | P0                 | The profile that carries the brief's 3s ceiling runs unthrottled on a CI runner. It measures the runner. Its budget id was renamed `ci-headless.editor.coldLoad` to stop it implying otherwise.             | GAP-006   |
| DV-005 | Touch targets, gestures and the on-screen keyboard behave correctly on real Android tablet hardware | P5                 | Emulated touch does not exercise a real digitiser, pointer-event coalescing, or the on-screen keyboard.                                                                                                     | GAP-004   |
| DV-006 | Sync survives real network partitions against deployed Cloudflare infrastructure                    | P4                 | Local emulation does not reproduce Durable Object eviction mid-write, R2 consistency under concurrent multi-device writes, or real partition timing.                                                        | GAP-005   |

Each row's procedure lives in `docs/GAPS.md` under the referenced entry. A row
leaves this register only when the procedure has actually been performed and
its result recorded — not when it becomes inconvenient.

## What P1-PRE changed about this register

Before P1-PRE, DV-001 through DV-006 were scattered through `docs/GAPS.md` and
the P0 gate table's "explicitly not claimed" section. They were honest, but they
sat next to passing criteria in the same document, which invited exactly the
absorption this split exists to prevent.

DV-004 is new, and it is the one that cost something. The desktop cold-load
budget previously carried the brief's 3s desktop ceiling under the id
`editor.coldLoad.desktop`. It runs unthrottled, so on a CI runner it measures
the runner. Renaming it gave up a green row that looked like a device claim, and
moved the real claim here, unverified. See ADR-0011.
