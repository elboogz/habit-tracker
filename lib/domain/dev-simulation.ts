// Developer-tool-only helper (Settings' `__DEV__` section — lib/habit-store.tsx's debug*
// reducer cases). Not part of the behavioral domain layer's public surface in the sense CLAUDE.md
// means it ("no screen may reimplement a concept that lives here") — this doesn't compute a
// user-facing metric, it computes a valid *input* (a habit's createdAt and schedule periods) so
// that developer-simulated logs behave exactly like genuine history under the real rules in
// schedule.ts.
//
// Root cause this exists to fix: the debug tools backdate HabitLog.date into the past but left
// habit.createdAt at its real (today) value. isScheduledOpportunity (schedule.ts) treats no date
// before a habit's local creation date as ever a Scheduled Opportunity, so every schedule-aware
// calculation (Momentum State, Recovery) only ever saw a single opportunity (today) — while
// totalCompletions/consistency (which read raw logs by calendar date, not by Scheduled
// Opportunity) saw the full backfilled window. Same underlying data, two different effective
// histories. Backdating createdAt to cover the simulated dates makes both readings agree.
//
// A second, distinct root cause of the same shape: a habit's schedule period only takes effect
// from the day it was set (app/habit-form.tsx's addSchedulePeriod always writes
// effectiveFrom: today). recentScheduledPatternDates (schedule.ts) is deliberately floor-free --
// it has no habit.createdAt to bound against, by design, since it's what backdatedCreatedAt's own
// input is computed from -- so it walks straight past that effectiveFrom into scheduleForDate's
// zero-periods default (daily/unpaused) for every date before it, generating bonus completions on
// non-scheduled days. widenedForDevSimulation and backdatedSchedulePeriod below fix this the same
// way backdatedCreatedAt fixes the first cause, but split into two functions rather than one: the
// date-generation step itself reads schedulePeriods (via scheduleForDate, inside
// recentScheduledPatternDates/scheduledOpportunitiesInWindow), so unlike createdAt -- which only
// gates a check layered *after* date generation -- the schedule period has to already be widened
// *before* generation for the resulting dates to come out correctly filtered in the first place.
// backdatedSchedulePeriod alone, called only after generation the way backdatedCreatedAt is,
// would just make already-wrong dates retroactively consistent with a corrected schedule --
// not fix which dates got chosen. See lib/habit-store.tsx's debug reducer cases for how the two
// are used together.
import type { HabitLog, HabitSchedulePeriod } from '../habit-types';
import { addDays, localDayKeyOf, parseDayKeyParts } from './day-key';
import { recentScheduledPatternDates, scheduleForDate } from './schedule';

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

const devSimulatedScheduleId = (habitId: string) => `${habitId}-dev-simulated-schedule`;

/**
 * A periods array safe to *generate* developer-simulated dates against -- never persisted, used
 * only as an input to recentScheduledPatternDates/scheduledOpportunitiesInWindow before backdating
 * runs. Resolves `habitId`'s schedule as of `asOfDate` (today, from the caller's perspective) via
 * the existing scheduleForDate -- schedule.ts itself gains nothing new. If that schedule is
 * already daily/unpaused, there is nothing to widen (the zero-periods default already has no gap)
 * and `periods` is returned unchanged -- the common case, since most habits are daily. Otherwise,
 * returns `periods` with one additional period carrying the active schedule's own content back
 * `maxLookbackDays` (a generous, heuristic bound, matching recentScheduledPatternDates's own
 * default), under a stable id so a repeated call for the same habit replaces rather than
 * accumulates. This period only ever exists in this widened, throwaway array -- the real
 * `effectiveFrom` written to state comes from backdatedSchedulePeriod below, using the *result* of
 * generating against this one.
 */
