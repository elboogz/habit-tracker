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
import type { HabitLog } from '../habit-types';
import { addDays, localDayKeyOf, parseDayKeyParts } from './day-key';

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

/** One day within a developer-simulated window -- whether it should carry a completion. */
export type SimulatedDay = { date: string; completed: boolean };

/**
 * The single shared log-generation step every debug reducer case in `lib/habit-store.tsx` goes
 * through (`debugBackfillLogs`, `debugAdvanceChallenge`, `debugCompleteChallenge`,
 * `debugFillHistory`, `debugSimulateScenario`) -- factored out so there is exactly one place that
 * decides what a simulated completion row looks like, rather than five near-identical inline
 * `.map(...)` blocks that could silently drift from each other. Only produces rows for the
 * `completed: true` days; a `completed: false` day contributes nothing here (the reducer is
 * responsible for first clearing any pre-existing log on that date, so a miss is a genuine
 * absence, not a stray leftover from a previous simulation run).
 */
export function simulatedLogsFor(habitId: string, days: SimulatedDay[], amount: number, now: string): HabitLog[] {
  return days
    .filter((day) => day.completed)
    .map((day, index) => ({
      id: `${habitId}-debug-${day.date}-${index}`,
      habitId,
      date: day.date,
      count: amount,
      loggedAt: now,
      updatedAt: now,
    }));
}

/**
 * Recovery-testing and Momentum-State scenarios for Settings' developer tools (see
 * docs/phase-4-completion-report.md's "Developer scenario simulator" section for how each pattern
 * was derived and verified against the real domain functions -- not hand-guessed). Each pattern is
 * ordered oldest -> today (the last entry is always today, offset 0), so the generator below can
 * derive every date purely from `today` and the pattern's length. Every pattern is a genuinely
 * valid history that exercises `lib/domain/recovery.ts` / `lib/domain/momentum.ts` exactly as real
 * usage would -- no domain rule is bypassed or special-cased for these buttons.
 *
 * The four recovery-flow scenarios use a 7-day completed baseline so the habit reads as
 * "already established," not brand new, before the miss/recovery pattern that's the point of the
 * button. `missYesterday`/`missTwoConsecutive`/`quietStretch` leave today `false` (open) so the
 * Recovery Card renders and a real tap on Today can be used to test the live completion +
 * celebration flow; the rest are "instant preview" style (today included), for immediately
 * checking the resulting Progress screen state without further interaction -- the same convention
 * `debugCompleteChallenge` already established for previewing a post-completion state.
 */
export type ScenarioKey =
  | 'missYesterday'
  | 'missTwoConsecutive'
  | 'recoverToday'
  | 'recoverAfterMultipleMisses'
  | 'quietStretch'
  | 'rebuilding'
  | 'building'
  | 'thriving';

const SCENARIO_PATTERNS: Record<ScenarioKey, boolean[]> = {
  // A trailing `false` for today itself, in addition to the miss(es) before it, in both of these:
  // openLapse only ever looks through yesterday, so today's own value doesn't affect its result --
  // it's there purely so a stale log from a previous scenario run on the same habit gets cleared.
  missYesterday: [true, true, true, true, true, true, true, false, false],
  missTwoConsecutive: [true, true, true, true, true, true, true, false, false, false],
  recoverToday: [true, true, true, true, true, true, true, false, true],
  recoverAfterMultipleMisses: [true, true, true, true, true, true, true, false, false, false, false, true],
  quietStretch: [true, true, true, true, true, true, true, false, false, false, false, false],
  rebuilding: [false, false, false, false, true, true, true],
  building: [true, true, true, true, false, true],
  thriving: [true, true, true, true, true, true, true, true, true, true],
};

/** Builds the concrete dated pattern for `scenario`, anchored so the pattern's last entry is `today`. */
export function scenarioPattern(scenario: ScenarioKey, today: string): SimulatedDay[] {
  const completions = SCENARIO_PATTERNS[scenario];
  const todayIndex = completions.length - 1;
  return completions.map((completed, index) => ({
    date: addDays(today, index - todayIndex),
    completed,
  }));
}
