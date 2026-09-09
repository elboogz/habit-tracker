import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

// Phase 5, Step 3 generator-fix follow-up (docs/phase-5-plan.md section 10). extractDeclarations
// is a line-by-line brace/paren-balance heuristic, not a parser -- Authorisation 1 fixed the one
// known way it could misread real source (an inline object-type parameter, or an unbalanced paren
// inside a doc comment), but it still does not understand every lexical construct: a brace, paren,
// or comment-like sequence inside a string, template, or regex literal is not specially handled.
// This test is the control for that class. It does not evolve the extractor into a parser; it
// independently re-derives each SOURCES declaration's true span from the TypeScript Compiler API
// (already a project dependency) and fails loudly if the heuristic's output ever stops matching
// that ground truth -- including for a declaration added to SOURCES in the future.
//
// What this proves, precisely, and what it does not (recorded here and in docs/phase-5-plan.md
// section 10, so neither place implies more than the other supports):
//   - PROVEN: the extraction ends at the AST-correct declaration boundary and its content from
//     that boundary backward is byte-correct. This catches outright truncation (the shipped
//     meetsRateWindow bug) and end-boundary over-extension into a following declaration (the
//     HABIT_HEALTH_CONFIG shape found while designing the fix, which never shipped) -- both change
//     what the extracted text ends with, which this assertion inspects directly.
//   - NOT PROVEN: that extraction begins at the earliest correct boundary. A hypothetical bug that
//     starts too early (swallowing trailing material from the *preceding* declaration) while still
//     ending at exactly the right place would satisfy this assertion undetected. `getFullStart()`
//     was evaluated as a route to exact byte equality, which would close this gap; it aligns with
//     extractDeclarations' own leading-comment capture for every non-first-in-file declaration, but
//     for a file's first top-level statement it has no preceding statement to bound it and reaches
//     back to include that file's own module-header comment instead -- confirmed against `dayKey`,
//     the one production SOURCES symbol this applies to. Closing that would mean reconstructing the
//     extractor's own contiguous-comment-line back-scan a second time as reconciliation logic, which
//     is not built here. The residual is accepted and named rather than hidden: this test does not
//     substitute for the manual Gate A / Gate B byte-equivalence comparison (start-to-end, against a
//     known-good baseline) that remains the required check whenever SOURCES or the extractor itself
//     is materially extended.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractDeclarations, SOURCES } = require('./build-edge-functions.js') as {
  extractDeclarations: (source: string, names: string[]) => string;
  SOURCES: { file: string; names: string[] }[];
};

const DOMAIN_DIR = path.resolve(__dirname, '..', 'lib', 'domain');

/**
 * The true source span of every top-level `function`/`type`/`const` declaration in `source`,
 * keyed by name -- the same three declaration kinds extractDeclarations targets. `getStart(sf)`
 * (no second argument) deliberately excludes leading trivia/JSDoc, unlike extractDeclarations'
 * own output, which intentionally includes a declaration's leading comment block -- see
 * `groundTruthTail` below for how the comparison accounts for that difference.
 */
function groundTruthDeclarations(source: string, fileName: string): Map<string, string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const result = new Map<string, string>();
  for (const stmt of sf.statements) {
    let name: string | null = null;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) name = stmt.name.text;
    else if (ts.isTypeAliasDeclaration(stmt)) name = stmt.name.text;
    else if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
      const d = stmt.declarationList.declarations[0];
      if (ts.isIdentifier(d.name)) name = d.name.text;
    }
    if (name) result.set(name, source.slice(stmt.getStart(sf), stmt.getEnd()));
  }
  return result;
}

/**
 * The AST span, normalised the same way extractDeclarations normalises its own output (dropping a
 * leading `export`). extractDeclarations' output additionally carries the declaration's leading
 * comment block, which `getStart(sf)` excludes by design -- so the correct check is that the
 * extractor's output ENDS WITH the true code span, not that the two are equal outright.
 */
