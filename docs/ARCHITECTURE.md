# ARCHITECTURE

Current as of P0. Sections marked _(planned)_ describe committed direction, not
existing code — do not treat them as implemented.

## Shape of the system

IMAGI3 is one web codebase producing two consumers of a single runtime: the
editor's play mode, and the exported standalone build. Any behavioural
divergence between those two is a P0 bug by definition, so the runtime must
never know which one is hosting it.

```
                    ┌────────────────────────────┐
                    │        scene data          │
                    │  ECS, data-only, JSON      │  (planned, P1)
                    └─────────────┬──────────────┘
                                  │ loaded identically by both
                ┌─────────────────┴─────────────────┐
                │                                   │
        ┌───────▼────────┐                 ┌────────▼────────┐
        │ editor play    │                 │ exported build  │
        │ mode (P3)      │                 │ (P8)            │
        └───────┬────────┘                 └────────┬────────┘
                └─────────────────┬─────────────────┘
                                  │
                      ┌───────────▼────────────┐
                      │      ONE runtime       │  (planned, P1)
                      │ tick loop, systems,    │
                      │ asset resolution       │
                      └───────────┬────────────┘
                      ┌───────────▼────────────┐
                      │   renderer (P1)        │
                      │ WebGL2 primary,        │
                      │ WebGPU opportunistic   │
                      └────────────────────────┘
```

## What exists today (P0)

```
apps/editor/          Vite PWA shell. Renders a static shell, publishes a
                      readiness signal, and nothing else. This is the "empty
                      app" the P0 gate is defined against.
tools/audit/          The audit harness, as a real package with its own tests.
tests/e2e/            Playwright, one project per device profile.
```

### The readiness contract

The app publishes two signals when the shell is interactive: the
`data-app-ready="true"` attribute on `<html>`, and a `imagi3:ready` performance
mark. Everything downstream synchronises on these — E2E waits on the attribute,
and the cold-load budget is derived from the mark's `startTime`, which is
relative to navigation start.

Keeping both signals is deliberate: an attribute is what a test can wait for,
and a performance mark is what a measurement can be derived from without
round-tripping through the test runner's clock.

### The audit harness

`tools/audit` is a package, not a folder of test helpers. It has a public API,
unit tests, and a self-test that proves each detector distinguishes clean input
from planted defects. Detectors:

| Module            | Detects                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `budgets/`        | Measurements outside declared bounds, and budgets nobody measured. |
| `console/`        | Console errors, uncaught exceptions, unhandled rejections.         |
| `image/`          | Perceptual screenshot difference: YIQ pixel delta plus mean SSIM.  |
| `measurements.ts` | Collection and merge of harness-reported values.                   |

`profiles.ts` is the single definition of the three device profiles. The
Playwright project matrix, the budget `scope` field and the screenshot baseline
directory layout all derive from it, so they cannot drift apart.

## Constraints that shape everything downstream

These come from the brief and are not negotiable by later phases:

- **WebGL2 is the primary renderer path.** Every visual feature must work
  there. WebGPU is an opportunistic upgrade, never a requirement.
- **Scene data is data-only.** No behaviour in scene data, ever. Scripts attach
  by reference and execute in a sandbox.
- **Local storage is a cache; cloud is the source of truth.** iOS Safari evicts
  OPFS on idle non-installed sites, so a local-only design would lose data.
- **Assets are content-addressed and immutable** (`assets/<sha256>.<ext>` plus
  an `asset-index.json` mapping name to hash). Only `scenes/` and
  `asset-index.json` ever merge; binary assets never do.
- **iPhone is the capability floor and is deliberately capped** to inspector
  edits, script edits, playtest and review. No 3D scene composition.
- **User scripts never evaluate into editor context.** ES modules in a
  sandboxed iframe or Worker; a malformed script must not be able to kill the
  editor.

## Planned package layout

Created as their phases arrive, so that no package exists before it has a job:

| Package              | Phase | Responsibility                                    |
| -------------------- | ----- | ------------------------------------------------- |
| `packages/core`      | P1    | ECS, scene schema, canonical serializer.          |
| `packages/runtime`   | P1    | Tick loop, systems, asset resolution.             |
| `packages/render`    | P1    | three.js layer, WebGL2/WebGPU parity, LOD.        |
| `packages/storage`   | P2    | OPFS content-addressed store, IndexedDB metadata. |
| `packages/sync`      | P4    | Yjs documents, offline queue, reconnect merge.    |
| `packages/scripting` | P7    | Sandboxed module loading, script API.             |
| `packages/gameplay`  | P7.5  | Physics, audio, animation, tilemap.               |
| `packages/export`    | P8    | Deterministic standalone build.                   |

## Toolchain notes that affect how you write code

`tsc` runs as a typechecker only, with `erasableSyntaxOnly` on. Every source
file therefore runs unmodified under `node --experimental-strip-types`, and
imports must carry explicit `.ts` extensions. No enums, parameter properties or
namespaces. ADR-0003 has the reasoning.
