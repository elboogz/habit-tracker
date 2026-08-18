import type { Challenge, Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { addDays, dayKey, daysBetween } from './day-key';
import { isScheduledOpportunity, scheduledOpportunitiesInWindow, scheduledOpportunitiesUpTo } from './schedule';

// Re-exported so existing `@/lib/habit-stats` imports of dayKey/addDays (via the barrel) keep
// working unchanged -- day-key.ts is the canonical home now that schedule.ts needs these too,
// without creating a circular import between habit-stats.ts and schedule.ts.
export { addDays, dayKey };

function logsForHabitOnDay(logs: HabitLog[], habitId: string, date: string): HabitLog[] {
  return logs.filter((log) => log.habitId === habitId && log.date === date);
}

export function countForDay(logs: HabitLog[], habitId: string, date: string): number {
  return logsForHabitOnDay(logs, habitId, date).reduce((sum, log) => sum + log.count, 0);
}

/**
 * A reduced ("smaller version") completion counts fully as done for the day -- not partial
 * credit -- so every downstream consumer (streaks, consistency, recovery, momentum, challenge
 * progress) automatically treats it as a completed day with no further changes (Phase 4, see
 * docs/phase-4-plan.md section 2.2). Additive and backward-compatible: no pre-Phase-4 HabitLog
 * has a `reduced` field, so every existing computation over existing data is byte-for-byte
 * unchanged.
 */
export function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const dayLogs = logsForHabitOnDay(logs, habit.id, date);
  if (dayLogs.some((log) => log.reduced)) return true;
  const total = dayLogs.reduce((sum, log) => sum + log.count, 0);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}

export function isDoneToday(habit: Habit, logs: HabitLog[]): boolean {
  return isDoneOnDay(habit, logs, dayKey());
}

/**
 * The target to use for a "smaller version" of this habit (Phase 4's recovery card), or null if
 * none should be offered. Only ever non-null for habits with a measurable target -- today, the
 * data model has exactly one kind (a count habit's targetCount), so this check and "habits with
 * measurable targets" describe the same set; see docs/phase-4-plan.md section 8.1. The `/3`
 * default (floored at 1) reproduces the master spec's own worked examples (30 min -> 10 min;
 * 8 glasses -> "focus on the next glass") without inventing a new ratio.
 */
export function reducedTargetFor(habit: Habit): number | null {
  if (habit.type !== 'count' || !habit.targetCount) return null;
  if (habit.reducedTarget) return habit.reducedTarget;
  return Math.max(1, Math.round(habit.targetCount / 3));
}

/**
 * Cumulative count of logged entries for a habit, lifetime, never resetting. Consolidates the
 * inline `logs.filter((log) => log.habitId === habitId).length` pattern previously duplicated
 * across screens into one named export (Phase 3) -- not a new calculation.
 */
export function totalCompletions(habitId: string, logs: HabitLog[]): number {
  return logs.filter((log) => log.habitId === habitId).length;
}

/**
 * Consecutive Scheduled Opportunities (ending `asOfDate` or the one before it) where the habit's
 * target was met. Per docs/habit-tracker-evolution-plan.md's Scheduled Opportunity principle
 * (Streak added to that list as a correction, not a new decision -- it was omitted in error): a
 * non-scheduled date (a Tuesday for a Mon/Wed/Fri habit) is skipped entirely, neither breaking nor
 * extending the streak, rather than read as a miss the way a raw calendar-day walk would. For a
 * daily/unpaused habit this is identical to the prior calendar-day behaviour, since every calendar
 * day is a Scheduled Opportunity. `asOfDate` defaults to the caller's live local "today" -- the
 * only case the client app ever needs. It exists as an explicit parameter because the
 * send-coaching-push Edge Function must compute this per recipient's own local "today" (their
 * timezone, not the server's) rather than the server's current date; that per-recipient date is
 * what's passed in there.
 */
export function streakForHabit(
  habit: Habit,
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  asOfDate: string = dayKey(),
): number {
  const opportunities = scheduledOpportunitiesUpTo(habit, schedulePeriods, asOfDate);
  let index = opportunities.length - 1;
  if (index >= 0 && opportunities[index] === asOfDate && !isDoneOnDay(habit, logs, opportunities[index])) {
    index -= 1;
  }

  let streak = 0;
  while (index >= 0 && isDoneOnDay(habit, logs, opportunities[index])) {
    streak += 1;
    index -= 1;
  }
  return streak;
}

/**
 * Calendar-day streak -- `streakForHabit`'s pre-Scheduled-Opportunity behavior, preserved verbatim
 * under an honest name. Exists only so scripts/build-edge-functions.js's generated block (see the
 * SOURCES list there) can keep inlining a function the two Edge Functions actually call (both
 * build a `streakDays` field for their coaching prompts) without silently changing their behavior:
 * neither Edge Function fetches habit_schedule_periods today, so they cannot call the
 * schedule-aware streakForHabit() above without a separate, deliberate change (the same Edge
 * Function integration gated in docs/phase-4-completion-report.md's Consistency entry). Not used
 * by any client screen -- every client call site reads the schedule-aware streakForHabit() instead.
 */
