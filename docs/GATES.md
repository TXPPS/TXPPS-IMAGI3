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

## Guard audit

Every detector in the tree, against the rule in `docs/ARCHITECTURE.md`:

> A guard must not be deletable by the edit that introduces the defect it
> catches.

Two questions per guard. **What single edit introduces the defect?** and **does
that same edit remove or disable the guard?** A guard answering yes to the
second is relocated or replaced — it is not a guard, it is a comment that runs.

The P0 detectors were expected to fail this audit, having been written before
the lesson. Two did.

**The audit's own blind spot, found by review one pass later, and the more
useful finding of the two.** This table enumerates guards that exist and asks
whether each survives the defect it catches. It cannot ask the other question —
_what has no guard at all_ — and so it did not notice that the renderer had
none. Visual QA deleted every draw call in the engine and the entire suite
stayed green (RC-0009). A guard audit is a list of answers; the missing rows are
where the failures live. When a subsystem is added, the question to ask first is
not "is its guard well-placed" but "which row is it".

| Guard                         | Lives in                            | The defect it catches                                   | Same edit disables it?                                                                                                                    | Mutation                                                                    |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Budget bounds                 | `budgets/check.ts`                  | A measurement outside its ceiling                       | No. The defect is slow code; the guard is a separate process reading an artifact                                                          | `detectors.test.ts`, planted 40% over ceiling (`c43c8d1`)                   |
| Unmeasured is failure         | `budgets/check.ts`                  | A budget nobody measured reported as green              | No. Deleting the harness is what triggers it                                                                                              | `check.test.ts`; RC-0004 was found by it                                    |
| Orphan measurement ids        | `budgets/check.ts`                  | A harness writing a value no rule claims                | No                                                                                                                                        | `detectors.test.ts` (`c43c8d1`)                                             |
| **Throttling evidence**       | `budgets/throttle.ts` + `check.ts`  | A device-named budget measured on an unthrottled page   | **No, now.** Was yes: see below                                                                                                           | `check.test.ts` — a plausible ratio with no samples (`0899ec7`)             |
| Throttle verification on page | `cpu-bench-page.ts`                 | CDP throttling not reaching a page                      | **Yes**, and knowingly. Removing the throttling removes its verification; this is a fail-fast convenience, and the guard is the row above | Held by the artifact check, not by this                                     |
| Profile ordering              | `bench/ordering.ts`                 | Throttling absent from the whole run                    | No. Separate CLI over artifacts; ratios collapse to 1.0 and it fails                                                                      | Verified by disabling throttling (`89a2f6e`)                                |
| Profile rate mismatch         | `bench/ordering.ts`                 | A stale benchmark artifact                              | No, with a stated limit: the harness writes the rate from the profile, so it cannot detect a live mismatch                                | `ordering.test.ts`                                                          |
| **Console incidents**         | `tests/e2e/fixtures.ts`             | Console errors, throws, unhandled rejections            | **No, now.** Was yes: see below                                                                                                           | `planted-fault.spec.ts`, permanent expected-failure test                    |
| Console allowlist judgement   | `console/allowlist.ts`              | An unallowlisted signal treated as benign               | No. Pure function, tested against planted entries                                                                                         | `detectors.test.ts` (`c43c8d1`)                                             |
| Pixel delta gate              | `image/pixel-diff.ts`               | A visible rendering change                              | No. Comparator is in the audit package; the defect is in app code                                                                         | 21 planted regressions; each gate isolated (`2520574`)                      |
| Mean SSIM gate                | `image/ssim.ts`                     | A structural rendering change                           | No                                                                                                                                        | As above; RC-0003 records what it missed alone                              |
| Damaged-window gate           | `image/compare.ts`                  | A small but total local change                          | No                                                                                                                                        | As above                                                                    |
| Absent baseline is failure    | `image/io.ts`                       | A first run inventing its own baseline                  | No                                                                                                                                        | `visual.spec.ts` (`b2ed521`)                                                |
| Bundle size                   | `bundle/measure.ts` + budget gate   | Bundle growth past its ceiling                          | No. Measured by a CLI, judged by the gate                                                                                                 | `detectors.test.ts` on real bytes (`c43c8d1`)                               |
| No dev faults in production   | `apps/editor/test/no-dev-faults.ts` | Debug scaffolding shipped to users                      | No. Guard builds its own bundle; paired with a presence check so a broken build cannot pass                                               | RC-0002 records the version that could not fail                             |
| Budget naming honesty         | `budgets/ids.ts`                    | A budget named for an unthrottled profile               | No. Pure over an id list, tested against planted ids                                                                                      | `real-config.test.ts`                                                       |
| Phase agreement               | `real-config.test.ts`               | `budgets.json` and `STATE.md` disagreeing               | No. Reads both files                                                                                                                      | `real-config.test.ts`                                                       |
| Stray declarations            | `stray-declarations.ts`             | Generated `.d.ts` committed beside source               | No. The defect is a tsconfig change; the guard is a test that walks the tree                                                              | `no-stray-declarations.test.ts`                                             |
| Schema boundary               | `schema/validate.ts`                | An unreadable document loading half-way                 | No. The defect is in the document                                                                                                         | `fuzz.test.ts`, 300+ mutants                                                |
| Graph repair convergence      | `graph.ts`                          | Peers diverging on the same merge                       | No. Properties are asserted over generated input, not over the implementation                                                             | Permutation and convergence properties (`0899ec7`)                          |
| Claims ledger                 | `claims.ts` + CI                    | A documented fix that never landed                      | No. Writing a false claim in a document does not touch the checker                                                                        | Planted false claim, exit 1 (below)                                         |
| Shell-edit ban                | `no-shell-edits.ts`                 | An unverified `sed -i` returning to the tree            | No. Adding one to a workflow does not touch the test                                                                                      | 10 planted forms, 7 legal forms                                             |
| Simulation determinism        | `runtime/test/determinism.test.ts`  | A simulation reading something outside its inputs       | No. Hashes the canonical serialisation of state, not the objects, so a change to the systems cannot also change what counts as identical  | Iteration order unsorted — kills that test and only that one                |
| System order                  | `simulation.ts` `SYSTEM_ORDER`      | A silent reordering changing behaviour                  | No. The order is data and a test asserts the list                                                                                         | Any reorder fails the assertion                                             |
| Frame statistics              | `budgets/frames.ts`                 | A page reporting its own frame rate                     | No. The page records raw durations; the gate derives the statistic in another process                                                     | `frames.test.ts` — a hitching run must not read as its mean                 |
| Too-few-frames refusal        | `budgets/frames.ts`                 | A percentile taken over a run that barely happened      | No. Refusing to produce a number is what stops the gate treating it as evidence; it fired for real on the first play-mode run             | `frames.test.ts`, and the run that found it                                 |
| Frozen-world refusal          | `budgets/frames.ts`                 | A renderer drawing a static scene meeting any budget    | No. The step count travels in the artifact and the gate checks it                                                                         | `frames.test.ts`; also asserted live in `playmode.spec.ts`                  |
| Budget pin                    | `real-config.test.ts`               | A budget quietly weakened, rescoped or deferred         | No. The mandated list is a second copy of the brief's numbers, in a different file from `budgets.json`                                    | Caught the P9 deferral in this session, as designed                         |
| WebGL2 is the path taken      | `playmode.spec.ts`                  | A profile silently falling back to another backend      | No. Asserted from the DOM on every profile, not from the selection logic                                                                  | `backend.test.ts` covers selection; the spec covers the reality             |
| Runtime chunk exists          | `measure-bundle.ts`                 | The renderer merging into the editor's entry chunk      | No. A missing chunk is an error, not a zero — the RC-0004 shape                                                                           | Reports exit 1 with no `imagi3-runtime` chunk                               |
| Runtime chunk is the runtime  | `measure-bundle.ts`                 | A rename-only split leaving three.js in the entry chunk | No. Share of build checked as well as name                                                                                                | Rename-only split reports 1.6%, exit 1                                      |
| Budget plausibility floors    | `real-config.test.ts`               | A broken instrument scoring zero and passing            | No. Derived from the document, so a rule cannot be added without one; it found three more the moment it stopped using a hardcoded list    | An instrument returning 0ms; Performance B2                                 |
| Engine frame budget           | `budgets/frames.ts`                 | Engine cost past half a 60Hz frame                      | No. Costs divided by the work that produced them, so frame cadence cannot move it                                                         | 2x frame work caught; 3x simulation **not** caught, asserted                |
| Dropped frame budget          | `budgets/frames.ts`                 | Frames missing a vsync                                  | No. Counted from raw durations                                                                                                            | 100% dropped caught; an on-time page reads 0% — RC-0012                     |
| System order (execution)      | `determinism.test.ts`               | A silent reordering inside `stepWorld`                  | **No, now.** Was yes: asserting the declaration is not asserting the behaviour, and reversing the loop passed 732 tests                   | Reversed iteration — now fails                                              |
| Claims ledger (prose form)    | `claims.ts` + CI                    | A commit reference nobody wrote in the marker syntax    | No. The four bypasses QA Automation demonstrated are parsed and tested                                                                    | Each bypass form, as a test case                                            |
| Runtime assertions            | `assertions.ts` + CI                | A comment claiming a runtime property that is false     | No. The claims ledger could not see it — a commit had touched both files that lied. Found a live one on its own first run                 | A reference naming a spec that does not exist — RC-0010                     |
| Tree hygiene                  | `tree-hygiene.ts` + CI              | A reviewer writing into the main tree                   | No. A different program refuses to sweep; read-only worktrees are the guardrail, this is the guard                                        | Planted porcelain output; caught its own new files first run                |
| Findings are not instructions | `review-findings.ts`                | A reviewer report directing a change of method          | No. Rejected on ingest, before evaluation, because evaluating it is the failure                                                           | Nine directive forms, four look-alike findings that must pass               |
| **Mutation sweep**            | `mutations.ts` + CI                 | A surface with no detector at all                       | No, and this is the point: it starts from production code, not from detectors, so it can see what the guard audit structurally cannot     | 16 mutations killed; a deliberately unguarded function survives             |
| **Mutant enumeration**        | `mutants/enumerate.ts` + CI         | A surface nobody thought to doubt                       | No, and this is the point: mutants are derived from the AST, so a new export is enumerated by existing rather than by being registered    | Its own first run found the dropped-argument kind exempted every plain call |
| Coverage ratchet              | `mutation-baseline.json` + CI       | Coverage quietly going backwards                        | No. Lowering the recorded ratio takes a visible commit of a worse number                                                                  | Planted regressions in `mutants.test.ts`, both directions                   |
| State-hash field audit        | `runtime/test/hash.test.ts`         | A field of simulation state absent from the digest      | No. Compares the runtime keys of a state object against the declared lists, so a field added tomorrow fails until someone decides         | `runtime.hash.dropControlled` — RC-0015                                     |
| Serialiser field audit        | `core/test/schema/field-audit.ts`   | A field dropped by the load boundary                    | No. Compares canonical bytes before and after loading, which the round-trip test cannot — it compares the validated document to itself    | `core.validate.dropOrder`                                                   |
| **Something was drawn**       | `tests/e2e/render.spec.ts`          | A renderer that submits no draw call                    | **No, now.** Was absent entirely: see RC-0009                                                                                             | Empty `present()` — killed on all three profiles                            |
| Sprite aspect                 | `tests/e2e/render.spec.ts`          | A frustum that ignores the viewport                     | No. Measured from the rendered bounding box, not from the camera code                                                                     | Square frustum — 0.457 aspect on phone, fails                               |
| Resize follows the viewport   | `tests/e2e/render.spec.ts`          | `resize` never being called                             | No. Rotates the viewport and measures where content reaches                                                                               | Removing `observeResize` leaves content in the top half                     |
| Parity required-set           | `parity.ts`                         | A caller omitting the backend it did not render         | No. The safe set is the default and narrowing throws                                                                                      | `judgeParity({webgl2}, ['webgl2'])` was `ok: true`, now throws              |

