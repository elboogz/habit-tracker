// @ts-nocheck — Deno runtime: npm: specifiers and the Deno global are not recognised by the
// project's Node tsconfig. The code is type-safe under Deno's own checker (deno check).
// Paste this into Supabase Dashboard -> Edge Functions -> Create a new function ("send-coaching-push").
// Triggered by Supabase Cron every 15 minutes. Uses the service-role key (auto-provided to every
// Edge Function as SUPABASE_SERVICE_ROLE_KEY) since this reads/writes across all users rather than
// one RLS-scoped caller, unlike ai-insights. ANTHROPIC_API_KEY is already set as a project secret
// from the ai-insights setup, so nothing new needs to be added there.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const NUDGE_FRESHNESS_HOURS = 20;

// Duplicated from ai-insights/index.ts rather than shared -- paste-in Edge Functions are deployed
// independently and don't share a module system. scripts/edge-function-prompts.test.ts pins
// STYLE_RULES, ROLE_INTRO, COACH_RULES, and NUDGE_SYSTEM_PROMPT as byte-identical between the two
// files (docs/phase-5-plan.md section 6.3's "Prompt provenance" ruling).
const STYLE_RULES =
  'Write in plain, natural sentences. Never use em dashes (—); use commas or split into separate ' +
  'sentences instead. Do not include any emoji in the text. Plain text only, no markdown.';

const ROLE_INTRO =
  "You are a supportive, perceptive habit-tracking coach. You are given a JSON description of one user's habit, already computed by the app, and you write natural, concise coaching text from it.";

// Phase 5, Step 5 (docs/phase-5-plan.md sections 6.3-6.4): the approved 12-rule shared rules
// block. Only the nudge kind is generated here (this function never sends weekly/monthly
// reflections), so unlike ai-insights/index.ts there is only one system prompt built from it.
const COACH_RULES = `1. The JSON below describes exactly one habit and carries no name for it. Refer to the habit
   only as "this habit" or "it"; never invent a name, label, or description for it, and do not
   assume any other habit exists. The JSON is the only source of truth about this habit; do not
   use any other information about habits, users, or behaviour.
2. Use only numeric values that appear explicitly in the JSON. Never calculate, derive,
   estimate, convert, or infer a number, including a difference, an average, a rate, a
   percentage, or a duration built from two or more supplied values. Every number describing
   the user's behaviour must be copied from the JSON and written as a digit, never spelled out
   as a word.
3. Render each field exactly in the form below, never a different one:
   - consistencyPct: only as "N%". Never as "N out of 100", "N out of every 100", or any other
     frequency phrasing.
   - recoveryRatePct: only as "N%".
   - averageRecoveryTimeDays: only as "N days".
   - recoveryCount / totalCompletions: a plain count, with no unit invented for it.
   - consistencyWindowOpportunities: only as "N Scheduled Opportunities" or "N opportunities".
     Never as a number of days, weeks, or any calendar span.
4. Never convert consistencyWindowOpportunities into a number of days or weeks, and never
   convert a percentage into a literal count "out of" some number of opportunities, times, or
   attempts. These are two different kinds of number describing two different things; neither
   may be turned into the other.
5. Refer to time periods by name only ("this week", "the coming week", "this month", "the past
   month"); never state a period's length as a number of days or weeks.
6. A field missing from the JSON means that value is not available right now, not zero and not
   none. Do not mention a value that is not present, and do not guess what it might be.
7. The habit's own momentumState is its primary narrative. It must never be softened,
   contradicted, or reworded because of its habitHealth value. Never write the literal value of
   momentumState (for example "building", "thriving", "recovering", "rebuilding") into your
   sentence as a label, state, or phase; describe the underlying behaviour in plain language
   instead of naming the category.
8. habitHealth may be mentioned only when it equals "positive_recent_comparison", and only in
   this form: the recent period had a noticeably higher completion rate than the period
   immediately before it. Do not say the habit is improving, becoming established, easier, or
   on an upward trend. Describe it as a comparison between two specific past periods, never as
   an ongoing or future pattern.
9. Never say or imply that momentumState and habitHealth agree, conflict, explain, cause,
   resolve, or reinforce one another. If you mention both, present them as two separate facts.
10. lapseReasonCounts records reasons the user has stated in the past for missing this habit.
    You may mention one only if at least one of "too_busy", "forgot", "low_energy",
    "not_feeling_it", or "something_else" has a count greater than zero, and only as a reason
    the user has noted before, not as a certain explanation for any specific recent gap. If
    every one of those five is zero, do not suggest a reason of your own.
11. Never frame anything as a loss, a broken streak, or something the user must protect or get
    back on track. Never state or imply how many days were missed. Never say "don't." Never
    address the user as becoming a different kind of person; describe behaviour, not identity.
12. Tone: supportive, grounded, adult, and human. Avoid exaggerated praise, guilt, infantilising
    language, and generic motivational phrases.`;

const NUDGE_SYSTEM_PROMPT = `${ROLE_INTRO}

${COACH_RULES}

${STYLE_RULES}

Write 1 to 2 sentences about the habit. The first sentence states the grounded observation,
naming at most one supporting number from consistencyPct, recoveryRatePct, recoveryCount, or
averageRecoveryTimeDays if present, rendered exactly per rule 3. If there is room, add one short
second sentence with either a specific, practical suggestion or a lapse-reason mention under
rule 10, not necessarily both.`;

function sanitizeContent(text: string): string {
  return text
    .replace(/\s*[—–]\s*([A-Z])/g, '. $1')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// BEGIN GENERATED DOMAIN -- DO NOT EDIT BELOW. Regenerate with `npm run build:edge-functions`.

// -- from lib/domain/day-key.ts, do not hand-edit --
/** Local day key 'YYYY-MM-DD' — avoids UTC off-by-one issues from toISOString(). */
function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount);
  return dayKey(date);
}

function parseDayKeyParts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/**
 * 0 (Sunday) - 6 (Saturday) for a local day key, computed via the local Date constructor form
 * (never `new Date(key)`, which JS parses as UTC midnight and can report the wrong weekday for
 * roughly half the world's timezones once converted back to local time).
 */
function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKeyParts(key);
  return new Date(year, month - 1, day).getDay();
}

/** Local day key for an ISO timestamp (e.g. Habit.createdAt). */
function localDayKeyOf(isoTimestamp: string): string {
  return dayKey(new Date(isoTimestamp));
}

/** Calendar days between two local day keys (UTC-anchored so DST transitions never skew a pure date-only difference). */
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// -- from lib/domain/schedule.ts, do not hand-edit --
/**
 * Resolves the schedule/pause state in effect for `date`, per the habit's periods. With no
 * matching period, defaults to daily/unpaused -- this default is also the entirety of the
 * migration story for existing habits (see docs/phase-2-implementation-plan.md section 1):
 * a habit with zero periods behaves exactly as every habit does today.
 *
 * Tie-break order when multiple periods have `effectiveFrom <= date`: greatest `effectiveFrom`,
 * then greatest `createdAt`, then greatest `id` (plain lexicographic string comparison -- carries
 * no meaning, only needs to be deterministic for the residual case where both of the above tie).
 */
function scheduleForDate(
  periods: HabitSchedulePeriod[],
  habitId: string,
  date: string,
): { days: ScheduleDays; paused: boolean } {
  const candidates = periods.filter((period) => period.habitId === habitId && period.effectiveFrom <= date);
  if (candidates.length === 0) return { days: 'daily', paused: false };

  const latest = candidates.reduce((a, b) => {
    if (b.effectiveFrom !== a.effectiveFrom) return b.effectiveFrom > a.effectiveFrom ? b : a;
    if (b.createdAt !== a.createdAt) return b.createdAt > a.createdAt ? b : a;
    return b.id > a.id ? b : a;
  });
  return { days: latest.days, paused: latest.paused };
}

