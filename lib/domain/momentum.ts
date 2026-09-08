// Momentum / Momentum State, with a genuine candidate/confirmed hysteresis split. See
// docs/phase-2-implementation-plan.md, Revision 2, section 3, for the full reasoning --
// summarized in the doc comments below. This module retracts Revision 1's claim that evidence-
// window size alone provides hysteresis: a rolling window can still cross its own threshold the
// instant one new opportunity is added, which is not multi-opportunity evidence by itself.
import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { MOMENTUM_CONFIG } from './config';
import { isDoneOnDay } from './habit-stats';
import { closedLapses, type ClosedLapse } from './recovery';
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

/**
 * Whether `record` is today's own opportunity and it hasn't been completed yet -- not evidence of
 * either a completion or a miss, just not yet resolved. The scheduling side (`records.length` and
 * every window-size/sufficiency check) counts this record regardless; the evidence side (every
 * predicate below that inspects `.completed` values) sets it aside via `resolvedView` before
 * judging, per the settled current-day design (docs/phase-4-completion-report.md, "Current-day
 * design, settled: scheduling fact vs. evidence judgment").
 */
function isPending(record: OpportunityRecord, today: string): boolean {
  return record.date === today && !record.completed;
}

function resolvedView(records: OpportunityRecord[], today: string): OpportunityRecord[] {
  return records.filter((record) => !isPending(record, today));
}

function completionRate(records: OpportunityRecord[], today: string): number {
  const resolved = resolvedView(records, today);
  if (resolved.length === 0) return 0;
  return resolved.filter((record) => record.completed).length / resolved.length;
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
  today: string,
  window: number,
): number {
  const records = recordsUpTo(habit, periods, logs, asOfDate);
  const recent = lastN(records, window);
  const priorWindow = records.slice(Math.max(0, records.length - window * 2), Math.max(0, records.length - window));
  const recentRate = completionRate(recent, today);
  // No prior window to compare against (a very new habit): treat as neutral (0), not a false signal.
  const priorRate = priorWindow.length === 0 ? recentRate : completionRate(priorWindow, today);
  return Math.max(-1, Math.min(1, recentRate - priorRate));
}

function meetsRateWindow(
  records: OpportunityRecord[],
  cfg: { window: number; minCompletionRate: number },
  today: string,
  options: { requireNoOpenLapse?: boolean; requireNoLapseAtAll?: boolean } = {},
): boolean {
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const rate = completionRate(window, today);
  if (rate < cfg.minCompletionRate) return false;
  const resolved = resolvedView(window, today);
  if (options.requireNoLapseAtAll && resolved.some((record) => !record.completed)) return false;
  if (options.requireNoOpenLapse && !resolved[resolved.length - 1].completed) return false;
  return true;
}

function meetsBuilding(records: OpportunityRecord[], today: string): boolean {
  const cfg = MOMENTUM_CONFIG.building;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const rate = completionRate(window, today);
  if (rate < cfg.minCompletionRate) return false;
  if (!cfg.requireImproving) return true;
  const priorWindow = records.slice(Math.max(0, records.length - cfg.window * 2), records.length - cfg.window);
  if (priorWindow.length === 0) return true; // no prior data to compare against -- don't penalize a very new habit
  return rate > completionRate(priorWindow, today);
}

function isCurrentlyQuiet(records: OpportunityRecord[], today: string): boolean {
  const cfg = MOMENTUM_CONFIG.quiet;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const resolved = resolvedView(window, today);
  if (resolved[resolved.length - 1].completed) return false; // no open lapse right now
  const missedFraction = resolved.filter((record) => !record.completed).length / resolved.length;
  return missedFraction >= cfg.minMissedFraction;
}

/**
 * Takes `lapses` (every closed Lapse as of the day being classified) as a parameter rather than
 * deriving it internally, so a single `closedLapses` result -- however it was obtained -- can be
 * shared with `isRebuildingFromLapses` below and, since Step 2a (docs/phase-5-plan.md section 5),
 * with `confirmedStateAt`'s precomputed walk. `candidateStateAt` still passes exactly
 * `closedLapses(habit, periods, logs, asOfDate)`, so this is a pure code-motion split of the
 * previous `isRecentShortRecovery`, not a behavioural change: the two are the same function with
 * the shared subexpression pulled out to its one caller.
 */
function isRecentShortRecoveryFromLapses(records: OpportunityRecord[], lapses: ClosedLapse[], today: string): boolean {
  const cfg = MOMENTUM_CONFIG.recovering;
  const window = lastN(records, cfg.window);
  const windowDates = new Set(window.map((record) => record.date));
  for (const lapse of lapses) {
    if (!windowDates.has(lapse.recoveredDate)) continue;
    if (lapse.missedOpportunityCount > cfg.maxPrecedingLapseLength) continue;
    const afterRecovery = records.filter((record) => record.date > lapse.recoveredDate);
    const resolvedAfterRecovery = resolvedView(afterRecovery, today);
    if (resolvedAfterRecovery.every((record) => record.completed)) return true;
  }
  return false;
}