### The two that failed, and what was done

**Throttling evidence** (P1-PRE). The measurement carried a `throttleRatio`
scalar written by the harness that produced it — a producer attesting its own
work, which is the rule's first corollary. A harness that stopped throttling but
kept reporting `4.7` would have passed, and nothing in the artifact could have
contradicted it. Replaced with raw paired samples plus probe metadata, from
which the gate derives the ratio itself: `file:tools/audit/src/budgets/throttle.ts @ 0899ec7`.
The mutation is a probe carrying a plausible ratio and no samples, which the
gate now rejects — because there is no longer a ratio field for it to carry.

**Console incidents** (P0). Playwright instantiates a fixture only for tests
that destructure it, so the console guard ran for four of thirteen specs and was
absent from the other nine. Nothing reported this; the four that asked for it
passed, and the suite looked green. The fixture is now `auto`, and the mutation
is permanent rather than run once: an expected-to-fail test in
`planted-fault.spec.ts` plants a console error without requesting the fixture,
so if `auto` is ever removed that test passes and Playwright fails the run for
an unexpected pass. Verified both ways — expected-failure with `auto: true`,
unexpected pass with it off.

### Claims ledger positive control

A false claim must fail the build, and a true one must not. Both were run
against the real history rather than a mock, each in a scratch file claiming
`packages/core/src/canonical.ts`:

