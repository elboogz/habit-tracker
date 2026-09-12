// Phase 5, Step 2 part 2 (docs/phase-5-plan.md section 4.2): the single deterministic producer of
// the closed, per-habit factual payload passed to AI coaching generation and to the numeric
// validator (lib/domain/coach-validation.ts) that checks its output. `buildCoachFacts` is the only
// exported producer -- no consumer should construct, partially assemble, or recompute any part of
// this payload independently; every field is derived by calling the same authoritative domain
// functions Progress and Habit Detail already use (confirmedStateAt, recoveryRate,
// averageRecoveryTime, recoveryEvents, totalCompletions, consistency, habitHealthVerdict), never by
// reimplementing their logic here.
//
// Field closure, per the approved list (docs/phase-5-plan.md section 4.2's table): confirmed
// Momentum State, Recovery Rate (rolling only -- lifetime has no identified coaching use),
// Average Recovery Time, Total Completions, schedule-aware Consistency, the window Scheduled
// Opportunity count that is Consistency's own denominator, recovery count, lapse-reason
// distribution, and the three-state Habit Health verdict. Lifetime Recovery Rate, the lifetime
// Scheduled Opportunity count, habit edits and reminder usage (A3), the Habit Health comparison
// rates themselves, and anything derived from momentum(..., window) are all structurally absent --
// this module does not import lib/domain/momentum.ts's momentum() at all, and does not read
// anything from RecoveryRateResult beyond what the display-gate logic below explicitly forwards.
//
// Every numeric fact is pre-rounded to its single canonical rendering at construction time, never
// left to the validator to reconcile: rates round to whole percent (Math.round(rate * 100)),
// matching app/(tabs)/progress.tsx's own Math.round((result.rate ?? 0) * 100) and
// Math.round(value * 100); Average Recovery Time rounds to one decimal place, matching that same
// screen's avgRecoveryDays.toFixed(1). This is a deliberate design choice, not settled verbatim in
// the plan text (see the Step 2 part 2 report's interpretation notes): all rounding happens once,
// here, so lib/domain/coach-validation.ts can do exact equality rather than carrying its own
// tolerance band -- keeping "nearby but incorrect" rejection airtight.
import type { Habit, HabitLog, HabitSchedulePeriod, LapseReasonEntry, LapseReasonKey } from '../habit-types';
import { CONSISTENCY_WINDOW_DAYS_BY_KIND, type CoachFactsKind } from './config';
import { type HabitHealthVerdict, habitHealthVerdict } from './habit-health';
import { confirmedStateAt, type MomentumStateKey } from './momentum';
import { averageRecoveryTime, recoveryEvents, recoveryRate } from './recovery';
import { consistency, totalCompletions } from './habit-stats';
import { scheduledOpportunitiesInWindow } from './schedule';

// `CoachFactsKind` and `CONSISTENCY_WINDOW_DAYS_BY_KIND` are defined in ./config, alongside every
// other Phase 2+ domain threshold, and re-exported here (placement correction -- an earlier draft
// defined both locally in this file, while config.ts was outside Step 2 part 2's hard boundary and
// the 14/7/30 values were still unsettled; now settled, the mechanical placement follows) so this
// module's own consumers never need to know the type or the mapping originates elsewhere.
export type { CoachFactsKind };

/** `LapseReasonEntry.reason` is `LapseReasonKey | null` (null = skipped without stating why); this closes that over one flat, always-fully-populated distribution key. */
export type LapseReasonDistributionKey = LapseReasonKey | 'skipped_without_reason';

const LAPSE_REASON_DISTRIBUTION_KEYS: LapseReasonDistributionKey[] = [
  'too_busy',
  'forgot',
  'low_energy',
  'not_feeling_it',
  'something_else',
  'skipped_without_reason',
];

/**
 * The closed, per-habit factual record. Flat and numeric-leaved except for the three named
 * closed-categorical exceptions (`momentumState`, `habitHealth`, and `lapseReasonCounts`' keys) --
 * per docs/phase-5-plan.md's field-closure table, each optional field is present only when the
 * corresponding domain display gate says the value may be shown, and is otherwise **structurally
 * absent from the object** (the key itself is omitted, never present with `null` or `undefined`),
 * so a suppressed value can never be validly quoted because it is never in the payload to quote.
 */