/** See isRecentShortRecoveryFromLapses's doc comment -- same split, same reasoning, for isRebuilding. */
function isRebuildingFromLapses(records: OpportunityRecord[], lapses: ClosedLapse[], today: string): boolean {
  const cfg = MOMENTUM_CONFIG.rebuilding;
  const window = lastN(records, cfg.window);
  if (window.length < cfg.window) return false;
  const resolved = resolvedView(window, today);
  if (resolved.length === 0 || !resolved[resolved.length - 1].completed) return false; // must currently be completing again, not still missing
  const windowDates = new Set(window.map((record) => record.date));
  return lapses.some((lapse) => lapse.missedOpportunityCount >= cfg.minPrecedingLapseLength && windowDates.has(lapse.recoveredDate));
}

/**
 * The raw, unhysteresed classification, given every Scheduled Opportunity record up to and
 * including the day being classified (`records`) and exactly what `closedLapses(habit, periods,
 * logs, <that same day>)` would return (`lapses`). Evaluation order (first match wins):
 * insufficient_data -> recovering -> quiet -> thriving/steady -> rebuilding -> building (least
 * committal default, reached whenever nothing more specific claims the day).
 *
 * Extracted from `candidateStateAt` in Step 2a (docs/phase-5-plan.md section 5) so there is
 * exactly one implementation of the evaluation order and its rules -- shared, unchanged, between
 * `candidateStateAt`'s own per-call computation below and `confirmedStateAt`'s precomputed,
 * sliced walk. Callers differ only in how cheaply they obtain `records`/`lapses`; this function
 * has no opinion on that and performs no lookup of its own.
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
 *
 * `today` is the real, live current day -- distinct from the day `records`/`lapses` are bounded
 * at, which may be an earlier date than `today` when this is called as one step of
 * `confirmedStateAt`'s walk. `records.length`/every window-size check is a scheduling fact and
 * reaches full size the instant that day is scheduled, regardless of completion; the
 * evidence-inspecting helpers above (`completionRate`, `isCurrentlyQuiet`, `meetsRateWindow`,
 * `meetsBuilding`, `isRebuildingFromLapses`, `isRecentShortRecoveryFromLapses`) each set aside the
 * final record when its date equals `today` and it's unlogged, per "today is never classified as
 * missed" -- never for any earlier record, which is always a fully-resolved past fact regardless
 * of `today`. No default: every caller must state which day is live. See
 * docs/phase-4-completion-report.md, "Current-day design, settled: scheduling fact vs. evidence
 * judgment" and the section below it.
 */
function classifyFromRecords(records: OpportunityRecord[], lapses: ClosedLapse[], today: string): MomentumStateKey {
  if (records.length < MOMENTUM_CONFIG.insufficientData.minScheduledOpportunities) return 'insufficient_data';

  if (isRecentShortRecoveryFromLapses(records, lapses, today)) return 'recovering';

  if (isCurrentlyQuiet(records, today)) return 'quiet';

  if (meetsRateWindow(records, MOMENTUM_CONFIG.thriving, today, { requireNoLapseAtAll: true })) return 'thriving';
  if (meetsRateWindow(records, MOMENTUM_CONFIG.steady, today, { requireNoOpenLapse: true })) return 'steady';

  if (isRebuildingFromLapses(records, lapses, today)) return 'rebuilding';

  if (meetsBuilding(records, today)) return 'building';

  return 'building';
}

/**
 * The raw, unhysteresed classification as of `asOfDate` -- recomputed fresh from schedule + logs
 * only, no memory of any prior evaluation. See `classifyFromRecords` above for the evaluation
 * order and rules; this function's only job is to derive `records` and `lapses` for `asOfDate`
 * the direct way (a fresh `recordsUpTo`/`closedLapses` call each time), which is the correct,
 * simplest implementation for a function that may be called with any `asOfDate` in isolation.
 * `confirmedStateAt` below does not call this function -- its own walk needs the same two values
 * far more cheaply than deriving them fresh at every step would allow (Step 2a,
 * docs/phase-5-plan.md section 5), so it obtains them its own way and calls
 * `classifyFromRecords` directly.
 */
export function candidateStateAt(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  asOfDate: string,
  today: string,
): MomentumStateKey {
  const records = recordsUpTo(habit, periods, logs, asOfDate);
  const lapses = closedLapses(habit, periods, logs, asOfDate);
  return classifyFromRecords(records, lapses, today);
}