```
claimed against 8fce385  -> CLAIMS OK: 1 verified against the history   exit 0
claimed against 1946f48  -> CLAIMS FAILED: 1 of 1 claim a change ...    exit 1
```

`8fce385` is the commit that added that file; `1946f48` is a documentation-only
commit that does not touch it. The second is the shape of the failure that has
happened three times here, and it now cannot be committed silently.

The claim marker is deliberately **not** written out in that block. The parser
has no notion of a code fence, so a documented example would be checked as a
real claim — and teaching it to skip fenced blocks would hand anyone a way to
park a false claim inside one. Living without an inline example of the syntax is
the cheaper of the two costs.

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
| 15  | Performance   | `enforcedFrom` and `currentPhase` were untested one-word off switches                                                                      | Phases pinned per rule; `budgets.json` (`1db70cb`) must agree with the phase in docs/STATE.md                                                                                                                                       |
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

## P1 — Core, runtime and renderer

**Status: OPEN.** Three roles reviewed pass 1 at `24ea825` and **all three
returned FAIL**: Visual QA with 8 blocking conditions, QA Automation with 9, and
Performance with 5. Every condition has been addressed, and four further items
(S4-S7) landed after them: a security incident record, the mutation sweep, the
assertion checker, and the extended shell-edit ban. **No role has signed, so
this phase is not closed.**