/**
 * Whether `date` was a Scheduled Opportunity for `habit` -- the foundational primitive every
 * other Phase 2 domain calculation is built on. No date before the habit's local creation date
 * is ever a Scheduled Opportunity, regardless of what any schedule period says.
 */
function isScheduledOpportunity(periods: HabitSchedulePeriod[], habit: Habit, date: string): boolean {
  if (date < localDayKeyOf(habit.createdAt)) return false;
  const { days, paused } = scheduleForDate(periods, habit.id, date);
  if (paused) return false;
  if (days === 'daily') return true;
  return days.includes(weekdayOf(date));
}

/** Every Scheduled Opportunity date for `habit`, from its creation through `today` inclusive, ascending. */
function scheduledOpportunitiesUpTo(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  today: string,
): string[] {
  const start = localDayKeyOf(habit.createdAt);
  const result: string[] = [];
  let cursor = start > today ? undefined : start;
  while (cursor !== undefined && cursor <= today) {
    if (isScheduledOpportunity(periods, habit, cursor)) result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

/**
 * Every Scheduled Opportunity date for `habit` within the trailing `days`-day window ending
 * `asOfDate` (inclusive), ascending -- the windowed counterpart to scheduledOpportunitiesUpTo.
 * Deliberately O(days), not O(habit age): walks only the requested window rather than the
 * habit's full lifetime, since Consistency (this function's motivating caller) is computed
 * several times per Progress render and a lifetime walk would make a small-window question cost
 * proportional to how old the habit is.
 */
function scheduledOpportunitiesInWindow(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  days: number,
  asOfDate: string = dayKey(),
): string[] {
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    if (isScheduledOpportunity(periods, habit, date)) result.push(date);
  }
  return result;
}

// -- from lib/domain/config.ts, do not hand-edit --
const RECOVERY_CONFIG = {
  /** Fewer resolved Recoverable Lapse Opportunities than this: never show a percentage. */
  minResolvedLapsesForPercentage: 3,
  /** Below this rate (even with enough samples): prefer Recovery Time / Total Completions over the percentage. */
  lowRecoveryRateShameThreshold: 0.3,
  /** Size of the rolling Recovery Rate window, in resolved Recoverable Lapse Opportunities (not calendar days). */
  rollingWindowOpportunities: 10,
  /**
   * Fewer closed Lapses than this: never show a Recovery Time average. A distinct denominator
   * from minResolvedLapsesForPercentage above (closed Lapses are maximal missed runs; resolved
   * Recoverable Lapse Opportunities are pairwise and can be several per Lapse) -- the value 3 was
   * deliberately not reused. An average from a single Lapse isn't an average; 2 is the minimum at
   * which the word means anything.
   */
  minClosedLapsesForRecoveryTime: 2,
} as const;

const MOMENTUM_CONFIG = {
  /** Consecutive scheduled opportunities a new candidate state must hold before it becomes confirmed. Uniform across all states. */
  transitionConfirmationOpportunities: 3,
  insufficientData: { minScheduledOpportunities: 3 },
  thriving: { window: 8, minCompletionRate: 0.9 },
  steady: { window: 5, minCompletionRate: 0.8 },
  building: { window: 3, minCompletionRate: 0.6, requireImproving: true },
  recovering: { window: 3, maxPrecedingLapseLength: 2 },
  rebuilding: { window: 5, minPrecedingLapseLength: 3 },
  quiet: { window: 3, minMissedFraction: 2 / 3 },
} as const;

/**
 * Habit Health (Phase 5, docs/phase-5-plan.md section 4.1; approved per
 * docs/phase-5-precondition-review.md's A2 decision). Two adjacent, nominally
 * `comparisonBlockOpportunities`-length blocks of Scheduled Opportunities -- recent versus
 * immediately preceding -- compared as completion rates. The recent block fills first and is the
 * one that must reach full length; the preceding block may be shorter during ramp-up. Stateless:
 * every value below is a pure function of the current history, with no dependence on any
 * previous Habit Health verdict and no deadband (see the plan's "Required explanation 2" for the
 * full A2 argument, in particular why a fixed margin does not cross the tripwire that prohibits a
 * second hysteresis mechanism).
 */
const HABIT_HEALTH_CONFIG = {
  /** Nominal length of each comparison block, in Scheduled Opportunities (not calendar days). */
  comparisonBlockOpportunities: 14,
  /**
   * Fewer Scheduled Opportunities than this in the *smaller* of the two comparison blocks: never
   * produce a verdict beyond insufficient_evidence. A distinct denominator from either Recovery
   * gate above -- Scheduled-Opportunity-block-denominated here, lapse-denominated there --
   * deliberately not reused, following the precedent set between minResolvedLapsesForPercentage
   * and minClosedLapsesForRecoveryTime. At comparisonBlockOpportunities = 14 this gate binds only
   * during a four-opportunity ramp-up window (resolved history length 24 through 27) and never
   * again once both blocks are permanently full; the margin below is the only ongoing control.
   */
  minOpportunitiesInSmallerBlock: 10,
  /**
   * Minimum recent-block-minus-preceding-block completion-rate difference required for the
   * positive verdict. At comparisonBlockOpportunities = 14 the achievable difference quantises in
   * steps of 1/14 (~7.14 percentage points: 0, 1/14, 2/14, ...), so 0.25 is equivalent to any
   * value in (3/14, 4/14] -- it means "at least 4 more completions in the recent block than the
   * preceding block", and a later adjustment inside that same interval would be a no-op, not a
   * fine-tune.
   */
  minRateImprovement: 0.25,
} as const;

/**
 * Which of the three coaching outputs `lib/domain/coach-facts.ts`'s `buildCoachFacts` is being
 * asked to ground (Phase 5, Step 2 part 2). Defined here rather than imported from either Edge
 * Function: `lib/domain/` does not depend on `supabase/functions/`, and this is the domain layer's
 * own canonical definition of the three coaching kinds -- Step 3's whitelist is what will
 * eventually let the Edge Functions consume it, not the other way around. `coach-facts.ts`
 * re-exports this type so its own consumers never need to know it originates here.
 */
type CoachFactsKind = 'nudge' | 'weekly' | 'monthly';

/**
 * The Consistency window, in calendar days, per coaching kind -- restores the pre-Phase-5 Edge
 * Functions' per-kind windows (`ai-insights/index.ts`'s `KIND_CONFIG.windowDays`: nudge 14, weekly
 * 7, monthly 30) rather than the single canonical window an earlier draft of `coach-facts.ts` used
 * regardless of kind. `buildCoachFacts` is the only reader; centralised here (moved from
 * `coach-facts.ts` once the values were settled) rather than in that file, matching every other
 * Phase 2+ domain threshold's single-source-of-truth home. Affects only `consistencyPct` and
 * `consistencyWindowOpportunities` -- every other `CoachFacts` field is kind-independent.
 */
const CONSISTENCY_WINDOW_DAYS_BY_KIND: Record<CoachFactsKind, number> = {
  nudge: 14,
  weekly: 7,
  monthly: 30,
} as const;

/**
 * Already ruled at docs/phase-5-plan.md section 6.6, "Sentinel TTL, proposed explicitly" -- not a
 * fresh Part 1 proposal. A validator-rejection failure sentinel is retry backoff, not content
 * caching, so it is deliberately not the successful-content freshness window above: inheriting it
 * would suppress retry for 30 days on monthly content. Each value is checked directly against
 * `COACH_CONTENT_FRESHNESS_HOURS_BY_KIND` (see that constant's own tests) rather than only
 * asserted to be smaller in prose.
 */
const FAILURE_SENTINEL_TTL_HOURS: Record<CoachFactsKind, number> = {
  nudge: 3,
  weekly: 24,
  monthly: 24,
} as const;

// -- from lib/domain/habit-stats.ts, do not hand-edit --
function logsForHabitOnDay(logs: HabitLog[], habitId: string, date: string): HabitLog[] {
  return logs.filter((log) => log.habitId === habitId && log.date === date);
}

function countForDay(logs: HabitLog[], habitId: string, date: string): number {
  return logsForHabitOnDay(logs, habitId, date).reduce((sum, log) => sum + log.count, 0);
}

/**
 * A reduced ("smaller version") completion counts fully as done for the day -- not partial
 * credit -- so every downstream consumer (streaks, consistency, recovery, momentum, challenge
 * progress) automatically treats it as a completed day with no further changes (Phase 4, see
 * docs/phase-4-plan.md section 2.2). Additive and backward-compatible: no pre-Phase-4 HabitLog
 * has a `reduced` field, so every existing computation over existing data is byte-for-byte
 * unchanged.
 */
function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const dayLogs = logsForHabitOnDay(logs, habit.id, date);
  if (dayLogs.some((log) => log.reduced)) return true;
  const total = dayLogs.reduce((sum, log) => sum + log.count, 0);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}

