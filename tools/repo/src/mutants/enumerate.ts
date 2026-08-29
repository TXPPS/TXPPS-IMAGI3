import ts from 'typescript';

/**
 * Mutants derived from the code, not from judgement.
 *
 * The hand-picked list in `mutations.ts` found two real holes and is worth
 * keeping. It is also, structurally, a list of things someone thought to
 * doubt — and the two holes the first sweep found were in packages that three
 * reviewers had independently called well-guarded after choosing 22 mutations
 * of their own. **Enumeration coverage is the gap, not mutation quality.**
 *
 * So the floor is mechanical: every exported function gets the standard
 * neutering set, and every `sort`, `filter` and predicate in the file gets its
 * own. Nobody decides what is worth doubting. A new export enters the
 * enumeration by existing, which is what makes the ratchet in `baseline.ts`
 * able to fail a commit that adds unguarded code.
 *
 * **Mutants need not typecheck.** The sweep runs Vitest, which transpiles
 * through esbuild and does not typecheck, so an empty body on a function
 * declaring a return type still runs and returns `undefined` — a real
 * behavioural mutation. Requiring type-correct mutants would mean generating a
 * type-appropriate constant for every return, and the mutants that survive
 * that constraint are the uninteresting ones. This is load-bearing: were the
 * sweep to run `tsc`, every mutant would be trivially "killed" by a compile
 * error and the whole exercise would prove nothing.
 */

/** Longest receiver or callee text kept in a mutant's human-readable target. */
const TARGET_CHARS = 40;

export const MUTANT_KINDS = [
  'empty-body',
  'identity-return',
  'constant-return',
  'dropped-argument',
  'inverted-predicate',
  'removed-sort',
  'removed-filter',
] as const;

export type MutantKind = (typeof MUTANT_KINDS)[number];

