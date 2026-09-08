// Habit Health: a single deterministic domain signal comparing a habit's most recent block of
// Scheduled Opportunities against the immediately preceding block of the same nominal length, per
// docs/phase-5-plan.md section 4.1 and the underlying decision in docs/phase-5-precondition-review.md
// (A2, plus the Habit Health architecture it gates). The mechanism establishes only that the recent
// block's observed completion rate exceeded the preceding block's by at least the approved margin --
// it does not establish persistent improvement, that the habit is becoming easier, establishment,
// causality, prediction, or a stable upward trend. HabitHealthVerdict's member names are chosen not
// to claim any of those (docs/phase-5-plan.md section 4.1, "Naming: the verdict must not overclaim").
//
// Stateless and derived-on-read: every value here is a pure function of (habit, periods, logs,
// today), recomputed from scratch on every call. No deadband, no dependence on any previous verdict,
// no second hysteresis mechanism -- see docs/phase-5-precondition-review.md's A2 tripwire and
// docs/phase-5-plan.md's "Required explanation 2" for why a fixed comparison margin does not cross
// it. Not built on momentum(..., window): this module does not import from lib/domain/momentum.ts at
// all, and Step 3 additionally excludes momentum() from the generated-domain whitelist so the
// constraint is structural, not just a property of what this file happens to import.
import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { HABIT_HEALTH_CONFIG } from './config';
import { addDays } from './day-key';
import { isDoneOnDay } from './habit-stats';
import { scheduledOpportunitiesUpTo } from './schedule';

/**
 * Domain-internal identifiers only. Never rendered, and never allowed to shape user-facing copy
 * (docs/phase-5-plan.md section 4.1) -- they exist to be branched on, not read.
 *
 * - `insufficient_evidence`: the smaller of the two comparison blocks has fewer than
 *   `HABIT_HEALTH_CONFIG.minOpportunitiesInSmallerBlock` Scheduled Opportunities.
 * - `no_positive_recent_comparison`: both blocks meet the evidence gate, but the recent block's
 *   completion rate did not exceed the preceding block's by the approved margin. This covers a
 *   smaller positive difference, a decline, or no change alike -- it is not a decline verdict, and
 *   no decline verdict exists. Absence of the positive signal is not evidence of decline.
 * - `positive_recent_comparison`: the recent block's completion rate exceeded the preceding
 *   block's by at least `HABIT_HEALTH_CONFIG.minRateImprovement`.
 */
export type HabitHealthVerdict = 'insufficient_evidence' | 'no_positive_recent_comparison' | 'positive_recent_comparison';

/**
 * The completion rate of an arbitrary block of Scheduled Opportunity dates, using the same
 * `isDoneOnDay` definition of "done" as every other domain calculation -- not `consistency()`
 * (lib/domain/habit-stats.ts), which answers a different question (a trailing window of calendar
 * days ending "now"), not an arbitrary block of already-selected dates. Defined as 0 for an empty
 * block so this can never surface a non-numeric value, though `habitHealthVerdict` below never
 * calls it on an empty block in practice: both blocks are only ever measured once the evidence
 * gate (>= 1 opportunity) has already passed.
 */
function completionRate(habit: Habit, logs: HabitLog[], dates: string[]): number {
  if (dates.length === 0) return 0;
  const doneCount = dates.filter((date) => isDoneOnDay(habit, logs, date)).length;
  return doneCount / dates.length;
}

/**
 * The Habit Health verdict for `habit` as of `today`. See this file's header comment and
 * docs/phase-5-plan.md section 4.1 for the full mechanism, and the plan's "Required explanation 1"
 * for the L/gate relationship this function implements exactly.
 *
 * `resolved` is every Scheduled Opportunity from the habit's creation through *yesterday*,
 * ascending -- today's own opportunity is excluded, consistent with the module-wide rule that
 * today is never judged as missed (the same rule `lib/domain/recovery.ts`'s `openLapse` and
 * `lib/domain/momentum.ts`'s `confirmedStateAt` both follow).
 *
 * Recent block R is the last `comparisonBlockOpportunities` entries of `resolved`; preceding block
 * P is the `comparisonBlockOpportunities` entries immediately before R. `Array.prototype.slice`'s
 * single-argument negative form (`.slice(-L)`) already clamps correctly when `resolved` is shorter
 * than `L`, but the two-argument form does not: passing an already-negative computed start/end
 * directly would make `slice` reinterpret it as "N from the end" rather than as an absolute index
 * to clamp at 0, so both preceding-block bounds are wrapped in `Math.max(0, ...)` first -- the same
 * pattern `lib/domain/momentum.ts`'s `meetsBuilding`/`momentum()` already use for an identical
 * prior-window computation.
 *
 * R therefore fills first and reaches its full length as soon as `resolved.length >=
 * comparisonBlockOpportunities`; P may be shorter than R during ramp-up. A verdict other than
 * `insufficient_evidence` is produced only once the *smaller* of the two blocks reaches
 * `minOpportunitiesInSmallerBlock` -- not once both blocks are independently full at L, which
 * would be a materially later and unapproved reading (docs/phase-5-plan.md's "apparent conflict
 * with architecture decision 1" -- decisions 1 and 2 read together permit exactly this asymmetric
 * pair during ramp-up, since decision 2's gate-on-the-smaller-block wording has nothing to gate on
 * if the blocks were always required to be equal).
 */
export function habitHealthVerdict(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): HabitHealthVerdict {
  const { comparisonBlockOpportunities: L, minOpportunitiesInSmallerBlock: gate, minRateImprovement: margin } = HABIT_HEALTH_CONFIG;

  const resolved = scheduledOpportunitiesUpTo(habit, periods, addDays(today, -1));

  const recent = resolved.slice(-L);
  const precedingStart = Math.max(0, resolved.length - 2 * L);
  const precedingEnd = Math.max(0, resolved.length - L);
  const preceding = resolved.slice(precedingStart, precedingEnd);

  if (Math.min(recent.length, preceding.length) < gate) return 'insufficient_evidence';

  const recentRate = completionRate(habit, logs, recent);
  const precedingRate = completionRate(habit, logs, preceding);

  return recentRate - precedingRate >= margin ? 'positive_recent_comparison' : 'no_positive_recent_comparison';
}