/**
 * Cumulative count of logged entries for a habit, lifetime, never resetting. Consolidates the
 * inline `logs.filter((log) => log.habitId === habitId).length` pattern previously duplicated
 * across screens into one named export (Phase 3) -- not a new calculation.
 */
function totalCompletions(habitId: string, logs: HabitLog[]): number {
  return logs.filter((log) => log.habitId === habitId).length;
}

/**
 * Calendar-day streak -- `streakForHabit`'s pre-Scheduled-Opportunity behavior, preserved verbatim
 * under an honest name. Exists only so scripts/build-edge-functions.js's generated block (see the
 * SOURCES list there) can keep inlining a function the two Edge Functions actually call (both
 * build a `streakDays` field for their coaching prompts) without silently changing their behavior:
 * neither Edge Function fetches habit_schedule_periods today, so they cannot call the
 * schedule-aware streakForHabit() above without a separate, deliberate change (the same Edge
 * Function integration gated in docs/phase-4-completion-report.md's Consistency entry). Not used
 * by any client screen -- every client call site reads the schedule-aware streakForHabit() instead.
 */
function calendarStreakForHabit(habit: Habit, logs: HabitLog[], asOfDate: string = dayKey()): number {
  let cursor = isDoneOnDay(habit, logs, asOfDate) ? asOfDate : addDays(asOfDate, -1);

  let streak = 0;
  while (isDoneOnDay(habit, logs, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

type DayStatus = { date: string; done: boolean; count: number };

/**
 * Most recent `days` days (oldest first) ending `asOfDate`, with completion status -- powers the
 * heatmap/bars. See streakForHabit's doc comment for why `asOfDate` is an explicit, defaulted
 * parameter rather than always "now".
 */
function recentHistory(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): DayStatus[] {
  const result: DayStatus[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    const count = countForDay(logs, habit.id, date);
    result.push({ date, count, done: isDoneOnDay(habit, logs, date) });
  }
  return result;
}

/**
 * Fraction (0-1) of Scheduled Opportunities in the last `days` days (ending `asOfDate`) the habit
 * was completed, or `null` if the window contains no Scheduled Opportunities at all. `null` is a
 * distinct claim from `0`: "not yet asked" is not the same statement as "asked and missed every
 * time," so a window with nothing to evaluate returns no percentage rather than a false zero.
 *
 * Per docs/habit-tracker-evolution-plan.md's Scheduled Opportunity principle ("every progress
 * calculation throughout the application must be based on scheduled opportunities rather than
 * calendar days," naming Consistency first in that list): measures adherence to what the habit's
 * own schedule actually offered in the window, not raw calendar days regardless of whether the
 * habit was ever asking for them that day. Deliberately does not reuse recentHistory -- that stays
 * calendar-based (it powers the heatmap/calendar, where every calendar day is a legitimate visual
 * artefact) and answers a different question than this function does.
 */
function consistency(
  habit: Habit,
  logs: HabitLog[],
  days: number,
  schedulePeriods: HabitSchedulePeriod[],
  asOfDate: string = dayKey(),
): number | null {
  const opportunities = scheduledOpportunitiesInWindow(habit, schedulePeriods, days, asOfDate);
  if (opportunities.length === 0) return null;
  const doneCount = opportunities.filter((date) => isDoneOnDay(habit, logs, date)).length;
  return doneCount / opportunities.length;
}

/**
 * Calendar-day consistency -- `consistency`'s pre-Scheduled-Opportunity behavior, preserved
 * verbatim under an honest name. Exists only so scripts/build-edge-functions.js's generated block
 * (see the SOURCES list there) can keep inlining a function the two Edge Functions actually call
 * (send-coaching-push's push eligibility, ai-insights' consistencyPct) without silently changing
 * their behavior: neither Edge Function fetches habit_schedule_periods today, so they cannot call
 * the schedule-aware consistency() above without a separate, deliberate change (extending the
 * generated-domain whitelist to include schedule.ts, plus a new DB read -- see the completion
 * report for the open questions that change is gated on). Not used by any client screen -- every
 * client call site reads the schedule-aware consistency() instead.
 */
function calendarConsistency(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): number {
  const history = recentHistory(habit, logs, days, asOfDate);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}

// -- from lib/domain/recovery.ts, do not hand-edit --
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
type RecoverableLapseInstance = {
  habitId: string;
  missedOpportunityDate: string;
  resolvingOpportunityDate: string;
  recovered: boolean;
};

/** A Recovery Event is exactly the "recovered" case of a RecoverableLapseInstance, at its resolving date. */
type RecoveryEvent = { habitId: string; date: string };

/**
 * A closed Lapse: a maximal run of consecutive missed scheduled opportunities that eventually
 * ended in a completion. This is a deliberately coarser grain than RecoverableLapseInstance --
 * Recovery Time measures "when a real lapse happens, how long does it typically take to resolve",
 * which would be degenerate (always ~1 opportunity) if measured pairwise instead.
 */
type ClosedLapse = {
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

type RecoveryRateResult = {
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
type RecoveryRateSummary = {
  lifetime: RecoveryRateResult;
  rolling: RecoveryRateResult;
};

/** Every resolved (both recovered and not-recovered) pairwise instance in the habit's lifetime, ascending by date. */
function recoverableLapseInstances(
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
function recoveryEvents(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): RecoveryEvent[] {
  return recoverableLapseInstances(habit, periods, logs, today)
    .filter((instance) => instance.recovered)
    .map((instance) => ({ habitId: habit.id, date: instance.resolvingOpportunityDate }));
}

/** Every Lapse (maximal missed run) that has since closed via a completion -- an ongoing, unresolved run is excluded by design. */
function closedLapses(
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
function averageRecoveryTime(
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
function recoveryRate(
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

// -- from lib/domain/momentum.ts, do not hand-edit --
type MomentumStateKey =
  | 'insufficient_data'
  | 'building'
  | 'steady'
  | 'recovering'
  | 'rebuilding'
  | 'thriving'
  | 'quiet';

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
function confirmedStateAt(
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
function computeConfirmedMomentumState(candidates: MomentumStateKey[]): MomentumStateKey {
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

// -- from lib/domain/habit-health.ts, do not hand-edit --
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
type HabitHealthVerdict = 'insufficient_evidence' | 'no_positive_recent_comparison' | 'positive_recent_comparison';

/**
 * The completion rate of an arbitrary block of Scheduled Opportunity dates, using the same
 * `isDoneOnDay` definition of "done" as every other domain calculation -- not `consistency()`
 * (lib/domain/habit-stats.ts), which answers a different question (a trailing window of calendar
 * days ending "now"), not an arbitrary block of already-selected dates. Defined as 0 for an empty
 * block so this can never surface a non-numeric value, though `habitHealthVerdict` below never
 * calls it on an empty block in practice: both blocks are only ever measured once the evidence
 * gate (>= 1 opportunity) has already passed.
 */
function blockCompletionRate(habit: Habit, logs: HabitLog[], dates: string[]): number {
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
function habitHealthVerdict(
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

  const recentRate = blockCompletionRate(habit, logs, recent);
  const precedingRate = blockCompletionRate(habit, logs, preceding);

  return recentRate - precedingRate >= margin ? 'positive_recent_comparison' : 'no_positive_recent_comparison';
}

// -- from lib/domain/coach-facts.ts, do not hand-edit --
/** `LapseReasonEntry.reason` is `LapseReasonKey | null` (null = skipped without stating why); this closes that over one flat, always-fully-populated distribution key. */
type LapseReasonDistributionKey = LapseReasonKey | 'skipped_without_reason';

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
type HabitCoachFacts = {
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

type CoachFacts = {
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
const RATE_FIELD_NAMES: ReadonlyArray<keyof HabitCoachFacts> = ['recoveryRatePct', 'consistencyPct'] as const;

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
function buildCoachFacts(
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
function hasGroundedInsight(facts: CoachFacts): boolean {
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
function selectLeadingHabit(facts: CoachFacts): HabitCoachFacts | null {
  const byAscendingHabitId = (a: HabitCoachFacts, b: HabitCoachFacts) => (a.habitId < b.habitId ? -1 : a.habitId > b.habitId ? 1 : 0);

  const recoveryTier = facts.habits.filter((habit) => habit.momentumState === 'recovering' || habit.momentumState === 'rebuilding');
  if (recoveryTier.length > 0) return recoveryTier.sort(byAscendingHabitId)[0];

  const growthTier = facts.habits.filter((habit) => habit.momentumState === 'building' || habit.momentumState === 'thriving');
  if (growthTier.length > 0) return growthTier.sort(byAscendingHabitId)[0];

  const healthTier = facts.habits.filter((habit) => habit.habitHealth === 'positive_recent_comparison');
  if (healthTier.length > 0) return healthTier.sort(byAscendingHabitId)[0];

  return null;
}

// -- from lib/domain/coach-validation.ts, do not hand-edit --
const RATE_FIELD_NAME_SET: ReadonlySet<string> = new Set(RATE_FIELD_NAMES);

/**
 * `matchedPhrases` (Phase 5, Step 5 Part 3b) is optional and never populated by
 * `validateCoachOutput` itself -- it exists so a caller composing this numeric validator with a
 * second, independent check (the lexical backstop, `lib/domain/coach-output-check.ts`) can report
 * that second check's own failure without repurposing `invalidNumerals` to hold non-numeral
 * strings. `invalidNumerals` remains honestly empty when a rejection has no numeric cause.
 */
type ValidationResult = { valid: true } | { valid: false; invalidNumerals: string[]; matchedPhrases?: string[] };

/** Digit-form ordinals: "1st", "21st", "3rd", "4th". Masked before the main numeral scan runs, regardless of whether they sit inside a date phrase or stand alone. */
const ORDINAL_RE = /\b\d{1,2}(?:st|nd|rd|th)\b/gi;

/** ISO-shaped dates, e.g. "2026-03-05". */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** "March 3", "March 3rd" (the ordinal suffix, if present, is masked separately by ORDINAL_RE first). */
const MONTH_DAY_RE = new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi');

/** "3 March", "the 3rd of March". */
const DAY_MONTH_RE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})\\b`, 'gi');

/** Every remaining digit-form numeral, with an optional decimal component and an optional trailing percent sign, after date/ordinal spans have been masked out. */
const NUMERAL_RE = /\d+(?:\.\d+)?%?/g;

/**
 * Replaces every exempt span with `#` characters of the same length, so positions are preserved
 * (irrelevant here, but avoids any accidental re-matching across a shortened string) and none of
 * the masked digits reach `NUMERAL_RE`. Order matters: ordinals are masked last so a month-day
 * date's own trailing ordinal ("March 3rd") is still fully covered by the date regex first, with
 * the ordinal mask only needed for a bare, non-date ordinal like "your 3rd attempt".
 */
function maskExemptSpans(text: string): string {
  return text
    .replace(ISO_DATE_RE, (match) => '#'.repeat(match.length))
    .replace(MONTH_DAY_RE, (match) => '#'.repeat(match.length))
    .replace(DAY_MONTH_RE, (match) => '#'.repeat(match.length))
    .replace(ORDINAL_RE, (match) => '#'.repeat(match.length));
}

/**
 * Every numeric leaf in `facts`, split into two sets by `coach-facts.ts`'s explicit, type-checked
 * `RATE_FIELD_NAMES` list (not a `.endsWith('Pct')` naming-convention check -- see that constant's
 * own doc comment for why the explicit list is the safer of the two): a field named there is
 * rate-shaped and carries the three-way percent/decimal/bare equivalence; every other numeric leaf
 * (counts, durations) is checked only at face value. This is otherwise a generic walk over
 * `HabitCoachFacts`' own leaves plus one level of nesting for `lapseReasonCounts`, not a
 * hand-maintained field list -- it stays correct if a non-rate field is added or removed from
 * `coach-facts.ts` without this module changing, and a compile error (not a silent behavioural
 * change) if `RATE_FIELD_NAMES` itself ever drifts from the type it's declared against.
 */
function collectFactNumbers(facts: CoachFacts): { plain: Set<number>; pct: Set<number> } {
  const plain = new Set<number>();
  const pct = new Set<number>();

  for (const habitFacts of facts.habits) {
    for (const [key, value] of Object.entries(habitFacts) as [keyof HabitCoachFacts, unknown][]) {
      if (typeof value === 'number') {
        (RATE_FIELD_NAME_SET.has(key) ? pct : plain).add(value);
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const nested of Object.values(value as Record<string, unknown>)) {
          if (typeof nested === 'number') plain.add(nested);
        }
      }
    }
  }

  return { plain, pct };
}

/**
 * Whether the numeral `raw` (as it literally appeared in the text, after `%` stripping and
 * decimal parsing) is grounded in `facts`. Percent claims are checked only against rate-shaped
 * ("*Pct") facts, by exact equality against their single canonical rounded value -- not a range,
 * so "81%"/"83%" against an 82 fact are both rejected, not merely "far" values. A bare number is
 * checked three ways: as an exact plain fact, as the bare-integer rendering of a `*Pct` fact
 * ("82" standing for "82%"), or as the decimal rendering of one ("0.82" standing for "82%") -- the
 * same "0.82 <-> 82% <-> 82" equivalence the plan names, expanded outward from a single stored
 * canonical value rather than the model being handed multiple pre-computed renderings.
 */
function isGrounded(value: number, isPercent: boolean, facts: { plain: Set<number>; pct: Set<number> }): boolean {
  if (isPercent) {
    return facts.pct.has(Math.round(value));
  }
  if (facts.plain.has(value)) return true;
  if (Number.isInteger(value) && value >= 0 && value <= 100 && facts.pct.has(value)) return true;
  if (value >= 0 && value <= 1 && facts.pct.has(Math.round(value * 100))) return true;
  return false;
}

/**
 * Deterministic numeric grounding: every digit-form numeral in `text` (outside a recognised date
 * or ordinal) must equal, under the equivalences above, some numeric leaf of `facts`. `facts` must
 * be the same `CoachFacts` object the corresponding generation call was given -- this function
 * never derives or recomputes facts of its own, so it cannot silently drift from what the model
 * actually saw.
 */
function validateCoachOutput(text: string, facts: CoachFacts): ValidationResult {
  const factNumbers = collectFactNumbers(facts);
  const masked = maskExemptSpans(text);
  const invalidNumerals: string[] = [];

  for (const match of masked.matchAll(NUMERAL_RE)) {
    const raw = match[0];
    const isPercent = raw.endsWith('%');
    const value = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw);

    if (!isGrounded(value, isPercent, factNumbers)) invalidNumerals.push(raw);
  }

  return invalidNumerals.length === 0 ? { valid: true } : { valid: false, invalidNumerals };
}

// -- from lib/domain/coach-orchestration.ts, do not hand-edit --
/**
 * Supplies fallback text for a message with no grounded insight (`hasGroundedInsight(facts) ===
 * false`). Deliberately an injected collaborator, not implemented here: Part 1 only defines this
 * boundary so Part 2 can supply the real deterministic fallback message set without this module
 * changing shape. A Part 1 test fake stands in for it; there is no default implementation and no
 * `throw new Error('TODO')` placeholder on any reachable branch -- a caller without a real
 * provider simply cannot construct valid `CoachGenerationDeps`.
 */
type FallbackProvider = (facts: CoachFacts, kind: CoachFactsKind) => string;

type CoachGenerationDeps = {
  /** Calls the model exactly once. Invoked only on the grounded path, never on fallback, never twice. */
  generateGroundedText: () => Promise<string>;
  fallbackProvider: FallbackProvider;
  /**
   * Injected rather than a hard import of the real `validateCoachOutput`, so a test can capture
   * the exact `facts` reference it was called with and assert identity (`===`) against the
   * `facts` this function itself received (see coach-orchestration.test.ts). Production callers
   * (Part 3) pass the real `lib/domain/coach-validation.ts#validateCoachOutput` unmodified.
   */
  validateCoachOutput: (text: string, facts: CoachFacts) => ValidationResult;
};

type CoachGenerationResult =
  | { path: 'grounded'; content: string }
  | { path: 'fallback'; content: string }
  /**
   * Deliberately carries no text/content field of any kind -- the rejected prose is never
   * propagated past this point structurally (the type has nowhere to put it), not merely by
   * caller discipline.
   */
  | { path: 'rejected'; validation: Extract<ValidationResult, { valid: false }> };

/**
 * The single structural precedence rule for Step 5 message generation (docs/phase-5-plan.md
 * section 6.5): the fallback path fires if and only if `hasGroundedInsight(facts)` is false. The
 * grounded path attempts generation exactly once -- there is no automatic second attempt -- and
 * validates the result against the exact same `facts` object supplied here, never a recomputed
 * copy. Rejection is a third, terminal outcome, not a fallthrough into fallback: a validator
 * rejection is not the same claim as "no grounded insight available" (docs/phase-5-plan.md
 * section 6.6), so the `rejected` and `fallback` branches are mutually exclusive by construction
 * -- there is no code path that reaches `fallbackProvider` after a rejection.
 */
function resolveCoachGeneration(facts: CoachFacts, kind: CoachFactsKind, deps: CoachGenerationDeps): Promise<CoachGenerationResult> {
  if (!hasGroundedInsight(facts)) {
    return Promise.resolve({ path: 'fallback' as const, content: deps.fallbackProvider(facts, kind) });
  }
  return deps.generateGroundedText().then((generatedText) => {
    const validation = deps.validateCoachOutput(generatedText, facts);
    if (validation.valid) return { path: 'grounded' as const, content: generatedText };
    return { path: 'rejected' as const, validation };
  });
}

type RejectionConsequenceDeps = {
  /** Writes an ai_insights row with empty content, dated now -- the retry-backoff sentinel. */
  persistFailureSentinel: () => Promise<void>;
  /**
   * Present only for the cron/push caller. Stamps that user's `coach_push_last_sent_date` for
   * today. Load-bearing (docs/phase-5-plan.md section 6.6, "Sentinel shape: the render path
   * traced"): without it, a persistently rejected
   * user would be re-attempted (a real Anthropic call each time) on every subsequent cron tick
   * that day, since an empty-content sentinel alone produces no push and therefore never reaches
   * `send-coaching-push`'s own later `if (!content) continue` skip.
   */
  markCronPushHandledToday?: () => Promise<void>;
};

/**
 * The complete, caller-context-aware consequence of a validator rejection. Always persists the
 * failure sentinel; additionally marks the day's cron push attempt handled only when that
 * dependency is supplied (the push/cron caller) -- never for the interactive `ai-insights`
 * caller, which has no "day's push attempt" concept to mark.
 */
function applyRejectionConsequences(deps: RejectionConsequenceDeps): Promise<void> {
  return deps.persistFailureSentinel().then(() => {
    if (deps.markCronPushHandledToday) return deps.markCronPushHandledToday();
    return undefined;
  });
}

/**
 * Whether a live failure sentinel (an empty-content `ai_insights` row) is still within its retry
 * backoff window -- pure date arithmetic, no I/O. Mirrors the shape of the existing freshness
 * check (`created_at > since`) so Part 3 can slot this in alongside it rather than invent a
 * different comparison style. A failure sentinel is retry backoff, not content caching
 * (`FAILURE_SENTINEL_TTL_HOURS`'s own doc comment), so this is checked against that constant, not
 * against `COACH_CONTENT_FRESHNESS_HOURS_BY_KIND`.
 */
function isWithinFailureBackoff(sentinelCreatedAtIso: string, kind: CoachFactsKind, nowIso: string): boolean {
  const cutoffMs = new Date(nowIso).getTime() - FAILURE_SENTINEL_TTL_HOURS[kind] * 60 * 60 * 1000;
  return new Date(sentinelCreatedAtIso).getTime() > cutoffMs;
}

/**
 * The existing `send-coaching-push` per-user-per-day dedup rule, currently inline as
 * `recipient.coach_push_last_sent_date === today` in that function's main loop, extracted as a
 * named, independently testable primitive rather than left implicit and untested. Part 3 should
 * replace that inline comparison with a call here rather than duplicate the rule a second time.
 */
function shouldCronAttemptToday(lastSentDate: string | null, today: string): boolean {
  return lastSentDate !== today;
}

type RejectionDiagnostic = {
  kind: CoachFactsKind;
  invalidNumerals: string[];
  allowedPlain: number[];
  allowedPct: number[];
};

/**
 * Minimal, structurally prose-free rejection diagnostics (docs/phase-5-plan.md section 6.6):
 * coaching kind, the validator's own reason (which numerals were rejected), and the enumerable
 * allowed set it checked against -- reusing `collectFactNumbers` rather than re-deriving it, so
 * this can never silently drift from what the validator actually used. Deliberately does not
 * accept the generated text as a parameter at all: the rejected prose cannot leak into this
 * diagnostic because there is nowhere in this function's signature for it to enter. Deployment/
 * version metadata (the Edge Function's own `SOURCE_STAMP`) is added by the caller around this
 * object where useful, not by this domain-layer function, which has no access to it.
 */
function buildRejectionDiagnostic(
  kind: CoachFactsKind,
  facts: CoachFacts,
  validation: Extract<ValidationResult, { valid: false }>,
): RejectionDiagnostic {
  const { plain, pct } = collectFactNumbers(facts);
  return {
    kind,
    invalidNumerals: validation.invalidNumerals,
    allowedPlain: [...plain].sort((a, b) => a - b),
    allowedPct: [...pct].sort((a, b) => a - b),
  };
}

/**
 * The row `persistFailureSentinel` (an injected I/O callback this module never performs itself)
 * should insert into `ai_insights`. Confirms, structurally, that a sentinel needs no new table,
 * no new column, and no dedicated counting logic: it is an ordinary `ai_insights` row like any
 * successful one, distinguished only by `content: ''`, so it is automatically included by the
 * existing rate-limit count query (`select('id', { count: 'exact', head: true }).gt('created_at',
 * ...)`), which does not filter on `content` or `kind` at all. `id` is intentionally omitted --
 * generated by the caller (`crypto.randomUUID()`), matching how every other domain-layer type in
 * this codebase leaves ID generation to its caller rather than performing it itself.
 */
type FailureSentinelRow = {
  user_id: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  content: '';
  model: string;
  created_at: string;
};

function buildFailureSentinelRow(dbKind: string, userId: string, model: string, nowIso: string): FailureSentinelRow {
  return {
    user_id: userId,
    kind: dbKind,
    period_start: null,
    period_end: null,
    content: '',
    model,
    created_at: nowIso,
  };
}

// -- from lib/domain/coach-fallback.ts, do not hand-edit --
/**
 * The closed, approved set of five fallback messages (docs/phase-5-plan.md section 6.5). Order
 * only fixes each message's index for `selectFallbackIndex` -- it carries no ranking or priority
 * meaning. Each string is the exact wording approved in the copy-gate review; do not add, remove,
 * reword, or normalise punctuation in any entry without a separate copy-gate review.
 */
const FALLBACK_MESSAGES: readonly string[] = [
  'Pick the smallest possible first step, and just do that one thing.',
  'Changing the time, place, or setup this happens in can make it noticeably easier to do.',
  'Pairing this with something you already do every day can make it easier to remember.',
  'A smaller version of this still counts. There is no need for all or nothing.',
  'Putting a visible reminder where you will actually see it often works better than willpower.',
];

/**
 * FNV-1a, 32-bit (approved docs/phase-5-plan.md section 6.5): pure arithmetic, no library, runs
 * identically under Hermes (client) and Deno (Edge Functions). Chosen over an earlier djb2/XOR
 * candidate because FNV-1a XORs each byte in before multiplying, mixing every byte's influence
 * through the remaining hash state rather than leaving a constant offset between structurally
 * similar inputs -- verified directly against the adversarial case that broke the djb2 candidate
 * (two ids differing by a constant per-character offset collided on every one of 30 days under
 * djb2; 5 of 30 under FNV-1a, in line with random chance for 5 buckets), and against a
 * 2,000-random-UUID sample showing no bucket skew. No cryptographic property is claimed or
 * required -- only even bucket distribution and freedom from that specific collision pattern.
 * Matches the canonical published FNV-1a 32-bit test vectors (pinned in coach-fallback.test.ts).
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (the FNV prime), expressed as shifts/adds to stay in 32-bit integer
    // arithmetic without overflowing to a float -- identical result to Math.imul(hash, 16777619).
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic index into `FALLBACK_MESSAGES` for a given account and day. */
function selectFallbackIndex(userId: string, dayKey: string): number {
  return fnv1a32(`${userId}|${dayKey}`) % FALLBACK_MESSAGES.length;
}

/**
 * Builds a `FallbackProvider` (the boundary `coach-orchestration.ts` defines) closed over the
 * caller's `userId` and `today` day key -- see the seed-resolution note above for why both are
 * supplied here rather than read off `facts`/`kind`. The returned function ignores its own
 * `facts`/`kind` parameters: selection depends only on which account and which day this is, never
 * on the specific reason fallback fired, so the same account always sees the same message on a
 * given day regardless of which habits or kind triggered it.
 */
function buildFallbackProvider(userId: string, today: string): FallbackProvider {
  return (_facts: CoachFacts, _kind: CoachFactsKind): string => FALLBACK_MESSAGES[selectFallbackIndex(userId, today)];
}

// -- from lib/domain/coach-lexical-check.ts, do not hand-edit --
const CLAUDE_MD_PROHIBITED_FRAMINGS = ['protecting', 'breaking', 'losing', 'keeping alive', 'getting back on track', 'streak', "don't"] as const;

const MOMENTUM_STATE_VALUES: readonly MomentumStateKey[] = ['insufficient_data', 'recovering', 'rebuilding', 'thriving'];

const HABIT_HEALTH_VALUES: readonly HabitHealthVerdict[] = ['insufficient_evidence', 'no_positive_recent_comparison', 'positive_recent_comparison'];

/** The complete, closed set of prohibited literal strings. See the module header for exact provenance of every entry, and for why "building", "steady", and "quiet" were removed. */
const PROHIBITED_LEXICON: readonly string[] = [...CLAUDE_MD_PROHIBITED_FRAMINGS, ...MOMENTUM_STATE_VALUES, ...HABIT_HEALTH_VALUES];

type LexicalCheckResult = { valid: true } | { valid: false; matchedPhrases: string[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Precisely: whole-word matching over a fixed list, not substring containment. Each entry is
 * matched only when it appears as a complete word (\b<phrase>\b) -- e.g. "streak" does not match
 * inside "streaking" (no word boundary between "streak" and "ing"), pinned directly in the test
 * file. This is a different, narrower rule than plain substring search would be, and is described
 * exactly that way rather than loosely as "substring matching": the boundary anchor is a syntactic
 * distinction (whole word vs. part of a longer one), still no stemming, no fuzzy distance, no
 * semantic reasoning of any kind. For every remaining entry it still cannot distinguish an
 * ordinary, harmless use of the word from a genuine leak of that literal value -- that residual
 * false-positive exposure is a known, accepted trade-off of a closed-list check, not an oversight,
 * and is why "building", "steady", and "quiet" were removed after being measured, not guessed at.
 */
function checkProhibitedLexicon(text: string): LexicalCheckResult {
  const matchedPhrases: string[] = [];
  for (const phrase of PROHIBITED_LEXICON) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
    if (pattern.test(text)) matchedPhrases.push(phrase);
  }
  return matchedPhrases.length === 0 ? { valid: true } : { valid: false, matchedPhrases };
}

// -- from lib/domain/coach-output-check.ts, do not hand-edit --
function combinedValidate(text: string, facts: CoachFacts): ValidationResult {
  const numeric = validateCoachOutput(text, facts);
  if (!numeric.valid) return numeric;
  const lexical = checkProhibitedLexicon(text);
  if (!lexical.valid) return { valid: false, invalidNumerals: [], matchedPhrases: lexical.matchedPhrases };
  return { valid: true };
}

// END GENERATED DOMAIN

// Deployment stamp, written by scripts/build-edge-functions.js -- never edit these values by hand.
// Both Edge Functions are hand-pasted into the Supabase Dashboard, so a deployed copy can fall
// behind the repository silently; this makes that detectable by request instead of by eye.
//   block -- fingerprints the generated domain block above. Identical in both Edge Functions, so
//            comparing the two answers "are these from the same generated revision?"
//   file  -- fingerprints this whole file with only this line neutralized, so comparing it against
//            the repository answers "is what's deployed current?"
// See docs/phase-5-precondition-review.md, B6.
const SOURCE_STAMP = { block: 'f69ccd51812b', file: '75295302c565' };

// Row shapes as returned by Supabase (snake_case, matching the Postgres columns directly) --
// adapted below to the shared domain layer's camelCase shape, mirroring the same job
// lib/supabase-sync.ts does client-side (rowToHabit/rowToLog) for the same reason: the generated
// functions above are written once against Habit/HabitLog and must not be reimplemented against a
// different field-naming convention here. Each shim is kept minimal: only the fields the generated
// closure actually dereferences (Habit.createdAt is required by isScheduledOpportunity/
// scheduledOpportunitiesUpTo, now in the closure below) or that an existing converter already
// populates.
type HabitRow = { id: string; name: string; emoji: string; type: string; target_count: number | null; created_at: string };
type LogRow = { habit_id: string; date: string; count: number; reduced: boolean | null };
type Habit = { id: string; type: string; targetCount?: number; createdAt: string };
type HabitLog = { habitId: string; date: string; count: number; reduced?: boolean };

// Phase 5, Step 3 (docs/phase-5-plan.md section 6.1 / section 10 register): these four mirror
// lib/habit-types.ts structurally (HabitSchedulePeriod/ScheduleDays/LapseReasonKey/LapseReasonEntry)
// and their Postgres row counterparts, needed because the generated closure below references them
// as parameter/field types (schedule.ts, recovery.ts, coach-facts.ts).
//
// Step 4 Part 1 (docs/phase-5-plan.md section 6.2): toDomainSchedulePeriod and
// toDomainLapseReason below are the caller-side mappers for HabitSchedulePeriodRow ->
// HabitSchedulePeriod and LapseReasonRow -> LapseReasonEntry, mirroring lib/supabase-sync.ts's
// rowToPeriod/rowToLapseReason. The unrecognised-lapse-reason question (docs/phase-5-plan.md,
// section 10) is resolved: `reason` is enforced by a validated Postgres CHECK constraint
// (lapse_reasons_reason_check) to NULL or one of the five LapseReasonKey values, so
// toDomainLapseReason's `as LapseReasonKey | null` cast is unchecked but currently safe -- see
// that section for the full evidence and the residual dependency on the constraint remaining
// intact. Neither mapper has a caller yet -- there is still no habit_schedule_periods or
// lapse_reasons DB read in this file, so nothing here constructs a HabitSchedulePeriod or
// LapseReasonEntry from a real row outside the test suite. That remains Part 2 work.
type ScheduleDays = 'daily' | number[];
type HabitSchedulePeriod = { id: string; habitId: string; effectiveFrom: string; days: ScheduleDays; paused: boolean; createdAt: string };
type LapseReasonKey = 'too_busy' | 'forgot' | 'low_energy' | 'not_feeling_it' | 'something_else';
type LapseReasonEntry = { habitId: string; createdAt: string; reason: LapseReasonKey | null };
type HabitSchedulePeriodRow = { id: string; habit_id: string; effective_from: string; days_of_week: number[] | null; paused: boolean; created_at: string };
type LapseReasonRow = { habit_id: string; created_at: string; reason: string | null };

function toDomainHabit(row: HabitRow): Habit {
  return { id: row.id, type: row.type, targetCount: row.target_count ?? undefined, createdAt: row.created_at };
}

function toDomainLogs(rows: LogRow[]): HabitLog[] {
  return rows.map((row) => ({ habitId: row.habit_id, date: row.date, count: row.count, reduced: row.reduced ?? undefined }));
}

/**
 * Row-to-domain conversion for HabitSchedulePeriod, mirroring lib/supabase-sync.ts's rowToPeriod
 * (Phase 4) for the fields HabitSchedulePeriod itself declares -- id/updatedAt beyond what the
 * minimal shim above carries are not part of this mapper's output, since nothing in the generated
 * closure constructs or reads them. `days_of_week: null` maps to `'daily'`; a non-null array is
 * passed through unchanged -- the same two rules rowToPeriod already encodes.
 */
function toDomainSchedulePeriod(row: HabitSchedulePeriodRow): HabitSchedulePeriod {
  return {
    id: row.id,
    habitId: row.habit_id,
    effectiveFrom: row.effective_from,
    days: row.days_of_week ?? 'daily',
    paused: row.paused,
    createdAt: row.created_at,
  };
}

/**
 * Row-to-domain conversion for LapseReasonEntry, mirroring lib/supabase-sync.ts's
 * rowToLapseReason (Phase 4) for the fields LapseReasonEntry itself declares --
 * id/missedOpportunityDate/note/skipped/updatedAt beyond what the minimal shim above carries are
 * not part of this mapper's output, since nothing in the generated closure constructs or reads
 * them. The `as LapseReasonKey | null` cast is unchecked but currently safe: `reason` is enforced
 * by a validated Postgres CHECK constraint (lapse_reasons_reason_check) to NULL or one of the
 * five LapseReasonKey values (docs/phase-5-plan.md, section 10) -- if that constraint is ever
 * dropped, loosened, or replaced, this cast (and rowToLapseReason's identical one) becomes
 * unsound.
 */
function toDomainLapseReason(row: LapseReasonRow): LapseReasonEntry {
  return {
    habitId: row.habit_id,
    createdAt: row.created_at,
    reason: row.reason as LapseReasonKey | null,
  };
}

function localDateKey(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
}

function localTimeMinutes(timezone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const [hour, minute] = formatted.split(':').map(Number);
  return hour * 60 + minute;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

type Recipient = {
  user_id: string;
  coach_push_time: string;
  coach_push_timezone: string;
  coach_push_last_sent_date: string | null;
};

async function sendExpoPush(tokens: string[], body: string) {
  if (tokens.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title: '🧠 AI Coach', body, sound: 'default' }))),
  });
}

/**
 * The whole per-recipient job: reuse a fresh nudge or sentinel if one exists (mirroring
 * ai-insights/index.ts's own sentinel-aware freshness check), otherwise build CoachFacts, select
 * the leading habit (Route C), run Part 1's orchestration, and push. Returns whether a push was
 * actually sent. An `ai_insights` insert failure is logged but never thrown, never suppresses the
 * push, and never prevents the caller from stamping `coach_push_last_sent_date` -- that stamping
 * happens in the caller, unconditionally reached whenever this function returns normally.
 */
// deno-lint-ignore no-explicit-any
async function processRecipient(supabase: any, anthropic: Anthropic, recipient: Recipient, today: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('ai_insights')
    .select('content, created_at, habit_id')
    .eq('user_id', recipient.user_id)
    .eq('kind', 'nudge')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let content: string | null = null;

  if (existing) {
    const isSentinel = existing.content === '';
    const nowIso = new Date().toISOString();
    const stillFresh = isSentinel
      ? isWithinFailureBackoff(existing.created_at, 'nudge', nowIso)
      : new Date(existing.created_at).getTime() > Date.now() - NUDGE_FRESHNESS_HOURS * 60 * 60 * 1000;
    if (stillFresh) content = isSentinel ? '' : sanitizeContent(existing.content);
  }

  if (content === null) {
    // No fixed lower bound on habit_logs (docs/phase-5-plan.md section 8, ruled 2026-09-11) -- see
    // ai-insights/index.ts's equivalent comment for the full reasoning. This function uses the
    // service-role key, so unlike ai-insights there is no RLS backstop: every read stays
    // explicitly scoped to `.eq('user_id', ...)`.
    const [{ data: habits }, { data: logs }, { data: schedulePeriodRows }, { data: lapseReasonRows }] = await Promise.all([
      supabase.from('habits').select('id, name, emoji, type, target_count, created_at').eq('user_id', recipient.user_id).is('deleted_at', null),
      supabase.from('habit_logs').select('habit_id, date, count, reduced').eq('user_id', recipient.user_id),
      supabase.from('habit_schedule_periods').select('id, habit_id, effective_from, days_of_week, paused, created_at').eq('user_id', recipient.user_id),
      supabase.from('lapse_reasons').select('habit_id, created_at, reason').eq('user_id', recipient.user_id),
    ]);

    if (!habits || habits.length === 0) return false; // nothing logged yet -- nothing worth pushing

    const schedulePeriods = ((schedulePeriodRows ?? []) as HabitSchedulePeriodRow[]).map(toDomainSchedulePeriod);
    const lapseReasons = ((lapseReasonRows ?? []) as LapseReasonRow[]).map(toDomainLapseReason);
    const facts = buildCoachFacts(
      (habits as HabitRow[]).map(toDomainHabit),
      toDomainLogs((logs ?? []) as LogRow[]),
      schedulePeriods,
      lapseReasons,
      today,
      'nudge',
    );

    const selectedHabit = hasGroundedInsight(facts) ? selectLeadingHabit(facts) : null;
    const factsForGeneration: CoachFacts = selectedHabit ? { habits: [selectedHabit] } : facts;

    const result = await resolveCoachGeneration(factsForGeneration, 'nudge', {
      generateGroundedText: async () => {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          output_config: { effort: 'low' },
          system: NUDGE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Today is ${today}. Here is this habit's data as JSON:\n${JSON.stringify(factsForGeneration.habits[0])}\n\nWrite the coaching message now, following every rule above.`,
            },
          ],
        });
        return response.content.find((block) => block.type === 'text')?.text ?? '';
      },
      fallbackProvider: buildFallbackProvider(recipient.user_id, today),
      validateCoachOutput: combinedValidate,
    });

    if (result.path === 'rejected') {
      const diagnostic = buildRejectionDiagnostic('nudge', factsForGeneration, result.validation);
      // matchedPhrases (docs/phase-5-plan.md section 6.4) keeps a lexical rejection distinguishable
      // from a numeric one -- see ai-insights/index.ts's identical comment.
      console.error(JSON.stringify({ fn: 'send-coaching-push', op: 'coach generation rejected', ...diagnostic, matchedPhrases: result.validation.matchedPhrases, stamp: SOURCE_STAMP }));

      await applyRejectionConsequences({
        persistFailureSentinel: async () => {
          const { error: insertError } = await supabase.from('ai_insights').insert({
            ...buildFailureSentinelRow('nudge', recipient.user_id, 'claude-sonnet-4-6', new Date().toISOString()),
            habit_id: selectedHabit ? selectedHabit.habitId : null,
          });
          if (insertError) {
            console.error(
              JSON.stringify({ fn: 'send-coaching-push', op: 'ai_insights insert', kind: 'nudge', code: insertError.code, message: insertError.message }),
            );
          }
        },
        markCronPushHandledToday: async () => {
          await supabase.from('user_settings').update({ coach_push_last_sent_date: today }).eq('user_id', recipient.user_id);
        },
      });

      return false;
    }

    content = sanitizeContent(result.content);
    const habitId = selectedHabit ? selectedHabit.habitId : null;

    const { error: insertError } = await supabase.from('ai_insights').insert({
      id: crypto.randomUUID(),
      user_id: recipient.user_id,
      kind: 'nudge',
      period_start: null,
      period_end: null,
      content,
      model: 'claude-sonnet-4-6',
      habit_id: habitId,
    });
    if (insertError) {
      console.error(JSON.stringify({ fn: 'send-coaching-push', op: 'ai_insights insert', kind: 'nudge', code: insertError.code, message: insertError.message }));
    }
  }

  if (content === '') {
    // A fresh sentinel already existed (written by this or an earlier attempt today, in-app or
    // cron) -- nothing to push, and marking the day handled here is what stops every subsequent
    // cron tick today from re-checking the same cache entry (the same reasoning
    // applyRejectionConsequences's markCronPushHandledToday already applies to a rejection this
    // tick causes itself; this covers the case where the sentinel already existed before this
    // tick ran at all).
    await supabase.from('user_settings').update({ coach_push_last_sent_date: today }).eq('user_id', recipient.user_id);
    return false;
  }
  if (!content) return false; // no habits logged yet -- nothing to push, and nothing to mark handled either (unchanged from before this step)

  const { data: tokenRows } = await supabase.from('push_tokens').select('token').eq('user_id', recipient.user_id);
  const tokens = ((tokenRows ?? []) as { token: string }[]).map((row) => row.token);
  await sendExpoPush(tokens, content);

  await supabase.from('user_settings').update({ coach_push_last_sent_date: today }).eq('user_id', recipient.user_id);
  return true;
}

Deno.serve(async (req) => {
  // This function uses the service-role key and runs across all users — it must only
  // be callable by the Supabase Cron scheduler, not by arbitrary callers.
  // Set CRON_SECRET as a Supabase Edge Function secret and pass it as the
  // x-cron-secret header in the Supabase Cron scheduler configuration.
  //
  // Branch order below is deliberate and load-bearing: authenticate FIRST, for every method, then
  // branch on method. An authenticated GET returns the deployment stamp and nothing else, and it
  // returns before the Supabase client is constructed, before any database read, before Anthropic
  // is touched and before any push is sent -- there is no later guard it depends on. Only POST
  // reaches the job itself.

  // 1. Fail closed: with no secret configured, refuse everything rather than ever running with
  //    service-role privileges for an arbitrary caller.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('send-coaching-push: CRON_SECRET secret is not configured');
    return new Response(JSON.stringify({ error: 'Service misconfigured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Authenticate every caller, whatever the method. Nothing below this point is reachable
  //    without the cron secret.
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Deployment identification only. No side effects of any kind: this function is the one that
  //    reaches users without them opening the app, so reading its version must never be capable of
  //    sending a notification. See docs/phase-5-precondition-review.md, B6.
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ stamp: SOURCE_STAMP }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4. Cron uses POST; reject anything else.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. POST: the real job. Everything from here on is unchanged.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const now = new Date();

  const { data: recipients, error } = await supabase
    .from('user_settings')
    .select('user_id, coach_push_time, coach_push_timezone, coach_push_last_sent_date')
    .eq('coach_push_enabled', true)
    .not('coach_push_time', 'is', null)
    .not('coach_push_timezone', 'is', null);

  if (error) {
    console.error('send-coaching-push: failed to load recipients', error);
    return new Response(JSON.stringify({ error: 'Failed to load recipients' }), { status: 500 });
  }

  let sent = 0;

  for (const recipient of (recipients ?? []) as Recipient[]) {
    const today = localDateKey(recipient.coach_push_timezone, now);
    if (!shouldCronAttemptToday(recipient.coach_push_last_sent_date, today)) continue;

    const currentMinutes = localTimeMinutes(recipient.coach_push_timezone, now);
    if (currentMinutes < timeToMinutes(recipient.coach_push_time)) continue;

    try {
      const wasSent = await processRecipient(supabase, anthropic, recipient, today);
      if (wasSent) sent += 1;
    } catch (err) {
      console.error(`send-coaching-push: failed for user ${recipient.user_id}`, err);
    }
  }

  return new Response(JSON.stringify({ sent, checked: recipients?.length ?? 0, stamp: SOURCE_STAMP }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
