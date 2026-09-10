import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Freshness/verification test for the generated-domain block inside both Deno Edge Functions
// (docs/phase-2-implementation-plan.md section 2 and 7). Fails if either the shared domain
// source (lib/domain/day-key.ts, lib/domain/habit-stats.ts) was changed without regenerating the
// Edge Functions, or if the generated block was hand-edited directly -- both are drift from the
// single source of truth. There's no CI in this project, so this is a locally-runnable safeguard
// (part of `npm test`) rather than an enforced gate.

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts'),
  path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts'),
];

describe('generated Edge Function domain blocks', () => {
  it('are up to date with lib/domain/ -- run `npm run build:edge-functions` if this fails', () => {
    const before = TARGETS.map((file) => fs.readFileSync(file, 'utf8'));

    execFileSync('node', [path.join(ROOT, 'scripts', 'build-edge-functions.js')], { cwd: ROOT });

    const after = TARGETS.map((file) => fs.readFileSync(file, 'utf8'));

    try {
      TARGETS.forEach((file, index) => {
        expect(after[index]).toBe(before[index]);
      });
    } finally {
      // Restore exactly what was on disk before this test ran, regardless of outcome -- this
      // test verifies freshness, it does not intend to be the thing that regenerates the files.
      TARGETS.forEach((file, index) => fs.writeFileSync(file, before[index]));
    }
  });
});

// The generator is a plain CommonJS Node script (scripts/build-edge-functions.js), not part of
// the TS project, so it's required rather than imported.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  assertNoDisallowedDependencies,
  extractDeclarations,
  fingerprint,
  blankStampLine,
  STAMP_LINE_RE,
} = require('./build-edge-functions.js');

describe('import-safety guard', () => {
  it('rejects a disallowed dependency in the shared domain layer', () => {
    expect(() => assertNoDisallowedDependencies("import { x } from 'expo-crypto';\n", 'fake.ts')).toThrow(/disallowed/);
    expect(() => assertNoDisallowedDependencies("import { View } from 'react-native';\n", 'fake.ts')).toThrow(/disallowed/);
    expect(() => assertNoDisallowedDependencies("import { createClient } from '@supabase/supabase-js';\n", 'fake.ts')).toThrow(/disallowed/);
    expect(() => assertNoDisallowedDependencies('const x = Deno.env.get("Y");\n', 'fake.ts')).toThrow(/disallowed/);
  });

  it('allows a dependency-free source file', () => {
    expect(() => assertNoDisallowedDependencies("import type { Habit } from '../habit-types';\nexport function f() {}\n", 'fake.ts')).not.toThrow();
  });
});

// Deployment stamp (docs/phase-5-precondition-review.md, B6). The freshness test above compares the
// repository against itself and structurally cannot see the Supabase Dashboard; these assertions
// guard the stamp that makes the deployed revision observable instead.
describe('deployment stamp', () => {
  function readStamp(file: string) {
    const source = fs.readFileSync(file, 'utf8');
    const line = source.match(STAMP_LINE_RE)?.[0] ?? '';
    return {
      source,
      block: line.match(/block: '([0-9a-f]+)'/)?.[1],
      file: line.match(/file: '([0-9a-f]+)'/)?.[1],
    };
  }

  it('carries the same block fingerprint in both functions -- this is what answers "same generated revision?"', () => {
    const [a, b] = TARGETS.map(readStamp);
    expect(a.block).toMatch(/^[0-9a-f]{12}$/);
    expect(a.block).toBe(b.block);
  });

  it('carries a per-file fingerprint that matches a freshly computed one -- catches a hand-edited stamp', () => {
    for (const target of TARGETS) {
      const { source, file } = readStamp(target);
      expect(file).toMatch(/^[0-9a-f]{12}$/);
      expect(file).toBe(fingerprint(blankStampLine(source, target)));
    }
  });

  it('has distinct file fingerprints, since each covers its whole file rather than the shared block', () => {
    const [a, b] = TARGETS.map(readStamp);
    expect(a.file).not.toBe(b.file);
  });
});

describe('declaration extraction', () => {
  it('pulls out exactly the named declarations, dropping export, in source order', () => {
    const source = [
      '/** doc for a */',
      'export function a(): number {',
      '  return 1;',
      '}',
      '',
      'function b(): number {', // not requested -- must be skipped entirely
      '  return 2;',
      '}',
      '',
      'export type C = { x: number };',
    ].join('\n');

    const result = extractDeclarations(source, ['a', 'C']);
    expect(result).toContain('function a(): number {');
    expect(result).not.toContain('export function a');
    expect(result).not.toContain('function b()');
    expect(result).toContain('type C = { x: number };');
  });

  it('throws if a requested declaration cannot be found', () => {
    expect(() => extractDeclarations('function a() {}\n', ['a', 'missing'])).toThrow(/missing/);
  });
});

