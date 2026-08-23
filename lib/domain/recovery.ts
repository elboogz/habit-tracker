// Recovery Event / Lapse / Recoverable Lapse Opportunity / Recovery Rate / Recovery Time.
// See docs/phase-2-implementation-plan.md, Revision 2, section 3 for the full worked examples
// and the reasoning behind each definition below -- summarized in the doc comments here.
import type { Habit, HabitLog, HabitSchedulePeriod, LapseReasonEntry } from '../habit-types';
import { RECOVERY_CONFIG } from './config';
import { addDays, daysBetween, localDayKeyOf } from './day-key';
import { isDoneOnDay } from './habit-stats';
import { nextScheduledOpportunityAfter, scheduledOpportunitiesUpTo } from './schedule';

type OpportunityRecord = { date: string; completed: boolean };

function opportunityRecords(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): OpportunityRecord[] {
  return scheduledOpportunitiesUpTo(habit, periods, today).map((date) => ({
    date,
    completed: isDoneOnDay(habit, logs, date),
  }));
}

/**
 * One resolved pairwise (missed opportunity, immediately following opportunity) instance.
 * Recovery Rate measures recovery on the first available Scheduled Opportunity after a miss --
 * not eventual recovery within an unbounded or arbitrarily-windowed lapse. A long unbroken miss
 * streak therefore produces multiple resolved "not recovered" instances, one for each subsequent
 * scheduled opportunity missed before recovery -- this is intentional, not a bug: it's the only
 * reading that yields a well-defined, terminating computation without inventing an unspecified
 * "give up" timeout (see the plan's worked example C, "several misses with no return").
 */
export type RecoverableLapseInstance = {
  habitId: string;
  missedOpportunityDate: string;
  resolvingOpportunityDate: string;
  recovered: boolean;
};

/** A Recovery Event is exactly the "recovered" case of a RecoverableLapseInstance, at its resolving date. */
export type RecoveryEvent = { habitId: string; date: string };

/**
 * A closed Lapse: a maximal run of consecutive missed scheduled opportunities that eventually
 * ended in a completion. This is a deliberately coarser grain than RecoverableLapseInstance --
 * Recovery Time measures "when a real lapse happens, how long does it typically take to resolve",
 * which would be degenerate (always ~1 opportunity) if measured pairwise instead.
 */
export type ClosedLapse = {
  habitId: string;
  firstMissedDate: string;
  recoveredDate: string;
  recoveryTimeDays: number;
  /**
   * Consecutive missed Scheduled Opportunities in this lapse -- may differ from recoveryTimeDays
   * once a habit has a non-daily schedule (Phase 2 adds no UI for that yet, so the two are
   * currently always equal in practice, but Momentum State's evidence windows are opportunity-
   * counted, not calendar-day-counted, so this field is what those windows actually consume).
   */
  missedOpportunityCount: number;
};

export type RecoveryRateResult = {
  resolvedCount: number;
  recoveredCount: number;
  /** null when resolvedCount is 0 -- an undefined rate, never displayed as 0%. */
  rate: number | null;
  /**
   * Whether display rules allow showing `rate` as a percentage at all: at least
   * RECOVERY_CONFIG.minResolvedLapsesForPercentage resolved instances, and at or above
   * RECOVERY_CONFIG.lowRecoveryRateShameThreshold. Below either, prefer Recovery Time or Total
   * Completions instead (both computed elsewhere from raw logs) -- never a bare percentage.
   */
  displayAsPercentage: boolean;
};

/** Both Recovery Rate horizons, computed together -- see plan section 3 for why there's no material cost to doing so. Presentation choice is deferred to Phase 3. */
export type RecoveryRateSummary = {
  lifetime: RecoveryRateResult;
  rolling: RecoveryRateResult;
};

/** Every resolved (both recovered and not-recovered) pairwise instance in the habit's lifetime, ascending by date. */
export function recoverableLapseInstances(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): RecoverableLapseInstance[] {
  const records = opportunityRecords(habit, periods, logs, today);
  const instances: RecoverableLapseInstance[] = [];
  for (let i = 1; i < records.length; i += 1) {
    if (!records[i - 1].completed) {
      instances.push({
        habitId: habit.id,
        missedOpportunityDate: records[i - 1].date,
        resolvingOpportunityDate: records[i].date,
        recovered: records[i].completed,
      });
    }
  }
  return instances;
}

/** Recovery Events are the recovered subset of recoverableLapseInstances, at their resolving date. */
export function recoveryEvents(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): RecoveryEvent[] {
  return recoverableLapseInstances(habit, periods, logs, today)
    .filter((instance) => instance.recovered)
    .map((instance) => ({ habitId: habit.id, date: instance.resolvingOpportunityDate }));
}

/**
 * Whether `date` is a Recovery Event for `habit` -- convenience wrapper for the Phase 3 UI's
 * per-completion celebration check (kept here, not reimplemented in a screen, per the shared
 * domain layer requirement).
 */
export function isRecoveryEvent(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
  date: string,
): boolean {
  return recoveryEvents(habit, periods, logs, today).some((event) => event.date === date);
}

