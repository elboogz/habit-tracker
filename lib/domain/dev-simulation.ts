// Developer-tool-only helper (Settings' `__DEV__` section — lib/habit-store.tsx's debug*
// reducer cases). Not part of the behavioral domain layer's public surface in the sense CLAUDE.md
// means it ("no screen may reimplement a concept that lives here") — this doesn't compute a
// user-facing metric, it computes a valid *input* (a habit's createdAt) so that developer-
// simulated logs behave exactly like genuine history under the real rules in schedule.ts.
//
// Root cause this exists to fix: the debug tools backdate HabitLog.date into the past but left
// habit.createdAt at its real (today) value. isScheduledOpportunity (schedule.ts) treats no date
// before a habit's local creation date as ever a Scheduled Opportunity, so every schedule-aware
// calculation (Momentum State, Recovery) only ever saw a single opportunity (today) — while
// totalCompletions/consistency (which read raw logs by calendar date, not by Scheduled
// Opportunity) saw the full backfilled window. Same underlying data, two different effective
// histories. Backdating createdAt to cover the simulated dates makes both readings agree.
import { localDayKeyOf, parseDayKeyParts } from './day-key';

/**
 * The `createdAt` a habit needs so every date in `simulatedDates` falls on or after its local
 * creation date — i.e. so none of them get silently excluded from Scheduled Opportunity
 * generation. Returns `createdAt` unchanged if it already covers every simulated date. Never
 * moves `createdAt` *later* than it already is, so a real habit's genuine creation date (if
 * somehow already earlier than every simulated date) is left alone. Preserves the original
 * time-of-day component so this is a pure date-part substitution, not a fabricated timestamp.
 */
export function backdatedCreatedAt(createdAt: string, simulatedDates: string[]): string {
  if (simulatedDates.length === 0) return createdAt;
  const earliest = simulatedDates.reduce((min, date) => (date < min ? date : min));
  if (earliest >= localDayKeyOf(createdAt)) return createdAt;

  const original = new Date(createdAt);
  const { year, month, day } = parseDayKeyParts(earliest);
  const backdated = new Date(
    year,
    month - 1,
    day,
    original.getHours(),
    original.getMinutes(),
    original.getSeconds(),
    original.getMilliseconds(),
  );
  return backdated.toISOString();
}