Two criteria in the table below are marked **not gate evidence**. They are
self-authored budgets, and a budget the implementer invented cannot establish
that the implementer met the brief — see ADR-0016. The brief's own criterion
for the same thing is DEFERRED under DV-007 and stays there until hardware
discharges it, not until a substitute passes.

That is the entire status. The sign-off table below is empty on purpose — a
phase closes when roles sign, and writing anything else in it would be the
failure this document was created to stop (P0 finding 2: STATE.md declared a
phase signed against a GATES.md that did not exist).

There was also no P1 section here at all when pass 1 was submitted, which QA
Automation recorded as the third occurrence of that same shape. There is one
now, before any role is asked to sign it.

### Criterion evidence

| Criterion                                                               | Evidence                                                                                                                   | Status               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Scene schema v1, canonical serializer, round-trip stability             | `pnpm test` — round-trip byte-identical over generated graphs to 10,000 entities; serialisation stable across processes    | PASS                 |
| Deterministic graph repair                                              | Idempotence, permutation-independence over 20 shuffles, and peer convergence, all property-tested (ADR-0014)               | PASS                 |
| Fuzz suite: typed error or repaired document, never a crash             | `packages/core/test/schema/fuzz.test.ts` — 300+ mutants; found untyped `SyntaxError` escaping `parseCanonical`             | PASS                 |
| Determinism: same seed + tape, identical hash after 10,000 ticks, twice | `packages/runtime/test/determinism.test.ts`, with negative controls on seed, tape, tick count and insertion order          | PASS                 |
| One runtime, two consumers                                              | `session.test.ts` — a clock-driven session and a headless run reach the same hash                                          | PASS                 |
| three.js renderer on WebGL2, the primary path                           | `tests/e2e/render.spec.ts` — asserted from the DOM on all three profiles                                                   | PASS                 |
| The renderer draws                                                      | `tests/e2e/render.spec.ts` — pixel coverage, motion, square aspect, rotation. Kills the empty-`present()` mutant (RC-0009) | PASS                 |
| Renderer parity harness wired, WebGPU UNMEASURED                        | `tests/e2e/render.spec.ts` compares two WebGL2 captures and asserts the report is **not** ok                               | PASS                 |
| `runtime.bundle.gzip` measured and attributable                         | 128 KB against 1.5 MB; a rename-only chunk split fails at 1.6% share                                                       | PASS                 |
| Engine CPU inside its share of a 60Hz frame                             | 4.66ms against 8ms, throttled tablet. **Self-authored budget — ADR-0016**                                                  | not gate evidence    |
| Reference scene meets the brief's frame budget on a throttled tablet    | —                                                                                                                          | **DEFERRED, DV-007** |
| Reference scene at 60fps on a real tablet                               | —                                                                                                                          | **DEFERRED, DV-007** |
| WebGPU parity                                                           | —                                                                                                                          | **DEFERRED, DV-001** |

