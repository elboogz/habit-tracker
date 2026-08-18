import type { Habit, HabitSchedulePeriod, ScheduleDays } from '../habit-types';
import { addDays, dayKey, localDayKeyOf, parseDayKeyParts, weekdayOf } from './day-key';

export type { HabitSchedulePeriod, ScheduleDays } from '../habit-types';
// Re-exported so existing imports of these from './schedule' (this module's own test file, and
// any future domain module) keep working -- day-key.ts is the canonical home now that
// habit-stats.ts also needs it, without creating a circular import between the two.
export { localDayKeyOf, parseDayKeyParts, weekdayOf };

/**
 * Resolves the schedule/pause state in effect for `date`, per the habit's periods. With no
 * matching period, defaults to daily/unpaused -- this default is also the entirety of the
 * migration story for existing habits (see docs/phase-2-implementation-plan.md section 1):
 * a habit with zero periods behaves exactly as every habit does today.
 *
 * Tie-break order when multiple periods have `effectiveFrom <= date`: greatest `effectiveFrom`,
 * then greatest `createdAt`, then greatest `id` (plain lexicographic string comparison -- carries
 * no meaning, only needs to be deterministic for the residual case where both of the above tie).
 */
export function scheduleForDate(
  periods: HabitSchedulePeriod[],
  habitId: string,
  date: string,
): { days: ScheduleDays; paused: boolean } {
  const candidates = periods.filter((period) => period.habitId === habitId && period.effectiveFrom <= date);
  if (candidates.length === 0) return { days: 'daily', paused: false };

  const latest = candidates.reduce((a, b) => {
    if (b.effectiveFrom !== a.effectiveFrom) return b.effectiveFrom > a.effectiveFrom ? b : a;
    if (b.createdAt !== a.createdAt) return b.createdAt > a.createdAt ? b : a;
    return b.id > a.id ? b : a;
  });
  return { days: latest.days, paused: latest.paused };
}

/**
 * Whether `date` was a Scheduled Opportunity for `habit` -- the foundational primitive every
 * other Phase 2 domain calculation is built on. No date before the habit's local creation date
 * is ever a Scheduled Opportunity, regardless of what any schedule period says.
 */
export function isScheduledOpportunity(periods: HabitSchedulePeriod[], habit: Habit, date: string): boolean {
  if (date < localDayKeyOf(habit.createdAt)) return false;
  const { days, paused } = scheduleForDate(periods, habit.id, date);
  if (paused) return false;
  if (days === 'daily') return true;
  return days.includes(weekdayOf(date));
}

/**
 * The next date strictly after `date` on which `habit` has a Scheduled Opportunity, or null if
 * none is found within `maxLookaheadDays` (default 366 -- generous enough to cover any weekly
 * pattern, including a habit paused indefinitely with no future unpaused period). Purely a
 * forward walk using the same isScheduledOpportunity primitive every other schedule calculation
 * already uses -- the missing directional counterpart to scheduledOpportunitiesUpTo, added for
 * Phase 4's recovery card suppression rule (docs/phase-4-plan.md section 2.4).
 */
