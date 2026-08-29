# BUDGETS

`budgets.json` at the repository root is the single source of truth. This
document explains the model and the provenance of each number; it does not
restate the values, because a second copy of a number is a second chance to
disagree with it. `tools/audit/test/budgets/real-config.test.ts` asserts that
the committed values still match the brief.

## The model

Every rule declares:

| Field          | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| `id`           | Stable identifier a measuring harness reports against. |
| `unit`         | `ms`, `bytes`, `fps`, `ratio` or `count`.              |
| `scope`        | `desktop`, `tablet`, `phone`, or `all`.                |
| `max` / `min`  | Bound. At least one is required; both may be given.    |
| `enforcedFrom` | Phase from which a missing measurement is a failure.   |
| `source`       | Where the number came from.                            |

The checker classifies each rule as **passed**, **violated**, **unmeasured** or
**deferred**.

**Unmeasured is a failure.** A rule enforced in the current phase with no
reported measurement fails the gate. So does a measurement whose value is not
finite, and so does a reported id that matches no rule. This is deliberate: the
failure mode a budget system must not have is reporting green for something
nobody measured. See ADR-0006.

## Running the gate

```
pnpm audit:clean     # discard measurements from earlier runs
pnpm build           # produce the artifacts the bundle harness measures
pnpm audit:bundle    # records editor.bundle.gzip
pnpm test:e2e        # records the cold-load measurements
pnpm audit:budgets   # merges everything and checks against budgets.json
```

`pnpm sweep` runs exactly that chain in that order, and it begins with
`audit:clean` deliberately. Measurement files persist on disk, so without the
clean step a value produced by an earlier run — possibly at a different commit —
can satisfy the gate for a run that never measured it. Each report row prints
the measurement's origin and the time it was recorded, so a stale value is
visible rather than merely possible.

Harnesses record measurements with `recordMeasurements()` from
`tests/e2e/budget.ts`, or with `writeMeasurements()` directly. Each harness
writes its own file, so parallel Playwright workers never race. Later files win
for the same id, letting a targeted re-run supersede an earlier value.

## How cold load is measured

Cold load is the later of the app's own readiness mark and the browser's first
contentful paint, taken as the **worst** of three navigations on fresh pages
after one warm-up navigation.

Each of those choices exists to close a specific hole:

- **The later of two signals**, because the app's readiness mark is
  self-reported and fires before paint. Anchoring partly on a browser-attested
  metric means the number cannot be improved simply by moving the mark earlier.
- **Fresh pages, not `location.reload()`**, because a reload keeps the renderer
  process, its code cache and its connection alive, which is not the condition
  the budget is stated against.
- **The worst of three, not the median.** A median suppresses the tail rather
  than exposing it — samples of 20/20/3000 ms report 20 — which is the wrong
  direction for a gate whose job is catching regressions. A single sample is
  noise; a median is forgiving; the maximum is the conservative reduction.
- **Throttling proven on each sampled page, in raw samples.** Every page is
  opened through a fixture that applies the profile's CPU throttling and then
  probes it on that page. CDP throttling is per-page, and an earlier version of
  this harness throttled only the fixture page while the spec measured pages it
  opened itself, so every device-named budget was measured at full desktop
  speed. See RC-0006.

### How the slowdown is estimated, and by whom

The harness reports **observations**; the budget gate computes the **estimate**.
It has to be that way round — a self-reported ratio is the producer attesting
its own work, and a harness that stopped throttling but kept writing `4.7` would
have been undetectable.

Each probe records the workload's identity, its iteration count, the value it
folded to, and two arrays of raw durations:

| Field                    | What it is                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `benchmarkId`            | Which workload ran. A probe from another one is refused.                                  |
| `iterations`, `checksum` | Recomputed by the gate, so a probe cannot claim a workload whose answer it does not know. |
| `controlMs`              | Durations with throttling **off**, same page, same run.                                   |
| `throttledMs`            | Durations with it **on**, paired index-for-index.                                         |

**Three paired samples, fixed.** Control and throttled runs alternate, so
contention lasting longer than one pair divides out rather than biasing the
ratio. The count is fixed rather than a loop that resamples until the number is
acceptable — sampling to a threshold is a way of manufacturing a passing result.

**Median of the pairs within a probe, median across probes.** Two other
reductions were considered and rejected. A minimum-over-minimum estimates each
side's uncontended speed but means every extra sample can only lower the result,
so one slow control draw is unrecoverable — it read 1.96x on a genuinely
4x-throttled host. A maximum-over-minimum is not an estimate at all; it is the
largest ratio the data can be made to yield, and review disproved the argument
that every influence on this quantity depresses it (an unthrottled page measured
1.31x, not the 1.0x that argument assumed).

**Two checks a scalar could not support.** The gate recomputes the checksum, so
a probe must know what the workload folds to; and it rejects a control faster
than `1e-7` ms per iteration. For the 80-million-iteration probe that floor is
**8ms** against a real control of about 100ms — a factor of **12.5**, and it
describes a 10GHz core retiring the whole dependent chain every cycle.

