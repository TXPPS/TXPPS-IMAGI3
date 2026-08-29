/**
 * Which modules belong in the runtime chunk.
 *
 * Split out of `vite.config.ts` so it can be tested. The predicate there was
 * three inline `id.includes(…)` calls, and **`packages/core/` was not one of
 * them** — so the whole scene schema, the canonical serialiser, the fractional
 * index and the graph repair were bundled into the editor's entry chunk while
 * `runtime.bundle.gzip` measured the renderer alone. QA Automation found it at
 * the P1 gate. Nothing could have caught it: the check on the other side asks
 * what share of the build the runtime chunk is, and three.js is 97% of that
 * chunk whether or not any first-party code joins it.
 *
 * A list nobody can forget to extend is the fix. `ENGINE_PACKAGES` is checked
 * against the workspace's actual `packages/` directory by
 * `apps/editor/test/chunks.test.ts`, so adding a package fails the build until
 * someone decides which side of the split it belongs on. Deciding is the point;
 * defaulting silently is what happened.
 */

/**
 * Prefix given to every chunk containing the runtime and the renderer.
 *
 * The name exists so `runtime.bundle.gzip` can be measured as its own budget
 * rather than folded into the editor's. Two things follow and both are
 * deliberate: the runtime is not in the entry chunk, so the editor shell's
 * cold-load budget is not paying for three.js on every device profile; and the
 * budget is attributable, so a renderer that doubles in size is visible as the
 * renderer growing rather than as the editor growing.
 *
 * Removing this split does not quietly merge the budgets — it leaves
 * `runtime.bundle.gzip` with no measurement, and an enforced budget nobody
 * measured is a gate failure. See ADR-0006.
 */
export const RUNTIME_CHUNK = 'imagi3-runtime';

/**
 * Workspace packages that are the engine, and belong in the runtime chunk.
 *
 * Every directory under `packages/`. The editor is an app and is not here; if a
 * package is ever added that genuinely belongs in the entry chunk, it goes in
 * {@link EDITOR_PACKAGES} with a reason, and the test that compares both lists
 * against the directory keeps the decision explicit.
 */
export const ENGINE_PACKAGES: readonly string[] = ['core', 'runtime', 'render'];

/**
 * Workspace packages deliberately left in the editor's entry chunk.
 *
 * Empty today. An entry here is a claim that the package is shell code the
 * editor needs before it can show anything, which is the only reason to pay for
 * it in the cold-load budget.
 */
export const EDITOR_PACKAGES: Readonly<Record<string, string>> = {};

/** Third-party modules that are part of the engine's cost, not the shell's. */
export const ENGINE_VENDOR: readonly string[] = ['three'];

/** The chunk a module id belongs to, or undefined to let Rollup decide. */
export function chunkFor(id: string): string | undefined {
  const inEngine =
    ENGINE_PACKAGES.some((name) => id.includes(`/packages/${name}/`)) ||
    ENGINE_VENDOR.some((name) => id.includes(`/node_modules/${name}/`));
  return inEngine ? RUNTIME_CHUNK : undefined;
}
