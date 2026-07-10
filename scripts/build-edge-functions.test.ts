import { execFileSync } from 'child_process';
import fs from 'fs';
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
const { assertNoDisallowedDependencies, extractDeclarations } = require('./build-edge-functions.js');

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