function groundTruthTail(source: string, fileName: string, name: string): string {
  const code = groundTruthDeclarations(source, fileName).get(name);
  if (code === undefined) {
    throw new Error(`AST ground truth found no top-level function/type/const declaration named '${name}' in ${fileName}`);
  }
  return code.replace(/^export (function|type|const)\b/, '$1').trim();
}

/** True if extractDeclarations' output for `name` is provably the complete, correct declaration. */
function matchesGroundTruth(extractFn: typeof extractDeclarations, source: string, fileName: string, name: string): boolean {
  const extracted = extractFn(source, [name]).trim();
  return extracted.endsWith(groundTruthTail(source, fileName, name));
}

describe('extractDeclarations vs. TypeScript AST ground truth', () => {
  const cases = SOURCES.flatMap(({ file, names }) => names.map((name) => ({ file, name })));

  it.each(cases)('extracts $name from $file completely and correctly', ({ file, name }) => {
    const source = fs.readFileSync(path.join(DOMAIN_DIR, file), 'utf8');
    expect(matchesGroundTruth(extractDeclarations, source, file, name)).toBe(true);
  });

  // Discrimination check: proves this comparison actually detects the failure class it exists
  // for, rather than merely passing alongside the current, already-fixed implementation. Reuses
  // the exact heuristic that shipped before Authorisation 1 -- brace-depth only, no paren-depth,
  // no comment-awareness -- defined here as a self-contained, in-memory function. It is never
  // imported from and never written to scripts/build-edge-functions.js; this is a scratch-style
  // perturbation confined to the test file, run only against a synthetic snippet, so it cannot
  // affect the real generator or any other test.
  function extractDeclarationsPreFix(source: string, names: string[]): string {
    const nameSet = new Set(names);
    const lines = source.split('\n');
    const found = new Set<string>();
    const chunks: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const match = lines[i].match(/^(?:export )?(function|type|const)\s+([A-Za-z0-9_]+)/);
      if (match && nameSet.has(match[2])) {
        found.add(match[2]);
        let start = i;
        while (start > 0 && /^\s*(\/\*\*|\*\/|\*|\/\/)/.test(lines[start - 1])) start -= 1;
        let depth = 0;
        let seenOpen = false;
        let end = i;
        for (; end < lines.length; end += 1) {
          for (const ch of lines[end]) {
            if (ch === '{') {
              depth += 1;
              seenOpen = true;
            } else if (ch === '}') {
              depth -= 1;
            }
          }
          if (seenOpen && depth === 0) break;
          if (!seenOpen && /;\s*$/.test(lines[end])) break;
        }
        chunks.push(lines.slice(start, end + 1).join('\n'));
        i = end + 1;
      } else {
        i += 1;
      }
    }
    if (names.some((n) => !found.has(n))) throw new Error('declaration not found');
    return chunks.join('\n\n').replace(/^export (function|type|const)\b/gm, '$1');
  }

  it('fails on a declaration shape the pre-Authorisation-1 heuristic misreads, proving the check has teeth', () => {
    // The exact shape that defeated the real generator before Authorisation 1: a parameter list
    // containing an inline object-type annotation, which self-balances braces to zero before the
    // function body opens.
    const snippet = [
      'function probe(',
      '  a: number,',
      '  cfg: { window: number; rate: number },',
      '  b: string,',
      '): boolean {',
      '  return a > 0 && b.length > 0;',
      '}',
    ].join('\n');

    expect(matchesGroundTruth(extractDeclarationsPreFix, snippet, 'probe.ts', 'probe')).toBe(false);
    // The fixed, real extractor handles the identical snippet correctly -- confirms the failure
    // above is specific to the reintroduced old heuristic, not to the snippet or the comparison.
    expect(matchesGroundTruth(extractDeclarations, snippet, 'probe.ts', 'probe')).toBe(true);
  });
});
