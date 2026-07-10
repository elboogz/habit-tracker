// Pure local-persistence helpers used by lib/habit-store.tsx's hydration effect. Kept
// dependency-free (no AsyncStorage, no Supabase, no React) so they're directly unit-testable --
// see lib/habit-store.migration.test.ts -- without needing to mock native modules.
import type { Challenge, HabitSchedulePeriod, HabitState } from '../habit-types';

export const initialState: HabitState = {
  habits: [],
  logs: [],
  challenges: [],
  schedulePeriods: [],
  hasOnboarded: false,
  notifications: { enabled: false, times: ['09:00'] },
  soundEnabled: true,
};

/** Pre-migration challenges stored a single `habitId` instead of `habitIds: string[]`. */
export type LegacyChallenge = Omit<Challenge, 'habitIds'> & { habitId?: string; habitIds?: string[] };

export function migrateChallenges(challenges: LegacyChallenge[] | undefined): Challenge[] {
  if (!challenges) return [];
  return challenges.map((challenge) => ({
    ...challenge,
    habitIds: challenge.habitIds ?? (challenge.habitId ? [challenge.habitId] : []),
  }));
}

/**
 * Pre-Phase-2 local data has no `schedulePeriods` key at all. Defaulting an absent value to an
 * empty array is a behavioral no-op (see lib/domain/schedule.ts's zero-periods default: daily,
 * unpaused), not a migration "step" with anything to interrupt or roll back — it's the same
 * per-field-defaulting pattern already used by migrateChallenges above, deliberately not a
 * nested envelope or version number (see docs/phase-2-implementation-plan.md section 6 for why
 * a nested shape would silently break older app versions reading newer local data: an app that
 * doesn't know about the envelope would do `{ ...initialState, ...parsed }` where `parsed`'s
 * meaningful fields sit one level too deep to override initialState's empty defaults).
 */
export function migrateSchedulePeriods(periods: HabitSchedulePeriod[] | undefined): HabitSchedulePeriod[] {
  return periods ?? [];
}

/** Pre-sync local data has no updatedAt — backfill it once so last-write-wins merging has something to compare against. */
export function backfillTimestamps(state: HabitState): HabitState {
  return {
    ...state,
    habits: state.habits.map((habit) => ({ ...habit, updatedAt: habit.updatedAt ?? habit.createdAt })),
    logs: state.logs.map((log) => ({ ...log, updatedAt: log.updatedAt ?? log.loggedAt })),
    challenges: state.challenges.map((challenge) => ({
      ...challenge,
      updatedAt: challenge.updatedAt ?? new Date().toISOString(),
    })),
  };
}
