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
git tag -a review/<phase>-<n> -m "..."      # implementer, before requesting review
pnpm review:worktree <role> review/<phase>-<n>
```

`pnpm review:worktree` creates the detached worktree and prints the SHA the
report must record.

**The SHA is the identifier, not the tag.** This environment's git proxy
refuses tag pushes with HTTP 403, so review tags exist only locally. A tag that
cannot leave the machine cannot identify a tree to anyone else; the commit SHA
can, and it is what every report records.

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
   evidence.

   The remedy is `editFile` in `@imagi3/repo`, which fails on a stale anchor,
   on an ambiguous one, and on a replacement that changes nothing, then reads
   the file back to confirm what landed. **Nothing mechanically compels its
   use** — it is a helper, not a lint rule, and a scripted edit written without
   it can still no-op silently. What can be said is that it is used and has
   earned its place: during P1-PRE it rejected seven stale anchors that would
   otherwise have been silent no-ops reported as done.

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

**Status: CLOSED.** Both mandatory roles signed independently, at recorded
SHAs, after three passes.

**Why it exists.** P0 closed with a working harness whose device-named budgets
could not fail for the reason they named: the phone profile measured faster than
the desktop profile, because all three were the same machine. Building P1 on
that foundation would have meant re-deriving every budget it introduced.

### Role sign-offs

| Role               | Verdict       | SHA       | Artifact                                                                                                                                                                                                   |
| ------------------ | ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA Automation      | **PASS**      | `3a7377b` | 275 unit tests, 38 self-tests, a 39-mutant sweep (28 killed), and a four-case end-to-end probe of the `unthrottled` gate status. Initially FAIL with seven conditions.                                     |
| Performance        | **PASS**      | `89a2f6e` | 298 unit, 51 e2e, ordering and budget gates green; verified the gate fails at 1.79x, at a missing ratio, at a widened scope, and at rate 1. Initially FAIL twice, with four conditions on the second pass. |
| Visual QA          | not requested | —         | No visual surface changed. Required again at the P1 gate.                                                                                                                                                  |
| Technical Director | **PASS**      | `89a2f6e` | Both mandatory roles signed; every blocking finding implemented rather than argued down.                                                                                                                   |

Both reviews ran in detached worktrees at tagged commits and recorded the SHA —
a protocol introduced in this gate because P0's reviews ran against a moving
tree.

### It took three passes, and each found the last fix reported as done before it was

This is the most useful thing to come out of the phase, so it is recorded rather
than smoothed over.

- **Pass 1** found that throttling never reached the budgets at all. It was
  applied to Playwright's fixture page while the cold-load spec measured pages
  it opened itself. Every device-named budget was measured at full desktop
  speed for the entire gate, while the self-test and the planted-regression
  proof stayed green on the fixture page. RC-0006.
- **Pass 2** found that `budgets.json` had never been edited, though the gate
  table recorded the edit as made — `git diff` was empty. It also found the
  evidence floor was a flat fraction of the requested rate rather than the ratio
  between the ceilings, so a tablet recording 1.70x passed while carrying no
  independent signal.
- **Pass 3** found that the estimator change I made in pass 2 was both
  unnecessary and wrongly justified, with counterexamples to both halves of my
  argument.

Three fixes reported complete before they were, two caught by reviewers rather
than by me. The pattern is one thing — an edit is not landed because a command
exited zero — and the tooling response (`editFile`, RC-0005) reduces it without
eliminating it.

### The blocking finding

**CDP throttling is per-page, and the gate measured pages that never got it.**
The fixture threw its rate at Playwright's `page`; `sampleColdLoad` opened its
own pages with `context.newPage()`. Measured directly by the reviewer: fixture
page 4.75x, freshly opened page **1.02x**. All three device-named budgets were
measured at full desktop speed, for an entire gate, while the self-test and the
planted-regression proof stayed green on the fixture page. RC-0006 has the
anatomy.

The first fix did not hold either: throttling `openPage` and verifying inside it
meant the mutation that removed the throttling removed its verification too, and
the suite stayed green. The check that works is the one on the artifact — the
budget gate now rejects a device-scoped measurement that cannot evidence the
throttling of the page it came from, as a new failing status `unthrottled`.

### Findings and resolutions

| #   | Raised by     | Finding                                                                                                                                      | Resolution                                                                                                                                                                                                                                                                                         |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Performance   | Cold-load budgets measured with zero throttling                                                                                              | `openPage` fixture, self-verifying throttling, and an artifact-level `unthrottled` gate status                                                                                                                                                                                                     |
| 2   | Performance   | budgets.json descriptions asserted throttling that was not happening                                                                         | **This row previously recorded a fix that was never made** — `git diff` showed budgets.json byte-for-byte unchanged, and the second Performance review caught it. The descriptions now state the requested rate and point at the per-measurement evidence rather than pinning a range that drifts. |
| 3   | Performance   | Planted regression sized for one host; 1.32x headroom                                                                                        | Workload computed per host from measured ms-per-iteration, targeting the geometric middle of the valid window                                                                                                                                                                                      |
| 4   | Performance   | `ProfileBenchmark` had no provenance, so a stale file passed silently                                                                        | `recordedAt` stamped on write, `origin` recorded, both printed                                                                                                                                                                                                                                     |
| 5   | Performance   | BUDGETS.md and GAPS.md described a median the code deliberately does not use                                                                 | Corrected to the worst of three, with the reasoning                                                                                                                                                                                                                                                |
| 6   | QA Automation | The four new guards had no positive controls                                                                                                 | Detectors extracted as pure functions and tested against planted strays                                                                                                                                                                                                                            |
| 7   | QA Automation | `isCiHeadlessBudget` gated a loop with no assertion that it ran                                                                              | Iterations counted and asserted non-zero                                                                                                                                                                                                                                                           |
| 8   | QA Automation | `MINIMUM_RATIOS` unconstrained; 1.01 passed the suite                                                                                        | Floors pinned at 1.5x and 1.1x                                                                                                                                                                                                                                                                     |
| 14  | Performance   | The throttling floor was a flat 0.4 of the requested rate, so a tablet at 1.70x passed while carrying no independent signal                  | Floor derived from the ratio between the two ceilings (2.0x), because below that the throttled budget is strictly dominated by the unthrottled one                                                                                                                                                 |
| 15  | Performance   | `scope` was load-bearing but unpinned; widening a budget to `all` disabled the evidence check silently                                       | `scope` added to the pinned budget table                                                                                                                                                                                                                                                           |
| 16  | Performance   | The planted workload was sized from the nominal rate while a measured one was in hand, leaving 1.18x tablet headroom on a low-throttling run | Sized from the observed slowdown                                                                                                                                                                                                                                                                   |
| 17  | Performance   | The recorded ratio was systematically pessimistic: a short probe reduced by the worst sample                                                 | 80M-iteration probe, best observation across sampled pages; the tablet now records 4.0x-5.4x where it recorded 1.7x-3.1x                                                                                                                                                                           |
| 18  | QA Automation | `editFile` accepted a batch whose replacements cancel out — a regression introduced by the round-1 fix                                       | Batch-level check restored alongside the per-replacement one                                                                                                                                                                                                                                       |
| 9   | QA Automation | `bench/store.ts` and `cpu-bench-page.ts` shipped untested                                                                                    | Unit tests for `median`, the rate guard, and every validation branch                                                                                                                                                                                                                               |
| 10  | QA Automation | `editFile` could still no-op per replacement                                                                                                 | Each replacement must change something; `count` validated; length fields documented as UTF-16 units                                                                                                                                                                                                |
| 11  | QA Automation | GATES.md claimed every edit asserts its anchor                                                                                               | Rewritten to say a helper exists, is used, and compels nothing                                                                                                                                                                                                                                     |
| 12  | QA Automation | GAP-007 did not cover the new perf proof                                                                                                     | Extended to both planted-fault specs                                                                                                                                                                                                                                                               |
| 13  | Both          | P1-PRE recorded CLOSED with no sign-offs                                                                                                     | This section                                                                                                                                                                                                                                                                                       |

### What could not be verified

QA Automation could not run Playwright — ports were reserved for the concurrent
Performance review — so every browser-measured figure in this section rests on
the Performance review and on CI, not on two independent runs. The reviewer said
so rather than guessing, which is the behaviour the register is for.

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
