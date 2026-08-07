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
 * -> recovering -> quiet -> thriving/steady -> rebuilding -> building (least committal default,
 * reached whenever nothing more specific claims the day).
 *
 * `rebuilding` is checked ahead of `building`, not after it as a fallback -- see
 * docs/phase-4-completion-report.md's "Momentum evaluation precedence" post-completion fix. With
 * `building`'s bar this low (60% over just 3 opportunities, only required to improve on the prior
 * window when one exists), it would otherwise claim nearly every day immediately following a
 * qualifying (>=3-miss) lapse's recovery before `rebuilding`'s own 3-opportunity confirmation
 * window could ever complete, making `rebuilding` reachable as a *candidate* but never as a
 * *confirmed*, displayed state -- proven by exhaustive search over the full history space up to
 * 14 opportunities prior to this fix. `thriving`/`steady` still take precedence over `rebuilding`
 * when genuinely met, since sustained strong evidence should supersede a trailing "still
 * rebuilding" read, matching the plan's `long_term_improving_trajectory` worked example
 * (`docs/phase-2-implementation-plan.md` section 8's fixture table: confirmed sequence
 * insufficient_data -> quiet/rebuilding -> building -> steady -> thriving).
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

  if (isRebuilding(habit, periods, logs, asOfDate, records)) return 'rebuilding';

  if (meetsBuilding(records)) return 'building';

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
  return computeConfirmedMomentumState(candidates);
}

/**
 * The ordered evidence chain used only by `computeConfirmedMomentumState`'s Rule 2 below -- NOT a
 * claim that all seven `MomentumStateKey` values form a single "goodness" ordering (the product
 * deliberately avoids that framing; see docs/phase-3-experience-plan.md section 7.1's non-shame
 * labeling). Only these four are chain-comparable: each requires strictly more/stronger positive
 * evidence than the last (window 0/3/5/8 opportunities, minimum completion rate --/60%/80%/90%,
 * per MOMENTUM_CONFIG). `recovering`, `rebuilding`, and `quiet` are classified by lapse
 * recency/length, not a rate bar, and are deliberately left out -- an off-chain state can only
 * ever be entered or left via Rule 1 (three identical consecutive candidates), exactly as before.
 */
const EVIDENCE_CHAIN: MomentumStateKey[] = ['insufficient_data', 'building', 'steady', 'thriving'];
const EVIDENCE_RANK: Partial<Record<MomentumStateKey, number>> = Object.fromEntries(
  EVIDENCE_CHAIN.map((state, index) => [state, index]),
);

