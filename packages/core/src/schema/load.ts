import { parseCanonical } from '../canonical.ts';
import { repairSceneGraph, type SceneRepair } from '../graph.ts';
import { migrateToCurrent } from './migrate.ts';
import { validateSceneDocument } from './validate.ts';

/**
 * The one way a document enters the engine.
 *
 * Migrate, then validate the shape, then repair the graph — in that order,
 * because each stage assumes the previous one. It exists as a single function
 * rather than three calls at each call site so that no caller can accidentally
 * skip the repair and then work with a document that is not a tree. That is not
 * a hypothetical concern: validation *looks* like the boundary, and everything
 * after it looks safe, but validation deliberately admits cycles and dangling
 * parents because rejecting them would lose a peer's work.
 *
 * Never throws for a graph fault. It throws for a document it cannot read —
 * malformed JSON, a version from the future, a field of the wrong type — and
 * repairs everything else, reporting what it did.
 */
export function loadSceneDocument(raw: unknown): SceneRepair {
  return repairSceneGraph(validateSceneDocument(migrateToCurrent(raw)));
}

/** {@link loadSceneDocument} from canonical JSON text. */
export function parseSceneDocument(text: string): SceneRepair {
  return loadSceneDocument(parseCanonical(text));
}
