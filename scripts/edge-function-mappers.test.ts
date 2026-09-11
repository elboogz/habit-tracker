import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

// Phase 5, Step 4 Part 1 (docs/phase-5-plan.md section 6.2): tests the hand-maintained caller-side
// row-to-domain mappers actually present in both Edge Functions, not a hand-copied duplicate that
// could silently drift from them. The mapper's exact source text is extracted from the real file
// (drift-guarded: a sanity `toContain` check fails loudly if the real function's shape ever
// changes, so the mutation below can never silently test stale expectations), transpiled with the
// project's own `typescript` dependency (stripping only type annotations, not rewriting logic),
// and executed directly -- the same "prove we're checking the real artefact" discipline as
// scripts/build-edge-functions.ast-equivalence.test.ts.

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts'),
  path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts'),
];

/** Transpiles a standalone TS snippet (types stripped, logic untouched) and returns `name` as a callable. */
function compileToCallable<T extends (...args: never[]) => unknown>(tsSource: string, name: string): T {
  const { outputText } = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleObj = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function('module', 'exports', `${outputText}\nmodule.exports.${name} = ${name};`);
  runner(moduleObj, moduleObj.exports);
  return moduleObj.exports[name] as T;
}

const TO_DOMAIN_SCHEDULE_PERIOD = `function toDomainSchedulePeriod(row: HabitSchedulePeriodRow): HabitSchedulePeriod {
  return {
    id: row.id,
    habitId: row.habit_id,
    effectiveFrom: row.effective_from,
    days: row.days_of_week ?? 'daily',
    paused: row.paused,
    createdAt: row.created_at,
  };
}`;

type HabitSchedulePeriodRow = {
  id: string;
  habit_id: string;
  effective_from: string;
  days_of_week: number[] | null;
  paused: boolean;
  created_at: string;
};
type ScheduleDaysDomain = 'daily' | number[];
type HabitSchedulePeriodDomain = {
  id: string;
  habitId: string;
  effectiveFrom: string;
  days: ScheduleDaysDomain;
  paused: boolean;
  createdAt: string;
};