export function calendarStreakForHabit(habit: Habit, logs: HabitLog[], asOfDate: string = dayKey()): number {
  let cursor = isDoneOnDay(habit, logs, asOfDate) ? asOfDate : addDays(asOfDate, -1);

  let streak = 0;
  while (isDoneOnDay(habit, logs, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Longest run of consecutive completed Scheduled Opportunities across the habit's entire history --
 * schedule-aware for the same reason streakForHabit is above. Walks scheduledOpportunitiesUpTo
 * (already floored at the habit's creation date) directly rather than computing an "earliest log"
 * starting point first: a leading run of not-done Scheduled Opportunities before the first real
 * completion only ever resets `current` to 0, so it can never affect the final `longest`, and the
 * creation floor already bounds the walk without needing a second, narrower one.
 */
export function longestStreak(habit: Habit, logs: HabitLog[], schedulePeriods: HabitSchedulePeriod[]): number {
  const opportunities = scheduledOpportunitiesUpTo(habit, schedulePeriods, dayKey());

  let longest = 0;
  let current = 0;
  for (const date of opportunities) {
    if (isDoneOnDay(habit, logs, date)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export type DayStatus = { date: string; done: boolean; count: number };

/**
 * Most recent `days` days (oldest first) ending `asOfDate`, with completion status -- powers the
 * heatmap/bars. See streakForHabit's doc comment for why `asOfDate` is an explicit, defaulted
 * parameter rather than always "now".
 */
export function recentHistory(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): DayStatus[] {
  const result: DayStatus[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    const count = countForDay(logs, habit.id, date);
    result.push({ date, count, done: isDoneOnDay(habit, logs, date) });
  }
  return result;
}

/**
 * Fraction (0-1) of Scheduled Opportunities in the last `days` days (ending `asOfDate`) the habit
 * was completed, or `null` if the window contains no Scheduled Opportunities at all. `null` is a
 * distinct claim from `0`: "not yet asked" is not the same statement as "asked and missed every
 * time," so a window with nothing to evaluate returns no percentage rather than a false zero.
 *
 * Per docs/habit-tracker-evolution-plan.md's Scheduled Opportunity principle ("every progress
 * calculation throughout the application must be based on scheduled opportunities rather than
 * calendar days," naming Consistency first in that list): measures adherence to what the habit's
 * own schedule actually offered in the window, not raw calendar days regardless of whether the
 * habit was ever asking for them that day. Deliberately does not reuse recentHistory -- that stays
 * calendar-based (it powers the heatmap/calendar, where every calendar day is a legitimate visual
 * artefact) and answers a different question than this function does.
 */
export function consistency(
  habit: Habit,
  logs: HabitLog[],
  days: number,
  schedulePeriods: HabitSchedulePeriod[],
  asOfDate: string = dayKey(),
): number | null {
  const opportunities = scheduledOpportunitiesInWindow(habit, schedulePeriods, days, asOfDate);
  if (opportunities.length === 0) return null;
  const doneCount = opportunities.filter((date) => isDoneOnDay(habit, logs, date)).length;
  return doneCount / opportunities.length;
}

/**
 * Calendar-day consistency -- `consistency`'s pre-Scheduled-Opportunity behavior, preserved
 * verbatim under an honest name. Exists only so scripts/build-edge-functions.js's generated block
 * (see the SOURCES list there) can keep inlining a function the two Edge Functions actually call
 * (send-coaching-push's push eligibility, ai-insights' consistencyPct) without silently changing
 * their behavior: neither Edge Function fetches habit_schedule_periods today, so they cannot call
 * the schedule-aware consistency() above without a separate, deliberate change (extending the
 * generated-domain whitelist to include schedule.ts, plus a new DB read -- see the completion
 * report for the open questions that change is gated on). Not used by any client screen -- every
 * client call site reads the schedule-aware consistency() instead.
 */
export function calendarConsistency(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): number {
  const history = recentHistory(habit, logs, days, asOfDate);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}

export type ChallengeProgress = {
  habits: Habit[];
  daysElapsed: number;
  daysCompleted: number;
  totalDays: number;
  isComplete: boolean;
  isFailed: boolean;
  todayDone: boolean;
};

/**
 * A challenge day counts only if every included habit was done that day. A habit that wasn't
 * even a Scheduled Opportunity that day (Phase 2 — see docs/phase-2-implementation-plan.md
 * section 7) can't be blamed for not being done; every existing habit defaults to daily/unpaused
 * with zero schedule periods, so this is a no-op today and produces identical results to before
 * Phase 2 for every habit that exists in practice (see the fixtures in habit-stats.test.ts).
 */
function allDoneOnDay(
  habits: Habit[],
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  date: string,
): boolean {
  return (
    habits.length > 0 &&
    habits.every((habit) => !isScheduledOpportunity(schedulePeriods, habit, date) || isDoneOnDay(habit, logs, date))
  );
}

/**
 * How a challenge is tracking — used by both the banner on Today and the Challenges tab.
 * `isFailed`'s semantics (a single missed non-today day fails the challenge outright) are
 * preserved exactly through Phase 2 — the tolerance redesign is Phase 7's job, not this one.
 */
export function challengeProgress(
  challenge: Challenge,
  habits: Habit[],
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[] = [],
): ChallengeProgress {
  const challengeHabits = habits.filter((candidate) => challenge.habitIds.includes(candidate.id));
  const today = dayKey();
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, daysBetween(challenge.startDate, today) + 1),
  );

  let daysCompleted = 0;
  let failed = false;
  for (let i = 0; i < daysElapsed; i += 1) {
    const date = addDays(challenge.startDate, i);
    const done = allDoneOnDay(challengeHabits, logs, schedulePeriods, date);
    if (done) {
      daysCompleted += 1;
    } else if (date !== today) {
      failed = true;
    }
  }

  const isComplete = daysCompleted >= challenge.durationDays;
  return {
    habits: challengeHabits,
    daysElapsed,
    daysCompleted,
    totalDays: challenge.durationDays,
    isComplete,
    isFailed: !isComplete && failed,
    todayDone: allDoneOnDay(challengeHabits, logs, schedulePeriods, today),
  };
}