export type HabitCoachFacts = {
  habitId: string;
  momentumState: MomentumStateKey;
  totalCompletions: number;
  recoveryCount: number;
  /** Rolling Recovery Rate, whole percent, 0-100. Present only when RecoveryRateResult.displayAsPercentage is true. */
  recoveryRatePct?: number;
  /** Mean Recovery Time in days, rounded to one decimal place (docs/phase-5-plan.md section 4.2's Step 2 part 2 amendment records this rounding explicitly). Present only when averageRecoveryTime is non-null (>= RECOVERY_CONFIG.minClosedLapsesForRecoveryTime closed Lapses). */
  averageRecoveryTimeDays?: number;
  /** Schedule-aware Consistency over the trailing per-kind window (CONSISTENCY_WINDOW_DAYS_BY_KIND), whole percent, 0-100. Present only when the window contains at least one Scheduled Opportunity. */
  consistencyPct?: number;
  /** The Scheduled Opportunity count in that same window -- Consistency's own denominator. Present under the same condition as consistencyPct, never independently. */
  consistencyWindowOpportunities?: number;
  /** Always present, all six keys always populated (0 where no entries exist) -- a closed distribution, never a sparse one. */
  lapseReasonCounts: Record<LapseReasonDistributionKey, number>;
  /** Always present, including insufficient_evidence -- see docs/phase-5-plan.md section 4.2, "Habit Health is carried as all three states". */
  habitHealth: HabitHealthVerdict;
};

export type CoachFacts = {
  habits: HabitCoachFacts[];
};

/**
 * The explicit, type-checked set of rate-shaped fields `lib/domain/coach-validation.ts` gives the
 * percent/decimal/bare-integer equivalence to. `keyof HabitCoachFacts` means a typo or a rename
 * that drifts this list out of sync with the type is a compile error, not a silent behavioural
 * change -- deliberately not a `.endsWith('Pct')` naming-convention check (an earlier version of
 * this module used that), which would have made a field's validator treatment depend on staying
 * consistently named rather than on anything this file states about it directly. The `Pct` suffix
 * in each field's own name is retained purely as human-readable documentation; it is no longer
 * load-bearing for any code that reads this list.
 */
export const RATE_FIELD_NAMES: ReadonlyArray<keyof HabitCoachFacts> = ['recoveryRatePct', 'consistencyPct'] as const;

function lapseReasonDistribution(habitId: string, lapseReasons: LapseReasonEntry[]): Record<LapseReasonDistributionKey, number> {
  const counts = Object.fromEntries(LAPSE_REASON_DISTRIBUTION_KEYS.map((key) => [key, 0])) as Record<LapseReasonDistributionKey, number>;
  for (const entry of lapseReasons) {
    if (entry.habitId !== habitId) continue;
    const key: LapseReasonDistributionKey = entry.reason ?? 'skipped_without_reason';
    counts[key] += 1;
  }
  return counts;
}

function buildHabitCoachFacts(
  habit: Habit,
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  today: string,
  consistencyWindowDays: number,
): HabitCoachFacts {
  const momentumState = confirmedStateAt(habit, schedulePeriods, logs, today);
  const rate = recoveryRate(habit, schedulePeriods, logs, today);
  const avgRecoveryDays = averageRecoveryTime(habit, schedulePeriods, logs, today);
  const consistencyRate = consistency(habit, logs, consistencyWindowDays, schedulePeriods, today);

  return {
    habitId: habit.id,
    momentumState,
    totalCompletions: totalCompletions(habit.id, logs),
    recoveryCount: recoveryEvents(habit, schedulePeriods, logs, today).length,
    ...(rate.rolling.displayAsPercentage && rate.rolling.rate !== null
      ? { recoveryRatePct: Math.round(rate.rolling.rate * 100) }
      : {}),
    ...(avgRecoveryDays !== null ? { averageRecoveryTimeDays: Math.round(avgRecoveryDays * 10) / 10 } : {}),
    ...(consistencyRate !== null
      ? {
          consistencyPct: Math.round(consistencyRate * 100),
          consistencyWindowOpportunities: scheduledOpportunitiesInWindow(habit, schedulePeriods, consistencyWindowDays, today).length,
        }
      : {}),
    lapseReasonCounts: lapseReasonDistribution(habit.id, lapseReasons),
    habitHealth: habitHealthVerdict(habit, schedulePeriods, logs, today),
  };
}