/**
 * A per-`confirmedStateAt`-call completion lookup, replacing repeated linear scans of the full
 * `logs` array (Step 2a, docs/phase-5-plan.md section 5). Reproduces `isDoneOnDay`
 * (lib/domain/habit-stats.ts) exactly -- same fields, same rule (a reduced completion always
 * counts; otherwise total count against target for count habits, otherwise any log at all for
 * simple habits) -- for every date in `dates`, computed once from `habit.id`'s own logs grouped
 * by date rather than filtering `logs` (which may hold every habit's history, not just this
 * one's) once per date. `habit-stats.ts` itself is not touched: this is a local, momentum.ts-only
 * mirror used solely to build `confirmedStateAt`'s once-per-call records, never a second
 * definition of what "done" means -- `isDoneOnDay` remains the single source of truth for
 * every other caller, including `candidateStateAt` above via the unmodified `recordsUpTo`.
 * Every date actually needed is passed in and given an explicit entry, so a lookup can never
 * silently fall through to a default for a date this function was not asked about.
 *
 * Must remain behaviourally equivalent to `isDoneOnDay`; review this index whenever completion
 * semantics change there. Nothing detects drift between the two automatically -- see the residual
 * risk register in docs/phase-5-plan.md section 10.
 */
function buildCompletionIndex(habit: Habit, logs: HabitLog[], dates: string[]): Map<string, boolean> {
  const logsByDate = new Map<string, HabitLog[]>();
  for (const log of logs) {
    if (log.habitId !== habit.id) continue;
    const bucket = logsByDate.get(log.date);
    if (bucket) bucket.push(log);
    else logsByDate.set(log.date, [log]);
  }

  const completionByDate = new Map<string, boolean>();
  for (const date of dates) {
    const dayLogs = logsByDate.get(date) ?? [];
    const reduced = dayLogs.some((log) => log.reduced);
    const total = dayLogs.reduce((sum, log) => sum + log.count, 0);
    const done = reduced || (habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0);
    completionByDate.set(date, done);
  }
  return completionByDate;
}

/**
 * The confirmed (displayed) Momentum State: a transition from one confirmed state to another
 * only takes effect once the candidate state has been the same *new* value for
 * MOMENTUM_CONFIG.transitionConfirmationOpportunities consecutive Scheduled Opportunities. A
 * single anomalous completion or miss can start a pending transition but cannot complete one.
 *
 * This is a single deterministic forward scan over the habit's entire Scheduled Opportunity
 * history -- entirely derived (schedule periods + logs only), with no persisted momentum state
 * of any kind, and no change to that architecture from the optimisation below (docs/phase-5-plan.md
 * section 5, "Step 2a"): every value is still recomputed from `habit`/`periods`/`logs` on every
 * call, nothing is cached across calls, and no second hysteresis mechanism is introduced --
 * `computeConfirmedMomentumState` below, unchanged, remains the only place a transition is
 * decided.
 *
 * **What changed, and why it's still exactly equivalent.** The original implementation called
 * `candidateStateAt` once per Scheduled Opportunity, and `candidateStateAt` re-derives
 * `recordsUpTo` and `closedLapses` from the habit's creation on every call -- O(n) evaluations
 * each doing O(i) work, before `isDoneOnDay`'s own per-date linear scan of `logs` is even
 * counted. `recordsUpTo`/`closedLapses` are both pure functions of `asOfDate` alone, and every
 * `asOfDate` this walk ever asks about is one particular element of the single ascending sequence
 * `scheduledOpportunitiesUpTo(habit, periods, today)` -- so records "up to" the i-th opportunity
 * are always exactly a length-(i+1) prefix of the records "up to" `today`, and closed lapses "as
 * of" the i-th opportunity are always exactly the subset of closed lapses "as of" `today` whose
 * `recoveredDate` falls at or before it (both follow from `closedLapses`/`opportunityRecords`
 * being pure, strictly left-to-right forward scans with no lookahead: truncating the full-history
 * trace after processing a given record yields exactly what running the same scan on that prefix
 * alone would have produced). This function computes each of the two once, for the full range,
 * and reuses a slice/subset per step instead of re-deriving from scratch -- the completion index
 * above replaces `isDoneOnDay`'s own repeated per-date scan the same way. Every step still calls
 * the same, unmodified `classifyFromRecords` used by `candidateStateAt`, so the classification
 * rules themselves are touched by nothing here.
 */
