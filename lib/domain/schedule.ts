import type { Habit, HabitSchedulePeriod, ScheduleDays } from '../habit-types';
import { addDays, localDayKeyOf, parseDayKeyParts, weekdayOf } from './day-key';

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