/**
 * The single exported producer of `CoachFacts`. Pure and derived-on-read, like every function it
 * calls: identical inputs always produce an identical result, and nothing here persists state
 * across calls. Consumers -- coaching generation and `validateCoachOutput` alike -- must be handed
 * the same object this returns rather than reconstructing any part of it themselves.
 *
 * `kind` selects the Consistency window via `CONSISTENCY_WINDOW_DAYS_BY_KIND` and nothing else --
 * every other fact (Momentum State, Recovery Rate, Recovery Time, Total Completions, recovery
 * count, lapse-reason distribution, Habit Health) is kind-independent, computed identically
 * regardless of which coaching output is being grounded. `consistencyPct` and
 * `consistencyWindowOpportunities` are the only fields whose value differs by kind for the same
 * habit on the same day -- expected and correct, since the window itself is what changes; a wider
 * window is not a different measurement of the same quantity, it is a measurement of a different
 * quantity (adherence over 30 days is not adherence over 7).
 */
export function buildCoachFacts(
  habits: Habit[],
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  today: string,
  kind: CoachFactsKind,
): CoachFacts {
  const consistencyWindowDays = CONSISTENCY_WINDOW_DAYS_BY_KIND[kind];
  return {
    habits: habits.map((habit) => buildHabitCoachFacts(habit, logs, schedulePeriods, lapseReasons, today, consistencyWindowDays)),
  };
}

/**
 * The Momentum States that, on their own, constitute a personalised behavioural insight eligible
 * to occupy the coaching slot -- a coaching-eligibility decision, revised from a broader first
 * version (docs/phase-5-plan.md section 6.5's amendment records both the original reasoning and
 * why it was narrowed). This changes nothing about what any Momentum State *means*, how it is
 * computed, its thresholds, or its hysteresis -- `lib/domain/momentum.ts` is untouched and
 * unreferenced by anything here beyond reading `HabitCoachFacts.momentumState`'s already-confirmed
 * value. `steady`, `quiet`, and `insufficient_data` remain exactly the domain states they always
 * were; this list only says they do not, by themselves, displace deterministic habit-support
 * guidance in the coaching-selection decision `hasGroundedInsight` makes.
 */
const QUALIFYING_MOMENTUM_STATES: readonly MomentumStateKey[] = ['recovering', 'rebuilding', 'building', 'thriving'];

/**
 * Whether `facts` contains at least one personalised behavioural insight currently eligible to be
 * surfaced under the settled coaching rules (docs/phase-5-plan.md section 6.3's "Emphasis order
 * among grounded facts" and section 6.5's fallback precedence, as amended for Step 2 part 2). This
 * is the predicate §6.5's orchestration branches on: `true` means generation should proceed;
 * `false` means nothing grounded exists and the (Step 5) deterministic fallback is the only
 * remaining path.
 *
 * This does **not** mean "does `facts` contain any data" -- several `HabitCoachFacts` fields are
 * always present regardless of whether there is anything to say, and their mere presence must not
 * make this trivially true:
 *
 * - `momentumState` is always present, but only `recovering`, `rebuilding`, `building`, and
 *   `thriving` qualify (`QUALIFYING_MOMENTUM_STATES` above). `recovering`/`rebuilding` are the
 *   product's core recovery-first story -- §6.3 rule 1's "recovery and return lead when the
 *   return is the story" -- and remain unconditionally eligible; `building`/`thriving` remain
 *   eligible as active behavioural narratives, with no further grading introduced between them.
 *
 *   `steady`, `quiet`, and `insufficient_data` do **not** qualify on their own. This is an
 *   eligibility judgment only, not a claim that any of the three means failure, decline, or poor
 *   performance -- `steady` does not mean stagnation, `insufficient_data` does not mean poor
 *   performance, and `quiet` in particular does not mean decline (`quiet` is a context state, per
 *   CLAUDE.md's Momentum contracts, not a rank). `insufficient_data` is excluded because it is the
 *   direct Momentum-side parallel to Habit Health's own `insufficient_evidence` -- "not enough
 *   evidence yet" was never an insight in either domain. `steady` is excluded because the settled
 *   coaching goals (avoid all-or-nothing thinking, recognise genuine progress, identify patterns)
 *   describe *movement* -- toward recovery, toward a stronger streak, toward or away from a
 *   target -- and an unchanging steady state is precisely the case with no movement to describe;
 *   grounded personalised coaching remains available for a steady habit whenever Habit Health
 *   independently supplies one (see below), so this is a narrowing of one signal, not a removal of
 *   the habit from coaching altogether. `quiet` is excluded on a distinct and more deliberate
 *   ground, recorded here rather than left to be inferred: a dormant habit is a moment where
 *   supportive habit-support guidance is more useful than an observation about the dormancy
 *   itself, and any personalised comment the coach could make about a quiet habit risks reading as
 *   a negative characterisation of the user -- which the settled coaching rules forbid outright.
 *   Offering a way back in serves the user better than describing the gap. `quiet`'s exclusion is
 *   not "lumped in with steady for convenience"; it has its own reason, distinct from steady's.
 *
 * - `habitHealth` is always present, but only `positive_recent_comparison` is an insight -- §6.3
 *   rule 3 names it as the one Habit Health state the coach may communicate; `insufficient_evidence`
 *   and `no_positive_recent_comparison` are both non-signals, not different flavours of insight.
 *   This qualifies **independently** of Momentum: a `steady` or `quiet` habit with a positive
 *   Habit Health comparison still has an eligible insight, through Habit Health rather than
 *   Momentum.
 * - `totalCompletions`, `recoveryCount`, `recoveryRatePct`, `averageRecoveryTimeDays`,
 *   `consistencyPct`, and `lapseReasonCounts` are never treated as eligibility sources on their
 *   own, including when non-zero or richly populated. Nothing in the settled rules names any of
 *   them as an independent insight trigger: they are supporting statistics the coach cites
 *   *alongside* a Momentum- or Habit-Health-driven insight (recovery rate/time and consistency, as
 *   in the specification's own coaching goals), or contextual evidence that qualifies one without
 *   competing to lead it (lapse reasons, per §6.3 rule 4: "they qualify whichever grounded insight
 *   is being given," which presupposes an insight already exists rather than manufacturing one).
 *   A habit can therefore have every one of these fields populated and still contribute nothing
 *   eligible, if its Momentum State is not one of the four qualifying states and its Habit Health
 *   verdict is not `positive_recent_comparison`.
 *
 * Evaluated across every habit in `facts.habits` (`.some`, not `.every`) -- a **message-level**,
 * not per-habit, decision: one habit with an eligible insight is enough for the whole coaching
 * request to take the grounded path, even if every other habit has nothing to say. Approved for
 * MVP as a deliberate product decision, not an implementation shortcut (docs/phase-5-plan.md
 * section 6.5's amendment): per-habit fallback composition (grounding some habits and falling back
 * for others within the same message) would introduce mixed-output selection and orchestration
 * complexity out of scope for Phase 5.
 */