describe('toDomainSchedulePeriod (Edge Function caller-side mapper)', () => {
  it('is present, verbatim, in both Edge Functions', () => {
    for (const file of TARGETS) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toContain(TO_DOMAIN_SCHEDULE_PERIOD);
    }
  });

  it('is byte-identical between the two Edge Functions -- the generated block hash cannot detect divergence here', () => {
    const [sourceA, sourceB] = TARGETS.map((f) => fs.readFileSync(f, 'utf8'));
    const idxA = sourceA.indexOf(TO_DOMAIN_SCHEDULE_PERIOD);
    const idxB = sourceB.indexOf(TO_DOMAIN_SCHEDULE_PERIOD);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    expect(sourceA.slice(idxA, idxA + TO_DOMAIN_SCHEDULE_PERIOD.length)).toBe(
      sourceB.slice(idxB, idxB + TO_DOMAIN_SCHEDULE_PERIOD.length),
    );
  });

  // Realistic select()-shaped fixtures: snake_case column names, nullable days_of_week, exactly
  // what supabase.from('habit_schedule_periods').select(...) would actually return -- not an
  // object already shaped like the domain type. See habit_schedule_periods_schema.sql for the
  // real column set.
  const nullDaysRow: HabitSchedulePeriodRow = {
    id: 'period-1',
    habit_id: 'habit-1',
    effective_from: '2026-01-01',
    days_of_week: null,
    paused: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const nonNullDaysRow: HabitSchedulePeriodRow = {
    id: 'period-2',
    habit_id: 'habit-1',
    effective_from: '2026-02-01',
    days_of_week: [1, 3, 5],
    paused: true,
    created_at: '2026-02-01T00:00:00.000Z',
  };

  function realMapper(): (row: HabitSchedulePeriodRow) => HabitSchedulePeriodDomain {
    return compileToCallable(TO_DOMAIN_SCHEDULE_PERIOD, 'toDomainSchedulePeriod');
  }

  it('maps days_of_week: null to days: "daily"', () => {
    expect(realMapper()(nullDaysRow).days).toBe('daily');
  });

  it('passes a non-null weekday array through unchanged', () => {
    expect(realMapper()(nonNullDaysRow).days).toEqual([1, 3, 5]);
  });

  it('maps habit_id to habitId', () => {
    expect(realMapper()(nullDaysRow).habitId).toBe('habit-1');
  });

  it('maps effective_from to effectiveFrom', () => {
    expect(realMapper()(nullDaysRow).effectiveFrom).toBe('2026-01-01');
    expect(realMapper()(nonNullDaysRow).effectiveFrom).toBe('2026-02-01');
  });

  it('maps paused correctly for both true and false', () => {
    expect(realMapper()(nullDaysRow).paused).toBe(false);
    expect(realMapper()(nonNullDaysRow).paused).toBe(true);
  });

  it('maps created_at to createdAt', () => {
    expect(realMapper()(nullDaysRow).createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps id correctly -- the sixth and last field the generated closure (scheduleForDate\'s tie-break) actually reads', () => {
    expect(realMapper()(nullDaysRow).id).toBe('period-1');
  });

  // Discrimination: proves the days_of_week test above actually distinguishes correct from
  // incorrect, rather than passing regardless of the mapper's real logic. Reproduces the specific
  // wrong implementation named as the dangerous case: days_of_week: null -> days: [] instead of
  // 'daily'. Defined as a standalone, in-memory-only snippet -- never written to either Edge
  // Function, and structurally identical to the real mapper except for the one faulty line, so
  // the comparison isolates exactly the defect being tested for.
  it('fails against a mutated mapper that maps days_of_week: null to [] instead of "daily"', () => {
    const WRONG_MAPPER = TO_DOMAIN_SCHEDULE_PERIOD.replace("row.days_of_week ?? 'daily'", 'row.days_of_week ?? []');
    expect(WRONG_MAPPER).not.toBe(TO_DOMAIN_SCHEDULE_PERIOD); // fixture sanity: the mutation actually changed something
    const wrongMapper: (row: HabitSchedulePeriodRow) => HabitSchedulePeriodDomain = compileToCallable(
      WRONG_MAPPER,
      'toDomainSchedulePeriod',
    );
    expect(wrongMapper(nullDaysRow).days).not.toBe('daily');
    expect(wrongMapper(nullDaysRow).days).toEqual([]);
    // The real, unmutated mapper does not exhibit this failure -- confirms the discrimination is
    // specific to the introduced mutation, not to the fixture or the comparison.
    expect(realMapper()(nullDaysRow).days).toBe('daily');
  });
});

const TO_DOMAIN_LAPSE_REASON = `function toDomainLapseReason(row: LapseReasonRow): LapseReasonEntry {
  return {
    habitId: row.habit_id,
    createdAt: row.created_at,
    reason: row.reason as LapseReasonKey | null,
  };
}`;

type LapseReasonRow = { habit_id: string; created_at: string; reason: string | null };
type LapseReasonKeyDomain = 'too_busy' | 'forgot' | 'low_energy' | 'not_feeling_it' | 'something_else';
type LapseReasonEntryDomain = { habitId: string; createdAt: string; reason: LapseReasonKeyDomain | null };

describe('toDomainLapseReason (Edge Function caller-side mapper)', () => {
  it('is present, verbatim, in both Edge Functions', () => {
    for (const file of TARGETS) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toContain(TO_DOMAIN_LAPSE_REASON);
    }
  });

  it('is byte-identical between the two Edge Functions', () => {
    const [sourceA, sourceB] = TARGETS.map((f) => fs.readFileSync(f, 'utf8'));
    const idxA = sourceA.indexOf(TO_DOMAIN_LAPSE_REASON);
    const idxB = sourceB.indexOf(TO_DOMAIN_LAPSE_REASON);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
    expect(sourceA.slice(idxA, idxA + TO_DOMAIN_LAPSE_REASON.length)).toBe(
      sourceB.slice(idxB, idxB + TO_DOMAIN_LAPSE_REASON.length),
    );
  });

  // Realistic select()-shaped fixtures: snake_case, matching what
  // supabase.from('lapse_reasons').select(...) would actually return -- not a pre-shaped
  // LapseReasonEntry. See phase-4-recovery-flow-schema.sql for the real column set.
  const nullReasonRow: LapseReasonRow = {
    habit_id: 'habit-1',
    created_at: '2026-01-01T00:00:00.000Z',
    reason: null,
  };
  const supportedReasonRow: LapseReasonRow = {
    habit_id: 'habit-2',
    created_at: '2026-02-01T00:00:00.000Z',
    reason: 'forgot',
  };

  function realMapper(): (row: LapseReasonRow) => LapseReasonEntryDomain {
    return compileToCallable(TO_DOMAIN_LAPSE_REASON, 'toDomainLapseReason');
  }

  it('keeps reason: null as null', () => {
    expect(realMapper()(nullReasonRow).reason).toBeNull();
  });

  it('carries a supported non-null reason through as the corresponding LapseReasonKey', () => {
    expect(realMapper()(supportedReasonRow).reason).toBe('forgot');
  });

  it('maps habit_id to habitId -- the field lapseReasonDistribution (coach-facts.ts, the only generated-closure consumer of LapseReasonEntry) filters on', () => {
    expect(realMapper()(nullReasonRow).habitId).toBe('habit-1');
    expect(realMapper()(supportedReasonRow).habitId).toBe('habit-2');
  });

  // createdAt is part of the current LapseReasonEntry shim (Step 3) but, traced precisely,
  // lapseReasonDistribution -- the only generated-closure function that touches LapseReasonEntry
  // -- reads only .habitId and .reason, never .createdAt. (.createdAt is read by
  // lapseReasonSuppressionUntil in recovery.ts, which is not part of the current closure.) Still
  // mapped here because the shim declares it and the mapper's contract is to satisfy the shim
  // faithfully, not to second-guess it -- see the Step 4 Part 1 report for this observation
  // flagged explicitly rather than used to justify silently narrowing the shim.
  it('maps created_at to createdAt', () => {
    expect(realMapper()(nullReasonRow).createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