### Role sign-offs

| Role          | Verdict      | Artifact                                     | Notes                                    |
| ------------- | ------------ | -------------------------------------------- | ---------------------------------------- |
| QA Automation | **unsigned** | pass 1 report at `24ea825`: FAIL, 9 blocking | All 9 addressed; pass 2 not yet reviewed |
| Visual QA     | **unsigned** | pass 1 report at `24ea825`: FAIL, 8 blocking | All 8 addressed; pass 2 not yet reviewed |
| Performance   | **unsigned** | pass 1 report at `24ea825`: FAIL, 5 blocking | All 5 addressed; pass 2 not yet reviewed |

### Blocking findings from pass 1, and their resolutions

Every one was fixed in code, and the four that were wrong claims rather than
wrong code were corrected where they were written.

| #   | Raised by     | Finding                                                                                                                                   | Resolution                                                                                                           |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Visual QA     | Replacing `SceneView.present` with an empty function left **all 732 unit and 62 E2E tests green** while the page rendered one flat colour | `render.spec.ts`, pixel-level, all three profiles; RC-0009                                                           |
| 2   | Visual QA     | `view.ts` had no test file of any kind                                                                                                    | `frustumFor` extracted and unit-tested; the rest covered in the browser                                              |
| 3   | Visual QA     | The parity harness had no caller, while its header claimed a comparison "runs today"                                                      | Wired in `render.spec.ts`; header corrected; RC-0010                                                                 |
| 4   | Visual QA     | `judgeParity`'s `required` had no default, so omitting a backend gave `ok: true` with no mention of it                                    | Defaults to every backend; narrowing throws                                                                          |
| 5   | Visual QA     | `webgpu.ts` claimed to be "wired"; it had no caller, no test, was tree-shaken from every chunk, and its `render()` throws                 | Header, GAP-002 and DV-001 all corrected to name both blockers                                                       |
| 6   | Visual QA     | A square frustum on a non-square viewport stretched every sprite; a 4x4 quad drew 21x46px on the phone                                    | Aspect-correct camera, asserted from the rendered bounding box                                                       |
| 7   | Visual QA     | `SceneView.resize` was dead code; rotation left the scene in 45% of the screen                                                            | `observeResize`; asserted by rotating the viewport                                                                   |
| 8   | Visual QA     | The comparator has a measured colour blind spot on flat-shaded content — 14.5% channel drift passes all three gates                       | Measured numbers recorded in GAP-002 with a calibration plan                                                         |
| 9   | QA Automation | The substitute budget did not measure engine cost: 3x work invisible, DPR change moved it 44%                                             | Costs divided by the work that produced them; RC-0011                                                                |
| 10  | QA Automation | `entityCount` was the requested count, so a scene truncated to 1 entity certified 400                                                     | Read from the document, cross-checked against `view.meshCount`                                                       |
| 11  | QA Automation | `cpuFrameMsFrom` returning the _fastest_ frame passed the whole suite                                                                     | Discriminating fixtures where min, median and p95 differ                                                             |
| 12  | QA Automation | The guard-audit row "any reorder fails the assertion" was false — reversing `stepWorld`'s iteration passed 732 tests                      | Execution order asserted via an observer; row corrected                                                              |
| 13  | QA Automation | The audit self-test was never extended past P0's eight detectors                                                                          | Four P1 detectors added, completeness rescoped from a phase to the harness                                           |
| 14  | QA Automation | `editor.bundle.gzip` was 97.8% three.js; the two bundle budgets double-counted                                                            | Editor total is now the build less the runtime chunk                                                                 |
| 15  | QA Automation | The claims ledger was opt-in and P1 opted out entirely; four bypasses confirmed                                                           | Prose form parsed, whole repo scanned, bypasses tested                                                               |
| 16  | Performance   | Three rules newly enforced at P1 had no `min`; a broken instrument scored 0ms and passed                                                  | Floors added; the floor test now iterates the document instead of a hardcoded list, and immediately found three more |
| 17  | Performance   | `runtime.bundle.gzip` checked a chunk _name_; a rename-only split under-reported by 98.4%                                                 | Share of build checked as well as name                                                                               |
| 18  | Performance   | **The deferred budget could never have passed**: an empty page with no engine reads 59.2fps                                               | Restated as dropped-frame ratio, with the empty page as its positive control; RC-0012                                |
| 19  | Performance   | `median()` returned the upper middle, so `[1.0x, 9.0x]` gave 9.0x — the maximum the docs reject                                           | Averages the two middle values                                                                                       |
| 20  | Performance   | The physics floor was described as "two orders of magnitude" below any host; it is 12.5x                                                  | Corrected where it was written                                                                                       |