export function hasGroundedInsight(facts: CoachFacts): boolean {
  return facts.habits.some(
    (habit) => QUALIFYING_MOMENTUM_STATES.includes(habit.momentumState) || habit.habitHealth === 'positive_recent_comparison',
  );
}

/**
 * Deterministic selection of the one habit a grounded coaching message discusses (Route C;
 * docs/phase-5-plan.md section 6.3's "Cross-habit selection precedence" -- an extension of that
 * section's emphasis-order ruling, not a restatement of it). Applies the approved tier order --
 * `recovering`/`rebuilding`, then `building`/`thriving`, then Habit-Health-only
 * `positive_recent_comparison` -- across every habit in `facts.habits`, and breaks a same-tier tie
 * by ascending lexical `habitId` order: no seeding, no hashing, no behavioural metric, since this
 * only needs to be deterministic for one request's snapshot of qualifying habits, not stable
 * across time or varied for repetition the way the Step 5 Part 2 fallback message selection is.
 *
 * Returns `null` only when no habit qualifies under any tier -- which should never happen when
 * this is called after confirming `hasGroundedInsight(facts)`, since that predicate is exactly
 * "at least one habit satisfies one of these three tiers." The `null` case exists for type
 * honesty, not as an expected branch a caller should rely on reaching.
 */
export function selectLeadingHabit(facts: CoachFacts): HabitCoachFacts | null {
  const byAscendingHabitId = (a: HabitCoachFacts, b: HabitCoachFacts) => (a.habitId < b.habitId ? -1 : a.habitId > b.habitId ? 1 : 0);

  const recoveryTier = facts.habits.filter((habit) => habit.momentumState === 'recovering' || habit.momentumState === 'rebuilding');
  if (recoveryTier.length > 0) return recoveryTier.sort(byAscendingHabitId)[0];

  const growthTier = facts.habits.filter((habit) => habit.momentumState === 'building' || habit.momentumState === 'thriving');
  if (growthTier.length > 0) return growthTier.sort(byAscendingHabitId)[0];

  const healthTier = facts.habits.filter((habit) => habit.habitHealth === 'positive_recent_comparison');
  if (healthTier.length > 0) return healthTier.sort(byAscendingHabitId)[0];

  return null;
}
