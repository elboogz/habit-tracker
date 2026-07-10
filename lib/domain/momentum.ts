// Momentum / Momentum State, with a genuine candidate/confirmed hysteresis split. See
// docs/phase-2-implementation-plan.md, Revision 2, section 3, for the full reasoning --
// summarized in the doc comments below. This module retracts Revision 1's claim that evidence-
// window size alone provides hysteresis: a rolling window can still cross its own threshold the
// instant one new opportunity is added, which is not multi-opportunity evidence by itself.
import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { MOMENTUM_CONFIG } from './config';
import { isDoneOnDay } from './habit-stats';
import { closedLapses } from './recovery';
import { scheduledOpportunitiesUpTo } from './schedule';

export type MomentumStateKey =
  | 'insufficient_data'
  | 'building'
  | 'steady'
  | 'recovering'
  | 'rebuilding'
  | 'thriving'
  | 'quiet';

type OpportunityRecord = { date: string; completed: boolean };

function recordsUpTo(habit: Habit, periods: HabitSchedulePeriod[], logs: HabitLog[], asOfDate: string): OpportunityRecord[] {
  return scheduledOpportunitiesUpTo(habit, periods, asOfDate).map((date) => ({
    date,
    completed: isDoneOnDay(habit, logs, date),
  }));
}

function lastN(records: OpportunityRecord[], n: number): OpportunityRecord[] {
  return records.slice(-n);
}

function completionRate(records: OpportunityRecord[]): number {
  if (records.length === 0) return 0;
  return records.filter((record) => record.completed).length / records.length;
}

/**
 * An internal (never directly displayed) signed trend signal -- the difference between the
 * completion rate over the most recent `window` Scheduled Opportunities and the equally-sized
 * window immediately preceding it, clamped to [-1, 1]. Only Momentum *State* is user-facing.
 */
export function momentum(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  asOfDate: string,
  window: number,
): number {
  const records = recordsUpTo(habit, periods, logs, asOfDate);
  const recent = lastN(records, window);
  const priorWindow = records.slice(Math.max(0, records.length - window * 2), Math.max(0, records.length - window));
  const recentRate = completionRate(recent);
  // No prior window to compare against (a very new habit): treat as neutral (0), not a false signal.
  const priorRate = priorWindow.length === 0 ? recentRate : completionRate(priorWindow);
  return Math.max(-1, Math.min(1, recentRate - priorRate));
}

function meetsRateWindow(
  records: OpportunityRecord[],
  cfg: { window: number; minCompletionRate: number },
  options: { requireNoOpenLapse?: boolean; requireNoLapseAtAll?: boolean } = {},
): boolean {
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const rate = completionRate(window);
  if (rate < cfg.minCompletionRate) return false;
  if (options.requireNoLapseAtAll && window.some((record) => !record.completed)) return false;
  if (options.requireNoOpenLapse && !window[window.length - 1].completed) return false;
  return true;
}

function meetsBuilding(records: OpportunityRecord[]): boolean {
  const cfg = MOMENTUM_CONFIG.building;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const rate = completionRate(window);
  if (rate < cfg.minCompletionRate) return false;
  if (!cfg.requireImproving) return true;
  const priorWindow = records.slice(Math.max(0, records.length - cfg.window * 2), records.length - cfg.window);
  if (priorWindow.length === 0) return true; // no prior data to compare against -- don't penalize a very new habit
  return rate > completionRate(priorWindow);
}

function isCurrentlyQuiet(records: OpportunityRecord[]): boolean {
  const cfg = MOMENTUM_CONFIG.quiet;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  if (window[window.length - 1].completed) return false; // no open lapse right now
  const missedFraction = window.filter((record) => !record.completed).length / window.length;
  return missedFraction >= cfg.minMissedFraction;
}

function isRecentShortRecovery(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  asOfDate: string,
  records: OpportunityRecord[],
): boolean {
  const cfg = MOMENTUM_CONFIG.recovering;
  const window = lastN(records, cfg.window);
  const windowDates = new Set(window.map((record) => record.date));
  const lapses = closedLapses(habit, periods, logs, asOfDate);
  for (const lapse of lapses) {
    if (!windowDates.has(lapse.recoveredDate)) continue;
    if (lapse.missedOpportunityCount > cfg.maxPrecedingLapseLength) continue;
    const afterRecovery = records.filter((record) => record.date > lapse.recoveredDate);
    if (afterRecovery.every((record) => record.completed)) return true;
  }
  return false;
}

