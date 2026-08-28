# RESUME

Everything a fresh session with zero conversation history needs. Rewrite this
file; do not append to it.

## What IMAGI3 is

A browser-native 2D+3D game engine — editor and runtime — installable as a PWA
on desktop, Android tablet and iPhone. Same projects everywhere, seamless
handoff mid-edit, fully functional offline. The target is "Godot-class 2D
authoring plus competent 3D authoring, in a browser, synced across devices."

## Where the project is

Phase 0 (Foundation) is **complete and signed** — QA Automation, Visual QA and
Performance each verified it independently; docs/GATES.md has the table and all
18 blocking findings they raised. Phase 1 (Core + runtime) is next. Read
`docs/STATE.md` for the exact next actions.

One habit is worth carrying forward, because it produced most of the value in
P0: for any gate, do not ask whether the threshold is right. Construct the
regression the gate exists to catch and watch it fire — then delete the gate and
watch the suite go red. Three of the five root causes in docs/BUGS.md are
assertions that could not fail, and none of them looked wrong when written.

## Repository layout

```
apps/editor/        The PWA shell. Vite app. P0 renders a static shell only.
tools/audit/        The audit harness: budgets, console guard, perceptual
                    image comparison, measurement collection. Node-only.
tests/e2e/          Playwright suite, one project per device profile.
budgets.json        Single source of truth for performance budgets.
audit.allowlist.json  Console errors the harness tolerates. Currently empty.
docs/               Continuity documents. Start with STATE.md.
```

`packages/` is empty and will hold `core`, `runtime`, `render`, `storage`,
`sync`, `scripting`, `gameplay` and `export` as their phases arrive.

## Commands

| Command                             | What it does                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install. Node >= 22, pnpm 10.33.                                                                                                                                                |
| `pnpm verify`                       | format check, lint, typecheck, unit tests, build.                                                                                                                               |
| `pnpm sweep`                        | The full back-to-front sweep, in dependency order: clear stale measurements, verify, measure the bundle, E2E, profile ordering, budget gate. Run this before closing any phase. |
| `pnpm test`                         | All Vitest projects (`audit`, `audit-selftest`, `repo`, `editor`).                                                                                                              |
| `pnpm audit:selftest`               | Proves the audit harness catches planted failures.                                                                                                                              |
| `pnpm test:e2e`                     | Playwright across desktop, tablet and phone profiles.                                                                                                                           |
| `pnpm audit:bundle`                 | Gzips the built editor assets and records the size. Needs `pnpm build` first.                                                                                                   |
| `pnpm audit:profile-ordering`       | Verifies CPU throttling is in effect: tablet slower than desktop, phone slower than tablet.                                                                                     |
| `pnpm audit:budgets`                | Compares collected measurements against `budgets.json`.                                                                                                                         |
| `pnpm calibrate:cpu`                | Sweeps CDP throttling rates against a fixed benchmark and reports achieved slowdown.                                                                                            |
| `pnpm review:worktree <role> <tag>` | Detached worktree at a tagged commit, for an isolated role review.                                                                                                              |
| `UPDATE_BASELINES=1 pnpm test:e2e`  | Rewrite screenshot baselines instead of comparing.                                                                                                                              |

`pnpm test:e2e` starts two servers itself: a production preview on 4173 (what
the gates run against) and a dev server on 5173 (the planted-fault and
planted-perf proofs use it, because fault injection exists only in dev builds).

**The tablet and phone profiles run under CPU throttling** (4x and 6x, applied
via CDP in the `page` fixture). `pnpm audit:profile-ordering` asserts on every
run that the throttling is actually in effect; without it, all three profiles
measure the same machine and every device-named budget is decorative.

## How the audit system works

The harness is not a set of assertions bolted onto tests; it is a package with
its own tests, plus a self-test that proves each detector distinguishes clean
input from deliberately defective input (`tools/audit/test/selftest/`).

Six detectors exist today:

- **Budget checker** — compares measurements to `budgets.json`. A rule that is
  enforced in the current phase but has no measurement is a FAILURE, not a
  pass. This is what stops "green" from meaning "we did not look".
- **Console guard** — judges console errors, uncaught exceptions and unhandled
  rejections against `audit.allowlist.json`. Only console errors can ever be
  allowlisted, and every entry needs a justification and a tracking reference.
- **Perceptual image comparator** — three gates: differing-pixel ratio
  (YIQ-weighted), mean SSIM, and the fraction of 8x8 windows below a
  severe-damage floor. The third exists because mean SSIM alone cannot see a
  deleted control at UI resolution; see ADR-0005 and RC-0003.
- **Console allowlist validator** — rejects an allowlist entry without a
  justification, without a tracking reference, or with an invalid pattern.
- **Bundle measurer** — gzips the built JS and CSS and reports the total for
  the `editor.bundle.gzip` budget.
- **Measurement collection** — harnesses drop JSON into `.audit-out/measurements`;
  the CLI merges and checks them. Unknown measurement ids fail the gate too, so
  a renamed budget cannot silently stop being enforced.

The self-test proves each of these distinguishes clean input from a planted
defect, and for the comparator it proves each of the three gates is
individually load-bearing.

## Gotchas

- **`.ts` extensions in imports are mandatory.** `tsc` runs as a typechecker
  only (`emitDeclarationOnly`), and `erasableSyntaxOnly` is on, so every source
  file also runs directly under `node --experimental-strip-types`. No enums, no
  parameter properties, no namespaces.
- **Playwright is pinned to 1.56.1** because that is the version whose Chromium
  revision (1194) matches the browsers provisioned in the dev container. Do not
  upgrade it without also confirming the browser revision, or E2E will try to
  download a browser it cannot fetch.
- **TypeScript is pinned to 5.9.3.** typescript-eslint 8.x declares
  `typescript >=4.8.4 <6.1.0`; TypeScript 7 is outside that range.
- **The dev fault injector must stay dev-only.** `apps/editor/src/dev/plant.ts`
  is loaded behind `import.meta.env.DEV`. If that guard is removed, the fault
  strings ship to production.
- **Do not add a `.skip`, `it.todo`, `@ts-ignore` or `any`.** Lint enforces
  `no-explicit-any` and bans `@ts-ignore`; the brief bans skipped gates.