// Phase 5, Step 1 (docs/phase-5-plan.md section 3): a strict whole-file type check of each Edge
// Function exactly as it will be pasted into the Supabase Dashboard. Distinct from the freshness
// test above, which only compares the repository against itself and cannot see a type error at
// all. This guard exists because two Phase 5 hazards recorded in docs/phase-5-precondition-review.md's
// B1 are silent today: `tsc` never sees these files (tsconfig.json excludes `supabase/functions`),
// Jest never imports them (Deno `npm:` specifiers, `Deno.serve`, `crypto.randomUUID`), and
// `@ts-nocheck` blocks even an accidental type error from surfacing.
//   - missing-dependency: a whitelisted function references a symbol scripts/build-edge-functions.js
//     did not itself extract into the generated block.
//   - stale-shim: a hand-maintained row/type shim (mirroring lib/habit-types.ts, outside the
//     generator's reach) is missing a field the generated domain code actually uses.
// The whole file is checked, not only the generated block, because Habit/HabitLog/HabitRow/LogRow
// are declared outside the BEGIN/END markers -- a block-only check would hide the stale-shim class
// entirely (docs/phase-5-plan.md section 3 records this as the reason full-file checking is kept).
describe('generated Edge Function type-check guard (Phase 5, Step 1)', () => {
  const TSC_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsc');

  // Minimal, deliberate stand-ins for the two `npm:` imports every Edge Function uses -- narrow
  // enough to cover only what the two call sites actually exercise, not a general SDK shape.
  // `Anthropic` must be a typed stub, not `any`: an `any` stub types `.messages.create(...).content`
  // as `any`, so `.find((block) => ...)` would accept an implicit-any callback parameter without
  // complaint under `--strict` -- an error this guard would then report that does not exist under
  // Deno's own real, typed SDK (see docs/phase-5-verification-report.md, finding D). `createClient`
  // is left as `any` deliberately: nothing in either function destructures a callback from it, so a
  // fuller stub would be speculative rather than load-bearing. These stubs are themselves a
  // maintained shim surface (docs/phase-5-plan.md section 3) and must only ever be widened when a
  // real call site needs it, never to silence an unrelated complaint -- see the recorded residual
  // limitation in that section: nothing here detects the stub drifting from the real SDK's shape.
  const SDK_STUB_PREAMBLE = `
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};
type AnthropicTextBlock = { type: string; text?: string };
declare class Anthropic {
  constructor(options: any);
  messages: { create(params: any): Promise<{ content: AnthropicTextBlock[] }> };
}
declare const createClient: any;
`.trim();

  const NPM_IMPORT_LINE_RE = /^import .+ from ['"]npm:.+['"];?\s*$/gm;

  /**
   * The real Edge Function source, minus its `@ts-nocheck` pragma and its two `npm:` imports, with
   * the stub preamble above prepended in their place. `extraSource`, when given, is appended at the
   * end -- used only by the two demonstration tests below to inject a deliberately-broken reference
   * without ever writing back to the checked-in file.
   */
  function buildCheckableSource(realSource: string, extraSource = ''): string {
    const withoutPragma = realSource.replace('@ts-nocheck', '');
    const withoutNpmImports = withoutPragma.replace(NPM_IMPORT_LINE_RE, '');
    return `${SDK_STUB_PREAMBLE}\n${withoutNpmImports}\n${extraSource}`;
  }

  // Validated in docs/phase-5-verification-report.md, finding D: passing a file directly on the
  // `tsc` command line (the naive approach) makes `tsc` ignore `tsconfig.json` entirely, which
  // rejects `sanitizeContent`'s `/u` regex flag under the resulting default target. `types: []` is
  // load-bearing for the same reason -- without it, `--lib DOM` pulls every ambient `@types/*`
  // package in this repo's `node_modules` (babel, jest, react, undici-types) into a project this
  // file has nothing to do with.
  const CHECK_TSCONFIG = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ESNext',
      lib: ['ESNext', 'DOM'],
      moduleResolution: 'bundler',
      module: 'preserve',
      moduleDetection: 'force',
      skipLibCheck: true,
      types: [] as string[],
    },
  };

  /**
   * Type-checks `source` as a standalone file. Written under the OS temp directory, never under
   * the repository, and removed in a `finally` regardless of outcome, so a failing assertion never
   * leaves an artefact behind and nothing here ever touches the working tree. Returns `tsc`'s
   * combined stdout+stderr; an empty string means a clean pass. Invokes the project's own installed
   * `tsc` binary directly (not `npx tsc`, which resolves nothing useful outside the repository and
   * would otherwise silently fetch an unrelated package of the same name from the registry).
   */
  function typeCheckSource(source: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fn-typecheck-'));
    try {
      const filePath = path.join(dir, 'check.ts');
      const tsconfigPath = path.join(dir, 'tsconfig.json');
      fs.writeFileSync(filePath, source);
      fs.writeFileSync(tsconfigPath, JSON.stringify({ ...CHECK_TSCONFIG, files: ['./check.ts'] }, null, 2));
      try {
        execFileSync(TSC_BIN, ['--noEmit', '-p', tsconfigPath], { cwd: dir, stdio: 'pipe' });
        return '';
      } catch (error) {
        const e = error as { stdout?: Buffer; stderr?: Buffer };
        return `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
      }
    } finally {
      // Cleanup runs whether the check passed, failed, or threw -- no temp directory is ever left
      // behind, including when an assertion below fails the test.
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const EDGE_FUNCTIONS = [
    { name: 'ai-insights', file: TARGETS[0] },
    { name: 'send-coaching-push', file: TARGETS[1] },
  ];

  it.each(EDGE_FUNCTIONS)(
    'passes a strict whole-file type check against the current pre-Phase-5 generated-domain whitelist: $name',
    ({ file }) => {
      const source = fs.readFileSync(file, 'utf8');
      const output = typeCheckSource(buildCheckableSource(source));
      expect(output).toBe('');
    },
  );

  // The two tests below demonstrate the guard actually catches what it exists to catch, rather
  // than merely that the current files happen to compile. Both mutations are constructed in
  // memory from the real file's source and are never written back to the repository or to any
  // path inside it -- there is nothing checked in to revert.

  it('catches a missing-dependency failure: a symbol referenced elsewhere in the file but not present in what the whitelist extracted (the B1 class)', () => {
    const source = fs.readFileSync(TARGETS[0], 'utf8'); // ai-insights
    const CALENDAR_CONSISTENCY_DECLARATION = `function calendarConsistency(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): number {
  const history = recentHistory(habit, logs, days, asOfDate);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}`;
    // Sanity check on the fixture itself: if this ever stops matching, the real function's shape
    // changed and the mutation below would silently do nothing rather than remove a declaration.
    expect(source).toContain(CALENDAR_CONSISTENCY_DECLARATION);

    // Delete the declaration -- still called from the handler below it -- leaving exactly the
    // dangling reference scripts/build-edge-functions.js's extractDeclarations would produce if a
    // future whitelist entry needed a helper it forgot to also name.
    const withoutCalendarConsistency = source.replace(CALENDAR_CONSISTENCY_DECLARATION, '');
    expect(withoutCalendarConsistency).not.toContain('function calendarConsistency(');
    expect(withoutCalendarConsistency).toContain('calendarConsistency('); // the call site remains

    const output = typeCheckSource(buildCheckableSource(withoutCalendarConsistency));
    expect(output).toMatch(/error TS2304: Cannot find name 'calendarConsistency'/);
  });

  it("catches a stale-shim failure: a hand-maintained row/type shim missing a field the generated code uses (the stale-shim class)", () => {
    const source = fs.readFileSync(TARGETS[0], 'utf8'); // ai-insights
    // Since Phase 5 Step 3, `Habit.createdAt` is a real, required field: isScheduledOpportunity/
    // scheduledOpportunitiesUpTo (now in the generated closure) dereference it directly. This test
    // demonstrates the guard would still catch the gap if that shim ever regressed -- a test-only,
    // in-memory mutation that removes `createdAt` from the shim, mirroring how it read before Step
    // 3 widened it. Never written back to the repository; the checked-in file is untouched.
    const CURRENT_HABIT_SHIM = 'type Habit = { id: string; type: string; targetCount?: number; createdAt: string };';
    // Sanity check on the fixture itself: if this ever stops matching, the real shim's shape
    // changed and the mutation below would silently do nothing rather than remove a field.
    expect(source).toContain(CURRENT_HABIT_SHIM);

    const STALE_HABIT_SHIM = 'type Habit = { id: string; type: string; targetCount?: number };';
    const withStaleShim = source.replace(CURRENT_HABIT_SHIM, STALE_HABIT_SHIM);
    expect(withStaleShim).toContain(STALE_HABIT_SHIM);
    expect(withStaleShim).not.toContain(CURRENT_HABIT_SHIM);

    const output = typeCheckSource(buildCheckableSource(withStaleShim));
    expect(output).toMatch(/error TS2339: Property 'createdAt' does not exist on type 'Habit'/);
  });

  // Distinguishes two shim-gap classes the guard covers differently (docs/phase-5-plan.md section
  // 10): existing-converter completeness (above -- toDomainHabit already exists and already
  // constructs a Habit, so an omitted required field is a concrete type error) versus converter
  // existence (below -- nothing here constructs a HabitSchedulePeriod/LapseReasonEntry from a row
  // yet, so there is nothing for the guard to type-check against their total absence).
  it('does not, and cannot, detect a caller-side mapper that was never written (the uncovered class)', () => {
    const source = fs.readFileSync(TARGETS[0], 'utf8'); // ai-insights
    expect(source).toContain('type HabitSchedulePeriod');
    expect(source).toContain('type LapseReasonEntry');
    // No mapper exists yet from HabitSchedulePeriodRow/LapseReasonRow to the domain shapes, and no
    // DB read fetches either table in this file -- both are Step 4 work. Checked as an actual
    // Supabase call, not a bare substring match, since the shim comments above name both tables in
    // prose.
    expect(source).not.toMatch(/\.from\(['"]habit_schedule_periods['"]\)/);
    expect(source).not.toMatch(/\.from\(['"]lapse_reasons['"]\)/);

    const output = typeCheckSource(buildCheckableSource(source));
    expect(output).toBe(''); // clean -- the guard has nothing to flag, which is the point being proven
  });
});