export function widenedForDevSimulation(
  habitId: string,
  periods: HabitSchedulePeriod[],
  asOfDate: string,
  maxLookbackDays = 366,
): HabitSchedulePeriod[] {
  const active = scheduleForDate(periods, habitId, asOfDate);
  if (active.days === 'daily' && !active.paused) return periods;

  const now = new Date().toISOString();
  const widened: HabitSchedulePeriod = {
    id: devSimulatedScheduleId(habitId),
    habitId,
    effectiveFrom: addDays(asOfDate, -maxLookbackDays),
    days: active.days,
    paused: active.paused,
    createdAt: now,
    updatedAt: now,
  };
  const existingIndex = periods.findIndex((p) => p.id === widened.id);
  if (existingIndex === -1) return [...periods, widened];
  const next = [...periods];
  next[existingIndex] = widened;
  return next;
}

/**
 * The schedule period `habitId` needs so every date in `simulatedDates` -- already generated
 * against widenedForDevSimulation's output above, not `periods` directly -- resolves under its
 * active schedule content rather than the implicit daily default, going forward. The
 * schedule-period counterpart to backdatedCreatedAt, same "never move effectiveFrom later than it
 * needs to be" rule, same no-op when the active schedule is already daily/unpaused (nothing to
 * backdate) or `simulatedDates` is empty. Writes under the same stable id
 * widenedForDevSimulation uses, so a repeated simulation run for the same habit replaces its own
 * prior synthetic period rather than accumulating one per run. Any older, real periods for this
 * habit (e.g. from an earlier genuine schedule edit) are left completely untouched -- per the
 * accepted multi-period simplification, they are simply superseded for the simulated window by
 * scheduleForDate's existing greatest-effectiveFrom-wins rule, the same as any other period
 * conflict, not specially rewritten or removed.
 */
export function backdatedSchedulePeriod(
  habitId: string,
  periods: HabitSchedulePeriod[],
  asOfDate: string,
  simulatedDates: string[],
): HabitSchedulePeriod[] {
  const active = scheduleForDate(periods, habitId, asOfDate);
  if (active.days === 'daily' && !active.paused) return periods;
  if (simulatedDates.length === 0) return periods;

  const earliest = simulatedDates.reduce((min, date) => (date < min ? date : min));
  const id = devSimulatedScheduleId(habitId);
  const existingIndex = periods.findIndex((p) => p.id === id);
  if (existingIndex !== -1 && periods[existingIndex].effectiveFrom <= earliest) return periods;

  const now = new Date().toISOString();
  const backdated: HabitSchedulePeriod = {
    id,
    habitId,
    effectiveFrom: earliest,
    days: active.days,
    paused: active.paused,
    createdAt: existingIndex !== -1 ? periods[existingIndex].createdAt : now,
    updatedAt: now,
  };
  if (existingIndex === -1) return [...periods, backdated];
  const next = [...periods];
  next[existingIndex] = backdated;
  return next;
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

/**
 * Builds the concrete dated pattern for `scenario`, anchored so the pattern's last entry is
 * `today`. Position N from the end means the Nth most recent Scheduled Opportunity for `habitId`
 * under `periods` (via recentScheduledPatternDates), not the Nth most recent calendar day -- for a
 * daily/unpaused schedule the two coincide exactly, so this reduces to the prior calendar-day
 * behaviour unchanged for every habit that predates this fix. If the schedule doesn't have enough
 * matching dates within the lookback bound, fewer than the pattern's full length are returned,
 * aligned to the pattern's own trailing (most recent) entries -- the oldest requested positions are
 * the ones dropped, never the most recent ones the scenario's outcome most depends on.
 */
export function scenarioPattern(
  scenario: ScenarioKey,
  habitId: string,
  periods: HabitSchedulePeriod[],
  today: string,
): SimulatedDay[] {
  const completions = SCENARIO_PATTERNS[scenario];
  const dates = recentScheduledPatternDates(habitId, periods, completions.length, today);
  const offset = completions.length - dates.length;
  return dates.map((date, i) => ({ date, completed: completions[offset + i] }));
}