### What pass 1 got right, recorded because a review is not only its findings

All three reviewers independently confirmed: the core, the graph repair, the
tick loop and the interpolator are well-guarded — QA Automation killed 22 of 22
mutations against them, several by property and fuzz tests rather than chosen
cases. The determinism suite has working negative controls on seed, tape, tick
count and insertion order, and a non-vacuity check on its own permutation
helper. Performance reproduced the CPU calibration to within 6% and confirmed
the median-over-p95 argument with its own six runs. The failures were
concentrated in the new measurement surface and in the records describing it,
not in the engine.

---

# Register 2 — DEVICE-VERIFIED (DEFERRED)

Every entry below is a claim the automated suite **cannot** make. None of them
may be counted toward closing a phase. All of them block the Definition of Done
in P9.

| ID     | Claim                                                                                               | Blocked phase gate | Why CI cannot close it                                                                                                                                                                                                                             | Procedure |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| DV-001 | The WebGPU renderer path matches WebGL2 within the mandated perceptual bound                        | P1                 | **Two blockers, not one.** No GPU here; and the WebGPU draw path is unimplemented — `render()` throws, and the module is tree-shaken out of every chunk. The comparator also has a measured colour blind spot on flat-shaded content. See GAP-002. | GAP-002   |
| DV-002 | The editor loads, plays and survives a soak on real iPhone hardware within the memory budget        | P6                 | Emulated Chromium at 390x844 is not iOS Safari. Tab termination under memory pressure, OPFS eviction on idle, WebAudio unlock and PWA install from the share sheet are all unobservable here.                                                      | GAP-001   |
| DV-003 | Screenshot baselines are locked against a reproducible rendering environment                        | P3                 | Font rasterisation differs between environments; baselines captured in the development container would fail in CI. Antialiasing-susceptible edge pixels measure 5x-9x the entire same-backend pixel budget.                                        | GAP-003   |
| DV-004 | The editor cold-loads within 3s on real desktop hardware                                            | P0                 | The profile that carries the brief's 3s ceiling runs unthrottled on a CI runner. It measures the runner. Its budget id was renamed `ci-headless.editor.coldLoad` to stop it implying otherwise.                                                    | GAP-006   |
| DV-005 | Touch targets, gestures and the on-screen keyboard behave correctly on real Android tablet hardware | P5                 | Emulated touch does not exercise a real digitiser, pointer-event coalescing, or the on-screen keyboard.                                                                                                                                            | GAP-004   |
| DV-006 | Sync survives real network partitions against deployed Cloudflare infrastructure                    | P4                 | Local emulation does not reproduce Durable Object eviction mid-write, R2 consistency under concurrent multi-device writes, or real partition timing.                                                                                               | GAP-005   |
| DV-007 | The reference 2D scene sustains 60fps on real tablet hardware                                       | P1                 | CI has no GPU and renders through SwiftShader, where frame cost scales with pixels rather than with engine work. The throttled tablet profile misses 60fps with **one** entity on screen. See ADR-0015.                                            | GAP-011   |

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