export interface GeneratedMutant {
  readonly id: string;
  readonly file: string;
  readonly kind: MutantKind;
  /** The exported name, or the enclosing construct, this mutant targets. */
  readonly target: string;
  /** Byte offsets into the source, so replacement needs no re-parsing. */
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

interface FunctionLike {
  readonly name: string;
  readonly body: ts.Block;
  readonly parameters: readonly ts.ParameterDeclaration[];
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/**
 * Exported functions, including `export const f = () => {…}`.
 *
 * Only block bodies. A concise arrow body (`=> expr`) has no statements to
 * empty, and rewriting it would mean synthesising an expression of the right
 * shape — which is the type-correctness problem this module avoids.
 */
function declaredFunction(statement: ts.Statement): FunctionLike | undefined {
  if (!ts.isFunctionDeclaration(statement) || !isExported(statement)) return undefined;
  if (statement.body === undefined || statement.name === undefined) return undefined;
  return {
    name: statement.name.text,
    body: statement.body,
    parameters: statement.parameters,
  };
}

function assignedFunction(declaration: ts.VariableDeclaration): FunctionLike | undefined {
  const initialiser = declaration.initializer;
  if (initialiser === undefined) return undefined;
  if (!ts.isArrowFunction(initialiser) && !ts.isFunctionExpression(initialiser)) return undefined;
  if (!ts.isBlock(initialiser.body) || !ts.isIdentifier(declaration.name)) return undefined;
  return {
    name: declaration.name.text,
    body: initialiser.body,
    parameters: initialiser.parameters,
  };
}

function exportedFunctions(source: ts.SourceFile): FunctionLike[] {
  const found: FunctionLike[] = [];
  for (const statement of source.statements) {
    const declared = declaredFunction(statement);
    if (declared !== undefined) {
      found.push(declared);
      continue;
    }
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const assigned = assignedFunction(declaration);
      if (assigned !== undefined) found.push(assigned);
    }
  }
  return found;
}

function firstParameterName(parameters: readonly ts.ParameterDeclaration[]): string | undefined {
  const first = parameters[0];
  if (first === undefined || !ts.isIdentifier(first.name)) return undefined;
  return first.name.text;
}

function functionMutants(file: string, fn: FunctionLike): GeneratedMutant[] {
  const at = { start: fn.body.getStart(), end: fn.body.getEnd() };
  const mutants: GeneratedMutant[] = [
    {
      id: `${file}::${fn.name}::empty-body`,
      file,
      kind: 'empty-body',
      target: fn.name,
      ...at,
      replacement: '{ /* mutant */ }',
    },
    {
      id: `${file}::${fn.name}::constant-return`,
      file,
      kind: 'constant-return',
      target: fn.name,
      ...at,
      replacement: '{ return 0 as never; }',
    },
  ];

  const parameter = firstParameterName(fn.parameters);
  if (parameter !== undefined) {
    mutants.push({
      id: `${file}::${fn.name}::identity-return`,
      file,
      kind: 'identity-return',
      target: fn.name,
      ...at,
      replacement: `{ return ${parameter} as never; }`,
    });
  }
  return mutants;
}

/** Expression-level mutants: predicates, sorts, filters, and call arguments. */
function expressionMutants(file: string, source: ts.SourceFile): GeneratedMutant[] {
  const mutants: GeneratedMutant[] = [];
  let index = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const condition = node.expression;
      mutants.push({
        id: `${file}::if${String(index)}::inverted-predicate`,
        file,
        kind: 'inverted-predicate',
        target: `if at ${String(condition.getStart())}`,
        start: condition.getStart(),
        end: condition.getEnd(),
        replacement: `!(${condition.getText()})`,
      });
      index += 1;
    }

    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression;
        if (method === 'sort' || method === 'filter') {
          mutants.push({
            id: `${file}::${method}${String(index)}::removed-${method}`,
            file,
            kind: method === 'sort' ? 'removed-sort' : 'removed-filter',
            target: `${receiver.getText().slice(0, TARGET_CHARS)}.${method}`,
            start: node.getStart(),
            end: node.getEnd(),
            replacement: receiver.getText(),
          });
          index += 1;
        }
      }

      // Dropping the last argument, for any call — a plain `g(a, b)` as much as
      // a method. Restricting this to property accesses was a bug: it silently
      // exempted every standalone function call in the codebase from the kind,
      // which is precisely the enumeration gap this module exists to close.
      //
      // Single-argument calls are skipped: removing the only argument usually
      // changes arity in a way that throws at once, which is a kill that says
      // nothing about whether the argument's *value* was guarded.
      if (node.arguments.length > 1) {
        const last = node.arguments[node.arguments.length - 1];
        const previous = node.arguments[node.arguments.length - 2];
        if (last !== undefined && previous !== undefined) {
          mutants.push({
            id: `${file}::call${String(index)}::dropped-argument`,
            file,
            kind: 'dropped-argument',
            target: `${node.expression.getText().slice(0, TARGET_CHARS)}()`,
            start: previous.getEnd(),
            end: last.getEnd(),
            replacement: '',
          });
          index += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return mutants;
}

/**
 * Every mechanical mutant for one file.
 *
 * Mutants are returned in descending offset order so a caller applying several
 * to one file does not invalidate later offsets — though the sweep applies one
 * at a time, which is what makes a survivor attributable to a single change.
 */
export function enumerateMutants(file: string, contents: string): GeneratedMutant[] {
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.ES2023, true);
  const mutants = [
    ...exportedFunctions(source).flatMap((fn) => functionMutants(file, fn)),
    ...expressionMutants(file, source),
  ];
  return mutants.sort((a, b) => b.start - a.start);
}

/** Apply one mutant to source text. */
export function applyMutant(contents: string, mutant: GeneratedMutant): string {
  return contents.slice(0, mutant.start) + mutant.replacement + contents.slice(mutant.end);
}

/**
 * Where an in-flight mutation records the file it is about to overwrite.
 *
 * A `finally` restores the file on a thrown error and on a normal exit. It does
 * **not** run on `SIGKILL`, which cannot be intercepted by any process — and
 * this tool's own documentation claimed every mutation was reverted "including
 * on crash" until a killed run left a mutated `parity.ts` in the working tree.
 * The claim was false in exactly the way `verify:assertions` exists to catch,
 * in the file that implements mutation testing.
 *
 * So the guarantee is made recoverable rather than absolute: the original bytes
 * are written here before the file is touched, and the next run restores from
 * this marker before doing anything else. A killed run costs one restore, not a
 * silently sabotaged tree.
 */
export const INFLIGHT_MARKER = '.mutants-inflight.json';

export interface InflightRecord {
  readonly file: string;
  readonly original: string;
  readonly mutantId: string;
}