/**
 * Momentum-specific hysteresis. Fixes a real gap in the generic `computeConfirmedState` below --
 * found by the exhaustive today-open-vs-today-completed monotonicity search over the
 * `insufficient_data < building < steady < thriving` chain (0 violations at the candidate level,
 * 1 at the confirmed level): a habit completed on days 1-4 (candidates insufficient_data,
 * insufficient_data, building, building) produces candidate `steady` on day 5 if day 5 is also
 * completed (a 5-opportunity 100% window now qualifies). Plain `computeConfirmedState` resets its
 * pending count on any change of candidate value, discarding `building`'s already-accumulated
 * count of 2, so confirmed is left at `insufficient_data` -- *lower* than the `building` badge the
 * same habit would show had day 5 been left incomplete. Completing today should never make the
 * displayed badge read worse.
 *
 * A first fix (kept here only as a rejected alternative in history/discussion, not in code) let a
 * pending run continue past a *stronger* chain candidate by tracking a "floor" and confirming it
 * once held (directly or via stronger stand-ins) for 3 opportunities. That resolved the target
 * violation but broke the locked `perfect_completion_history` fixture
 * (docs/phase-2-implementation-plan.md section 8: "confirmed at opportunity 10" for `thriving`)
 * by delaying *every* smoothly-improving trajectory by roughly one confirmation cycle -- inherent
 * to "a rung must be earned as its own 3-in-a-row before the next rung's evidence can count",
 * since a stronger candidate arriving mid-run got spent confirming the weaker floor instead of
 * contributing to its own tally.
 *
 * **Implemented instead: confirmation as a property of the trailing `transitionConfirmationOpportunities`
 * candidates, not a stateful pending counter that one rung "owns" and therefore consumes.** At
 * every opportunity once at least that many candidates exist, look at the trailing window and
 * apply, in order:
 *
 * 1. If all candidates in the window are identical, confirm that value. Unchanged from the
 *    original algorithm; this is the *only* rule that ever governs the off-chain states `quiet`,
 *    `recovering`, `rebuilding`, exactly as before, and the *only* rule that can ever move the
 *    confirmed state to a lower rung (a decline within the chain, e.g. `thriving` -> `building`,
 *    still requires 3 consecutive identical weaker candidates -- one anomalous reading is never
 *    enough, same hysteresis protection against volatile decline as always).
 * 2. Otherwise, if every candidate in the window is chain-comparable *and* the current confirmed
 *    state is itself chain-comparable, take the minimum rank across the window. If that rank is
 *    strictly higher than the current confirmed state's rank, raise the confirmed state to it.
 *    This can only ever raise -- never lower -- and it never fires against an off-chain confirmed
 *    state (`quiet`/`recovering`/`rebuilding` can only be left via Rule 1's exact-match rule,
 *    since the approved specification gives no ordering between an off-chain state and the chain).
 * 3. Otherwise, the confirmed state is unchanged.
 *
 * Why this doesn't weaken the 3-opportunity confirmation requirement, and how it differs from the
 * rejected reading above: the requirement is satisfied as "the trailing 3 opportunities each
 * showed *at least* this much evidence" -- Rule 2 takes the *minimum* of the window, so it can
 * only ever confirm a rung *at or below* what all 3 opportunities support, never a rung stronger
 * than any of them individually earned. `steady` can still only ever confirm via Rule 1 (3
 * trailing candidates that are all exactly `steady`) or via Rule 2 crediting `steady` as the
 * window's minimum (which requires none of the 3 to be weaker than `steady`) -- never by
 * absorbing a weaker pending run the way the rejected reading did. Because Rule 1 alone still
 * drives every same-value 3-in-a-row exactly as before, a smoothly improving trajectory's real
 * transition timing is unaffected by Rule 2's extra, purely-informative early nudge to a lower
 * rung it has already earned: `perfect_completion_history`
 * (docs/phase-2-implementation-plan.md section 8) still confirms `steady` at opportunity 7 and
 * `thriving` at opportunity 10, exactly as locked -- proven directly in
 * `lib/domain/momentum.exhaustive.test.ts`, whose "unranked" console output and 12-day exhaustive
 * chain sweep (0 violations at both candidate and confirmed level) back the rest of this comment;
 * see docs/phase-4-completion-report.md's "Momentum confirmation mechanism" section for the full
 * writeup.
 */
export function computeConfirmedMomentumState(candidates: MomentumStateKey[]): MomentumStateKey {
  let confirmed: MomentumStateKey = 'insufficient_data';
  const windowSize = MOMENTUM_CONFIG.transitionConfirmationOpportunities;

  for (let i = 0; i < candidates.length; i += 1) {
    if (i + 1 < windowSize) continue; // not enough opportunities yet for a trailing window

    const window = candidates.slice(i - windowSize + 1, i + 1);

    if (window.every((c) => c === window[0])) {
      confirmed = window[0];
      continue;
    }

    const confirmedRank = EVIDENCE_RANK[confirmed];
    if (confirmedRank !== undefined && window.every((c) => EVIDENCE_RANK[c] !== undefined)) {
      const windowMinRank = Math.min(...window.map((c) => EVIDENCE_RANK[c] as number));
      if (windowMinRank > confirmedRank) {
        confirmed = EVIDENCE_CHAIN[windowMinRank];
      }
    }
    // else: neither rule applies -- confirmed is unchanged (Rule 3).
  }

  return confirmed;
}

/**
 * NOT the production Momentum confirmation implementation. `confirmedStateAt` calls
 * `computeConfirmedMomentumState` above, not this function -- this is a legacy pending-counter
 * formulation, retained only as a generic hysteresis primitive for direct synthetic-sequence
 * testing (e.g. proving flapping between two arbitrary values, unrelated to any `MomentumStateKey`,
 * never confirms a transition), independent of any particular real habit-history pattern.
 *
 * The pending-counter approach (a transition "owns" and consumes `confirmationCount` opportunities
 * once started) was intentionally rejected as the production mechanism: it delayed every improving
 * trajectory by approximately one confirmation cycle and broke the locked Phase 2 behavioural
 * fixtures (`docs/phase-2-implementation-plan.md` §8) -- see `computeConfirmedMomentumState`'s doc
 * comment above for the full account. Any future behavioural change to Momentum confirmation must
 * be made to `computeConfirmedMomentumState`, never to this helper.
 *
 * `values` is the candidate value at each successive evaluation point, in order; `confirmationCount`
 * consecutive agreeing values are required before a transition away from the current confirmed
 * value takes effect.
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
