// Recovery Event / Lapse / Recoverable Lapse Opportunity / Recovery Rate / Recovery Time.
// See docs/phase-2-implementation-plan.md, Revision 2, section 3 for the full worked examples
// and the reasoning behind each definition below -- summarized in the doc comments here.
import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { RECOVERY_CONFIG } from './config';
import { daysBetween } from './day-key';
import { isDoneOnDay } from './habit-stats';
import { scheduledOpportunitiesUpTo } from './schedule';

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

/** Mean Recovery Time across every lifetime closed Lapse; null if none have closed yet. */
export function averageRecoveryTime(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): number | null {
  const lapses = closedLapses(habit, periods, logs, today);
  if (lapses.length === 0) return null;
  const total = lapses.reduce((sum, lapse) => sum + lapse.recoveryTimeDays, 0);
  return total / lapses.length;
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
