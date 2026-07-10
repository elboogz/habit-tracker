import { initialState, migrateChallenges, migrateSchedulePeriods } from './persistence';
import type { Habit, HabitSchedulePeriod, HabitState } from '../habit-types';

// Directly exercises the hydration/migration logic Phase 2 adds to lib/habit-store.tsx, per
// docs/phase-2-implementation-plan.md section 6. The central property under test: adding
// `schedulePeriods` as a plain, top-level, per-field-defaulted field (matching the existing
// migrateChallenges convention) is backwards compatible, whereas the originally-proposed nested
// `{ schemaVersion, state }` envelope was not -- see the "old code merge logic" test below, which
// is the direct proof of that fix.

function sampleHabit(): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function samplePeriod(): HabitSchedulePeriod {
  return {
    id: 'p1',
    habitId: 'h1',
    effectiveFrom: '2026-02-01',
    days: [1, 3, 5],
    paused: false,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };
}

describe('migrateSchedulePeriods', () => {
  it('defaults an absent value to an empty array', () => {
    expect(migrateSchedulePeriods(undefined)).toEqual([]);
  });

  it('passes an existing array through unchanged', () => {
    const periods = [samplePeriod()];
    expect(migrateSchedulePeriods(periods)).toBe(periods);
  });
});

// The exact hydration expression used in lib/habit-store.tsx's HabitStoreProvider effect, for
// both the scoped-key and legacy migration paths (see the corrected design in section 6).
function newCodeHydrate(parsed: Record<string, unknown>): HabitState {
  return {
    ...initialState,
    ...parsed,
    challenges: migrateChallenges(parsed.challenges as never),
    schedulePeriods: migrateSchedulePeriods(parsed.schedulePeriods as HabitSchedulePeriod[] | undefined),
  } as HabitState;
}

// What pre-Phase-2 code executed -- no awareness of schedulePeriods at all. Reproduced here
// (rather than imported) specifically to prove what an *old app build* would do when it reads
// data written by a *new* app build, since old code obviously can't import a function that
// doesn't exist in its own version.
function oldCodeHydrate(parsed: Record<string, unknown>): HabitState {
  return {
    ...initialState,
    ...parsed,
    challenges: migrateChallenges(parsed.challenges as never),
  } as HabitState;
}

describe('hydration -- upgrade path (new code reads a pre-Phase-2 blob)', () => {
  it('defaults schedulePeriods to [] while leaving every other field intact', () => {
    const prePhase2Blob = {
      habits: [sampleHabit()],
      logs: [],
      challenges: [],
      hasOnboarded: true,
      notifications: { enabled: true, times: ['09:00'] },
      soundEnabled: true,
      // no schedulePeriods key at all
    };
    const result = newCodeHydrate(prePhase2Blob);
    expect(result.schedulePeriods).toEqual([]);
    expect(result.habits).toEqual(prePhase2Blob.habits);
    expect(result.hasOnboarded).toBe(true);
  });
});

describe('hydration -- normal read (new code reads a Phase-2-shaped blob)', () => {
  it('preserves populated schedulePeriods exactly', () => {
    const period = samplePeriod();
    const phase2Blob = {
      habits: [sampleHabit()],
      logs: [],
      challenges: [],
      schedulePeriods: [period],
      hasOnboarded: true,
      notifications: { enabled: true, times: ['09:00'] },
      soundEnabled: true,
    };
    const result = newCodeHydrate(phase2Blob);
    expect(result.schedulePeriods).toEqual([period]);
  });
});

describe('hydration -- backward compatibility (old code reads a Phase-2-shaped blob)', () => {
  it('still correctly populates every pre-existing field -- the property the nested envelope design broke', () => {
    const habit = sampleHabit();
    const phase2Blob = {
      habits: [habit],
      logs: [{ id: 'l1', habitId: 'h1', date: '2026-01-01', count: 1, loggedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      challenges: [],
      schedulePeriods: [samplePeriod()],
      hasOnboarded: true,
      notifications: { enabled: true, times: ['08:30'] },
      soundEnabled: false,
    };

    const result = oldCodeHydrate(phase2Blob);

    // Old code doesn't know schedulePeriods exists, but every field it *does* know about must
    // still come from `parsed`, not silently fall back to initialState's empty defaults -- that
    // silent fallback (and the data loss it causes on the very next write) is exactly what the
    // originally-proposed `{ schemaVersion, state }` envelope would have caused, because those
    // fields would have been nested under `state` instead of sitting at the same top level
    // `initialState` expects.
    expect(result.habits).toEqual([habit]);
    expect(result.logs).toHaveLength(1);
    expect(result.hasOnboarded).toBe(true);
    expect(result.notifications).toEqual({ enabled: true, times: ['08:30'] });
    expect(result.soundEnabled).toBe(false);

    // The unknown-to-old-code key rides along inertly rather than being dropped -- this is what
    // makes it survive being written back to storage by old code untouched.
    expect((result as unknown as { schedulePeriods: unknown }).schedulePeriods).toEqual([samplePeriod()]);
  });
});

describe('round-trip', () => {
  it('serializing then re-hydrating a populated state loses nothing', () => {
    const state: HabitState = {
      habits: [sampleHabit()],
      logs: [],
      challenges: [],
      schedulePeriods: [samplePeriod()],
      hasOnboarded: true,
      notifications: { enabled: true, times: ['09:00'] },
      soundEnabled: true,
    };
    const roundTripped = newCodeHydrate(JSON.parse(JSON.stringify(state)));
    expect(roundTripped).toEqual(state);
  });
});