export function nextScheduledOpportunityAfter(
  periods: HabitSchedulePeriod[],
  habit: Habit,
  date: string,
  maxLookaheadDays = 366,
): string | null {
  let cursor = addDays(date, 1);
  for (let i = 0; i < maxLookaheadDays; i += 1) {
    if (isScheduledOpportunity(periods, habit, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

/** Every Scheduled Opportunity date for `habit`, from its creation through `today` inclusive, ascending. */
export function scheduledOpportunitiesUpTo(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  today: string,
): string[] {
  const start = localDayKeyOf(habit.createdAt);
  const result: string[] = [];
  let cursor = start > today ? undefined : start;
  while (cursor !== undefined && cursor <= today) {
    if (isScheduledOpportunity(periods, habit, cursor)) result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

/**
 * Every Scheduled Opportunity date for `habit` within the trailing `days`-day window ending
 * `asOfDate` (inclusive), ascending -- the windowed counterpart to scheduledOpportunitiesUpTo.
 * Deliberately O(days), not O(habit age): walks only the requested window rather than the
 * habit's full lifetime, since Consistency (this function's motivating caller) is computed
 * several times per Progress render and a lifetime walk would make a small-window question cost
 * proportional to how old the habit is.
 */
export function scheduledOpportunitiesInWindow(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  days: number,
  asOfDate: string = dayKey(),
): string[] {
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    if (isScheduledOpportunity(periods, habit, date)) result.push(date);
  }
  return result;
}

/**
 * Per-date Scheduled Opportunity classification for `habit` within the trailing `days`-day window
 * ending `asOfDate` (inclusive), oldest first -- keyed by date so callers merge it against
 * recentHistory's own output by date rather than trusting positional alignment between two
 * separately-built arrays. Calls isScheduledOpportunity per date, the same primitive
 * scheduledOpportunitiesInWindow is built on, rather than re-deriving any part of its
 * creation-floor/pause/weekday ordering. Paused dates and ordinary off-schedule dates both resolve
 * to `scheduled: false` here identically -- isScheduledOpportunity itself doesn't distinguish them,
 * and per product decision they share one presentation state, so this function doesn't either.
 */
export function scheduledOpportunityFlags(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  days: number,
  asOfDate: string = dayKey(),
): { date: string; scheduled: boolean }[] {
  const result: { date: string; scheduled: boolean }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    result.push({ date, scheduled: isScheduledOpportunity(periods, habit, date) });
  }
  return result;
}

/**
 * The `count` most recent calendar dates at or before `asOfDate` matching `habitId`'s schedule
 * PATTERN (weekday selection and pause periods, via scheduleForDate) -- deliberately excludes the
 * creation-date floor isScheduledOpportunity/scheduledOpportunitiesInWindow apply, and deliberately
 * takes a bare `habitId` rather than a `Habit`, so there is no `createdAt` to consult in the first
 * place. Built for lib/domain/dev-simulation.ts's date generation (scenarioPattern, and the
 * "+N-day streak" tool): both callers use this function's result to compute what `createdAt` OUGHT
 * to become via backdatedCreatedAt afterward, so the creation date is an output of that pipeline,
 * not a valid input constraint on this walk -- a habit created minutes ago must still be able to
 * generate a multi-week-old pattern for a sparse schedule. Not a substitute for
 * isScheduledOpportunity anywhere a real habit's actual history is being evaluated.
 *
 * Bounded at `maxLookbackDays` (default 366, matching nextScheduledOpportunityAfter's existing
 * forward-search precedent) rather than an exact floor, since there is deliberately no creation
 * date to bound against here. Generous enough that only a schedule paused for the entire lookback
 * window could ever exhaust it, at which point returning fewer than `count` dates -- never looping
 * unboundedly -- is the correct behaviour; callers must handle a shorter-than-requested result.
 */
export function recentScheduledPatternDates(
  habitId: string,
  periods: HabitSchedulePeriod[],
  count: number,
  asOfDate: string = dayKey(),
  maxLookbackDays = 366,
): string[] {
  const result: string[] = [];
  let cursor = asOfDate;
  for (let i = 0; result.length < count && i < maxLookbackDays; i += 1) {
    const { days, paused } = scheduleForDate(periods, habitId, cursor);
    if (!paused && (days === 'daily' || days.includes(weekdayOf(cursor)))) result.unshift(cursor);
    cursor = addDays(cursor, -1);
  }
  return result;
}

/** Number of days (today plus the days before it) the production retroactive-entry correction panel covers. */
export const RETROACTIVE_ENTRY_WINDOW_DAYS = 7;

/**
 * The earliest date the production retroactive-entry correction panel (components/habit-calendar.tsx's
 * `onDayPress`, wired up in app/habit/[id].tsx) may edit for `habit`, as of `today` -- the
 * intersection of the fixed `RETROACTIVE_ENTRY_WINDOW_DAYS`-day window and the habit's own creation
 * day. Retroactive entry is a correction tool for a habit's own recent history, not a pre-creation
 * import mechanism (docs/phase-4-plan.md section 7 only ever describes adding/correcting/removing a
 * day's completion within the fixed window, never backfilling history from before a habit existed
 * in the app) -- so a habit created 2 days ago can only have yesterday and the day before corrected,
 * never further back, even though the window alone would otherwise reach further. Developer
 * simulation is unaffected: it deliberately backdates `createdAt` itself
 * (dev-simulation.ts's backdatedCreatedAt) rather than going through this gate.
 */
export function retroactiveEntryWindowStart(habit: Habit, today: string): string {
  const windowStart = addDays(today, -(RETROACTIVE_ENTRY_WINDOW_DAYS - 1));
  const creationFloor = localDayKeyOf(habit.createdAt);
  return windowStart > creationFloor ? windowStart : creationFloor;
}
