import type { Habit } from '../habit-types';
import { addDays, dayKey } from './habit-stats';

/** 'daily', or the set of weekdays it applies to (0=Sunday..6=Saturday, matches Date.getDay()). */
export type ScheduleDays = 'daily' | number[];

/**
 * One append-only, effective-dated schedule/pause period for a habit. The period governing a
 * given date is the one with the greatest `effectiveFrom <= date` (see scheduleForDate) -- there
 * is no `effectiveTo`, so a new period is always an insert, never an edit of a prior row. This is
 * what guarantees changing a habit's schedule never recalculates the meaning of past periods.
 */
export type HabitSchedulePeriod = {
  id: string;
  habitId: string;
  effectiveFrom: string; // local day key 'YYYY-MM-DD', inclusive
  days: ScheduleDays;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
};

export function parseDayKeyParts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/**
 * 0 (Sunday) - 6 (Saturday) for a local day key, computed via the local Date constructor form
 * (never `new Date(key)`, which JS parses as UTC midnight and can report the wrong weekday for
 * roughly half the world's timezones once converted back to local time).
 */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKeyParts(key);
  return new Date(year, month - 1, day).getDay();
}

/** Local day key for an ISO timestamp (e.g. Habit.createdAt) -- reuses dayKey's local-time formatting. */
export function localDayKeyOf(isoTimestamp: string): string {
  return dayKey(new Date(isoTimestamp));
}

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