export function confirmedStateAt(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): MomentumStateKey {
  const opportunities = scheduledOpportunitiesUpTo(habit, periods, today);
  const completionByDate = buildCompletionIndex(habit, logs, opportunities);
  const allRecords: OpportunityRecord[] = opportunities.map((date) => ({
    date,
    completed: completionByDate.get(date) ?? false,
  }));

  // Closed lapses "as of" the i-th opportunity are exactly the subset of the full-history closed
  // lapses whose recoveredDate falls at or before that opportunity's date -- see this function's
  // doc comment above. allLapses is ascending by recoveredDate because closedLapses discovers
  // them via a single left-to-right scan and only ever appends, so a two-pointer walk in lockstep
  // with the ascending opportunity list reaches the identical per-step subset in amortized O(1)
  // per step rather than re-deriving it from scratch at every step.
  const allLapses = closedLapses(habit, periods, logs, today);
  let lapseCursor = 0;
  const lapsesSoFar: ClosedLapse[] = [];

  const candidates: MomentumStateKey[] = [];
  for (let i = 0; i < allRecords.length; i += 1) {
    const asOfDate = allRecords[i].date;
    while (lapseCursor < allLapses.length && allLapses[lapseCursor].recoveredDate <= asOfDate) {
      lapsesSoFar.push(allLapses[lapseCursor]);
      lapseCursor += 1;
    }
    // Every walk step gets the same real `today`, not its own date as a stand-in for it -- each
    // earlier opportunity is a resolved past fact by the time it's scanned, and only the walk's
    // final step (date === today) can ever have a pending record to set aside.
    const recordsSoFar = allRecords.slice(0, i + 1);
    candidates.push(classifyFromRecords(recordsSoFar, lapsesSoFar, today));
  }

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
 * The positive-family evidence floor (approved -- see docs/phase-4-completion-report.md's
 * "Confirmation-mechanism blocker" section and its resolution). Rule 2 below needs a per-candidate
 * rank to take a window minimum over; `EVIDENCE_RANK` alone leaves `recovering`/`rebuilding`/`quiet`
 * undefined, which is why a window containing any of them has always failed Rule 2's
 * chain-comparability check entirely (Rule 3, retain).
 *
 * `recovering` and `rebuilding` are positive-family: both require, by their own `classifyFromRecords`
 * definition (`isRecentShortRecoveryFromLapses`, `isRebuildingFromLapses`), that the window's most
 * recent opportunity was itself a completion -- closing a lapse is affirmative evidence, not an
 * absence of it. This floor gives Rule 2's minimum calculation a value for them: the chain's weakest rung
 * (`EVIDENCE_RANK.building`), and no more. It orders nothing: it draws no distinction between
 * `recovering` and `rebuilding` (both map to the identical floor value), and it says nothing about
 * either relative to any chain state beyond that one fixed value -- a window containing one can
 * never raise the confirmed state past `building` (Math.min can never exceed the floor value once
 * any window member contributes it), regardless of how strong the window's other members are.
 * `quiet` (negative-family -- requires the window's most recent opportunity to be a miss) is
 * deliberately untouched: it has no entry here, so it continues to make `window.every(...)` fail
 * and block Rule 2 outright whenever it appears, exactly as before this floor existed.
 *
 * This is a *narrower* rank than `EVIDENCE_RANK`, used only inside Rule 2's minimum calculation --
 * never exported, never merged into `EVIDENCE_RANK` itself, and never used to decide whether
 * `confirmed` (the current confirmed state) is chain-comparable: that check still reads
 * `EVIDENCE_RANK[confirmed]` directly, so an off-chain confirmed state (`quiet`/`recovering`/
 * `rebuilding`) still can only ever be left via Rule 1's exact-match rule, unchanged.
 */
function rule2EvidenceRank(state: MomentumStateKey): number | undefined {
  if (state === 'recovering' || state === 'rebuilding') return EVIDENCE_RANK.building;
  return EVIDENCE_RANK[state];
}

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
 * 2. Otherwise, if every candidate in the window has a Rule 2 rank (`rule2EvidenceRank`, above --
 *    the four chain states directly, plus `recovering`/`rebuilding` credited at the chain's weakest
 *    rung via the approved positive-family evidence floor; `quiet` still has none) *and* the current
 *    confirmed state is itself chain-comparable, take the minimum rank across the window. If that
 *    rank is strictly higher than the current confirmed state's rank, raise the confirmed state to
 *    it. This can only ever raise -- never lower -- and it never fires against an off-chain
 *    confirmed state (`quiet`/`recovering`/`rebuilding` can only be left via Rule 1's exact-match
 *    rule: `confirmed`'s own comparability still reads `EVIDENCE_RANK[confirmed]` directly, never
 *    the floor, so the floor only ever supplies a rank for window *members*).
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
 * writeup, and its "Confirmation-mechanism blocker resolved" section for the positive-family
 * evidence floor's own exhaustive verification (same sweeps, re-run after the floor).
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
    if (confirmedRank !== undefined && window.every((c) => rule2EvidenceRank(c) !== undefined)) {
      const windowMinRank = Math.min(...window.map((c) => rule2EvidenceRank(c) as number));
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