function isRebuilding(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  asOfDate: string,
  records: OpportunityRecord[],
): boolean {
  const cfg = MOMENTUM_CONFIG.rebuilding;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  if (!window[window.length - 1].completed) return false; // must currently be completing again, not still missing
  const windowDates = new Set(window.map((record) => record.date));
  const lapses = closedLapses(habit, periods, logs, asOfDate);
  return lapses.some((lapse) => lapse.missedOpportunityCount >= cfg.minPrecedingLapseLength && windowDates.has(lapse.recoveredDate));
}

/**
 * The raw, unhysteresed classification as of `asOfDate` -- recomputed fresh from schedule + logs
 * only, no memory of any prior evaluation. Evaluation order (first match wins): insufficient_data
 * -> recovering -> quiet -> best of {thriving, steady, building} -> rebuilding fallback -> building
 * (least committal default, only reached in genuinely ambiguous transition edges).
 */
export function candidateStateAt(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  asOfDate: string,
): MomentumStateKey {
  const records = recordsUpTo(habit, periods, logs, asOfDate);

  if (records.length < MOMENTUM_CONFIG.insufficientData.minScheduledOpportunities) return 'insufficient_data';

  if (isRecentShortRecovery(habit, periods, logs, asOfDate, records)) return 'recovering';

  if (isCurrentlyQuiet(records)) return 'quiet';

  if (meetsRateWindow(records, MOMENTUM_CONFIG.thriving, { requireNoLapseAtAll: true })) return 'thriving';
  if (meetsRateWindow(records, MOMENTUM_CONFIG.steady, { requireNoOpenLapse: true })) return 'steady';
  if (meetsBuilding(records)) return 'building';

  if (isRebuilding(habit, periods, logs, asOfDate, records)) return 'rebuilding';

  return 'building';
}

/**
 * The confirmed (displayed) Momentum State: a transition from one confirmed state to another
 * only takes effect once the candidate state has been the same *new* value for
 * MOMENTUM_CONFIG.transitionConfirmationOpportunities consecutive Scheduled Opportunities. A
 * single anomalous completion or miss can start a pending transition but cannot complete one.
 *
 * This is a single deterministic forward scan over the habit's entire Scheduled Opportunity
 * history -- entirely derived (schedule periods + logs only), with no persisted momentum state
 * of any kind. The trade-off, surfaced rather than silently adopted: this is O(n) evaluations of
 * candidateStateAt, each of which is itself not O(1) (it re-derives records/lapses from scratch),
 * so confirmedStateAt's real cost grows faster than linearly with a habit's lifetime opportunity
 * count. At this app's actual scale (a personal habit tracker; a multi-year daily habit is on the
 * order of ~1,000 opportunities) this is not a practical concern today. If usage ever made it one,
 * the natural optimization would be to cache the last confirmed state and the date it was last
 * confirmed, and only rescan forward from there -- which would be a form of stored state,
 * reintroducing exactly the trade-off against the derived-on-read architecture this module
 * currently avoids. Not adopted now; noted here as a known future option only.
 */
export function confirmedStateAt(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): MomentumStateKey {
  const opportunities = scheduledOpportunitiesUpTo(habit, periods, today);
  const candidates = opportunities.map((date) => candidateStateAt(habit, periods, logs, date));
  return computeConfirmedState(candidates, 'insufficient_data', MOMENTUM_CONFIG.transitionConfirmationOpportunities);
}

/**
 * The generic hysteresis mechanism, factored out from confirmedStateAt so it can be tested
 * directly against synthetic sequences (e.g. proving flapping between two values never confirms
 * a transition) independent of any particular real habit-history pattern. `values` is the
 * candidate value at each successive evaluation point, in order; `confirmationCount` consecutive
 * agreeing values are required before a transition away from the current confirmed value takes
 * effect.
 */
export function computeConfirmedState<T>(values: T[], initial: T, confirmationCount: number): T {
  let confirmed = initial;
  let pendingValue: T | null = null;
  let pendingCount = 0;

  for (const candidate of values) {
    if (candidate === confirmed) {
      pendingValue = null;
      pendingCount = 0;
    } else if (candidate === pendingValue) {
      pendingCount += 1;
      if (pendingCount >= confirmationCount) {
        confirmed = candidate;
        pendingValue = null;
        pendingCount = 0;
      }
    } else {
      pendingValue = candidate;
      pendingCount = 1;
    }
  }
  return confirmed;
}