The arithmetic here previously read "half a millisecond" and "two orders of
magnitude", both wrong: `1e-7 ms × 80,000,000` is 8ms, so the margin was
overstated 16x. It also constrains only the control, and only from below, which
is not the direction a fabricated ratio would be pushed — inflating the
throttled side is unconstrained by it. It is a sanity check on one number.

**What this still cannot do**, stated so it is not mistaken for more: a harness
that computes plausible timings without running anything will pass. Nothing in a
file can attest itself. What changed is the failure that actually happened —
throttling silently lost — which now shows a control and a throttled sample at
the same speed and a derived ratio of 1.0, whatever anyone wrote down.

## CPU throttling, and how the rates were chosen

The tablet and phone profiles run under CDP CPU throttling. Without it they
differed from desktop only in viewport, device pixel ratio and touch emulation,
so a budget named for a phone measured a developer workstation. The evidence was
unmissable: the phone profile routinely measured **faster** than the desktop
profile, because it was the same machine.

`Emulation.setCPUThrottlingRate` takes a _requested_ multiplier, not a
guaranteed one — what it achieves depends on the host CPU, the scheduler and the
workload. So the rates are measured, not assumed.

**Calibration method.** `pnpm calibrate:cpu` runs a fixed arithmetic workload
(80 million iterations of an integer LCG fold) in a real browser page at each
requested rate, taking the median of five samples after two warmup runs, and
reports the slowdown each rate actually produced. The workload is deliberate:

- **Deterministic**, so the result can be asserted. A JIT that elides the loop,
  or a throttling implementation that skips work rather than slowing it, changes
  the answer and throws instead of returning an impressively fast number.
- **Integer only**, so it is identical across platforms and engines.
- **CPU bound**, with no allocation, DOM or I/O, so throttling is the only thing
  that moves the wall time.

Measured on the reference host:

| requested | median ms | achieved |
| --------- | --------- | -------- |
| 1         | 102.7     | 1.00x    |
| 2         | 218.2     | 2.12x    |
| 3         | 328.0     | 3.19x    |
| 4         | 443.8     | 4.32x    |
| 5         | 548.9     | 5.34x    |
| 6         | 663.7     | 6.46x    |
| 8         | 853.8     | 8.31x    |

**Chosen rates:** tablet 4 (measured 4.1x-4.8x), phone 6 (measured 6.5x-6.8x).
These are the DevTools mid-tier and low-tier mobile presets, now with measured
rather than assumed slowdowns behind them.

**Absolute slowdowns are host-dependent** and will differ on a CI runner. What
is host-independent — and therefore what the harness asserts on every run — is
the _ordering_. `pnpm audit:profile-ordering` requires the tablet to take at
least 2.0x the desktop time and the phone at least 1.15x the tablet time, cut
well below the measured 4.3x and 1.4x so a slow runner cannot produce a false
failure, and far above 1.0 so removing throttling cannot produce a false pass.

That check is the mutation test for the throttling itself. With throttling
removed, every ratio collapses to exactly 1.00x and the check exits non-zero.
This was verified by doing it.

**Cross-host evidence.** The thresholds were derived on the development host,
so the open question was whether they survive different hardware. GitHub
Actions run 33198049464 passed the profile-ordering step on its own runners,
inside the pinned Playwright container — different CPU, different scheduler,
different contention. That is one data point, not a guarantee, and a runner
class slow enough to compress the ratios would surface as a failure here rather
than as a silently weakened gate, which is the correct direction to fail in.

## Budgets that carry no device signal

One budget still runs unthrottled: the desktop profile. On a CI runner it
measures the runner. Its id is therefore `ci-headless.editor.coldLoad`, not
`editor.coldLoad.desktop`, and its description says so. A test asserts that no
budget is named after an unthrottled profile, so the naming cannot quietly
regress. The real desktop claim lives in the DEVICE-VERIFIED register as DV-004,
unverified. See ADR-0011.

## What throttling still does not fix

GAP-006 is narrowed, not closed. Still true: the server is loopback, so there is
no DNS, TLS or real-network latency; the measurement anchors on first contentful
paint, so work deferred past it is uncounted; and throttled emulation on a
workstation is not a phone. A green phone cold-load row means the editor loads
quickly under a 6x CPU handicap on a developer machine. It does not mean the
editor loads in time on a phone.

## Provenance

Most numbers come straight from the project brief, section 4, and are marked
`source: brief-4-performance`. Two are ours and are marked `source: adr-0006`:
the phone cold-load ceiling and the editor bundle ceiling. ADR-0006 explains
both.

## Turning budgets on

Bumping `currentPhase` in `budgets.json` activates every rule whose
`enforcedFrom` has been reached. Those rules will then fail until a harness
reports them. That is the intended friction: the phase bump and the measurement
work belong to the same piece of work.

## Not covered by any budget

GPU and texture memory are tracked by instrumenting the asset loader
(`gpu.texture.phone`), because JavaScript cannot observe GPU allocations. Until
that instrumentation exists in P6, the rule is deferred rather than assumed.