/** Every Lapse (maximal missed run) that has since closed via a completion -- an ongoing, unresolved run is excluded by design. */
export function closedLapses(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): ClosedLapse[] {
  const records = opportunityRecords(habit, periods, logs, today);
  const result: ClosedLapse[] = [];
  let runStart: string | null = null;
  let runLength = 0;
  for (const record of records) {
    if (!record.completed) {
      if (runStart === null) runStart = record.date;
      runLength += 1;
    } else if (runStart !== null) {
      result.push({
        habitId: habit.id,
        firstMissedDate: runStart,
        recoveredDate: record.date,
        recoveryTimeDays: daysBetween(runStart, record.date),
        missedOpportunityCount: runLength,
      });
      runStart = null;
      runLength = 0;
    }
  }
  return result;
}

/**
 * Mean Recovery Time across every lifetime closed Lapse; null below
 * RECOVERY_CONFIG.minClosedLapsesForRecoveryTime, not merely when none have closed yet -- a
 * single-Lapse average states more precision than one data point supports.
 */
export function averageRecoveryTime(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): number | null {
  const lapses = closedLapses(habit, periods, logs, today);
  if (lapses.length < RECOVERY_CONFIG.minClosedLapsesForRecoveryTime) return null;
  const total = lapses.reduce((sum, lapse) => sum + lapse.recoveryTimeDays, 0);
  return total / lapses.length;
}

/** Phase 4 -- the still-unresolved trailing run of missed Scheduled Opportunities, if any. */
export type OpenLapse = {
  habitId: string;
  firstMissedDate: string;
  missedOpportunityCount: number;
};

/**
 * The still-unresolved trailing run of missed Scheduled Opportunities, if any, evaluated as of
 * the day before `today` -- today's own opportunity is never itself judged as missed (consistent
 * with every other function in this module), so an open lapse can only be detected from
 * yesterday's opportunity backward. Returns null if the habit's most recent opportunity before
 * today was completed, or if it has no opportunities before today at all. A same-shape sibling of
 * closedLapses, not a redesign of it -- closedLapses stops at the last *closed* run; this only
 * looks at the tail run that hasn't closed (docs/phase-4-plan.md section 2.1).
 */
export function openLapse(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): OpenLapse | null {
  const records = opportunityRecords(habit, periods, logs, addDays(today, -1));
  let runStart: string | null = null;
  let runLength = 0;
  for (const record of records) {
    if (!record.completed) {
      if (runStart === null) runStart = record.date;
      runLength += 1;
    } else {
      runStart = null;
      runLength = 0;
    }
  }
  if (runStart === null) return null;
  return { habitId: habit.id, firstMissedDate: runStart, missedOpportunityCount: runLength };
}

/**
 * Whether the recovery card should currently be suppressed for `habit` because of a synced
 * LapseReasonEntry written during the *current* open lapse (i.e. created on or after the lapse's
 * firstMissedDate) -- the mechanism behind Skip and Reflect's suppression (docs/phase-4-plan.md
 * section 3.4). Returns the date suppression lifts, or null if no relevant entry exists (nothing
 * to suppress from this source -- callers still need to check the local-only fallback for
 * Continue/dismiss, section 8.6). Deliberately keys off each entry's createdAt (when the action
 * was actually taken), not its missedOpportunityDate (what the action's fact is about).
 */
export function lapseReasonSuppressionUntil(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  openLapseStart: string,
  today: string,
): string | null {
  const relevant = lapseReasons.filter(
    (entry) => entry.habitId === habit.id && localDayKeyOf(entry.createdAt) >= openLapseStart,
  );
  if (relevant.length === 0) return null;
  const mostRecent = relevant.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return nextScheduledOpportunityAfter(periods, habit, localDayKeyOf(mostRecent.createdAt));
}

function summarizeRate(instances: RecoverableLapseInstance[]): RecoveryRateResult {
  const resolvedCount = instances.length;
  const recoveredCount = instances.filter((instance) => instance.recovered).length;
  const rate = resolvedCount === 0 ? null : recoveredCount / resolvedCount;
  const displayAsPercentage =
    rate !== null &&
    resolvedCount >= RECOVERY_CONFIG.minResolvedLapsesForPercentage &&
    rate >= RECOVERY_CONFIG.lowRecoveryRateShameThreshold;
  return { resolvedCount, recoveredCount, rate, displayAsPercentage };
}

/**
 * Both Recovery Rate horizons: lifetime (every resolved instance ever) and rolling (the last
 * RECOVERY_CONFIG.rollingWindowOpportunities resolved instances, not a calendar-day window --
 * chosen to stay in the domain's own units, since a calendar-day window behaves very differently
 * for a daily habit vs. an infrequent one). Both are derived on read with no additional storage;
 * which one Phase 3 presents is an open presentation decision, not made here.
 */
export function recoveryRate(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): RecoveryRateSummary {
  const instances = recoverableLapseInstances(habit, periods, logs, today);
  const rollingInstances = instances.slice(-RECOVERY_CONFIG.rollingWindowOpportunities);
  return {
    lifetime: summarizeRate(instances),
    rolling: summarizeRate(rollingInstances),
  };
}
