import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { HABIT_HEALTH_CONFIG } from './config';
import { addDays } from './day-key';
import { habitHealthVerdict, type HabitHealthVerdict } from './habit-health';
import { scheduledOpportunitiesUpTo } from './schedule';

// Behavioural-contract fixtures for Habit Health, per docs/phase-5-plan.md section 4.1's settled
// mechanism and constants. Every fixture here targets a specific case named in the Step 2 part 1
// authorisation as one where a plausible implementation can be wrong in a way that reading the
// code would not catch -- ramp-up, the gate boundary, the margin boundary, the absence of any
// decline state, statelessness, non-daily schedules, pause history, and transience.

const { comparisonBlockOpportunities: L } = HABIT_HEALTH_CONFIG;

const CREATED = '2026-01-01';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: `${CREATED}T00:00:00.000Z`,
    updatedAt: `${CREATED}T00:00:00.000Z`,
    ...overrides,
  };
}

function period(overrides: Partial<HabitSchedulePeriod> = {}): HabitSchedulePeriod {
  return {
    id: 'p1',
    habitId: 'h1',
    effectiveFrom: CREATED,
    days: 'daily',
    paused: false,
    createdAt: `${CREATED}T00:00:00.000Z`,
    updatedAt: `${CREATED}T00:00:00.000Z`,
    ...overrides,
  };
}

function log(habitId: string, date: string): HabitLog {
  return { id: `${habitId}-${date}`, habitId, date, count: 1, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

/**
 * For a daily, unpaused habit created at CREATED, the `today` that produces exactly
 * `resolvedLength` Scheduled Opportunities in `resolved` (creation through yesterday). Day 0 =
 * CREATED is the 1st opportunity, ..., day `resolvedLength - 1` is the last one included, so
 * `today` is exactly `resolvedLength` days after creation.
 */
function todayForResolvedLength(resolvedLength: number): string {
  return addDays(CREATED, resolvedLength);
}

/** Walks `today` forward one day at a time until `resolved` reaches at least `minLength` Scheduled Opportunities -- used for non-daily/paused schedules where the day-to-opportunity mapping isn't 1:1. */
function walkUntilAtLeast(h: Habit, periods: HabitSchedulePeriod[], minLength: number): { today: string; dates: string[] } {
  let today = CREATED;
  let dates: string[] = [];
  while (dates.length < minLength) {
    today = addDays(today, 1);
    dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
  }
  return { today, dates };
}

describe('a brand-new habit with no history', () => {
  it('is insufficient_evidence', () => {
    const h = habit();
    const periods = [period()];
    expect(habitHealthVerdict(h, periods, [], CREATED)).toBe('insufficient_evidence');
  });
});

describe('ramp-up and the gate boundary (daily schedule, every opportunity completed)', () => {
  const h = habit();
  const periods = [period()];

  it('insufficient_evidence when the smaller (preceding) block has 9 opportunities -- one below the gate', () => {
    const today = todayForResolvedLength(23); // R = 14, P = 9
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    expect(dates.length).toBe(23);
    const logs = dates.map((d) => log(h.id, d));
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('insufficient_evidence');
  });

  it('produces a real verdict at exactly 10 in the smaller block -- the gate governs eligibility, not block equality (P=10 is shorter than R=14 here, not equal to it)', () => {
    const today = todayForResolvedLength(24); // R = 14, P = 10
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    expect(dates.length).toBe(24);
    const logs = dates.map((d) => log(h.id, d));
    const verdict = habitHealthVerdict(h, periods, logs, today);
    expect(verdict).not.toBe('insufficient_evidence');
    // Both blocks are uniformly 100% complete here, so the rate difference is 0 -- this fixture
    // isolates eligibility from the margin, so the specific non-insufficient outcome is
    // deterministic too.
    expect(verdict).toBe('no_positive_recent_comparison');
  });

  it('remains a real verdict at 11 in the smaller block', () => {
    const today = todayForResolvedLength(25); // R = 14, P = 11
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    expect(dates.length).toBe(25);
    const logs = dates.map((d) => log(h.id, d));
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('no_positive_recent_comparison');
  });
});

describe('margin boundary at L=14 (both blocks full, 14 vs 14)', () => {
  const h = habit();
  const periods = [period()];
  const today = todayForResolvedLength(2 * L); // 28: R = dates[14..27], P = dates[0..13]
  const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));

  it('sanity: exactly 28 opportunities, split 14 preceding / 14 recent', () => {
    expect(dates.length).toBe(2 * L);
  });

  // At L=14 the achievable rate difference quantises in steps of 1/14 (~7.14pp): 0.25 sits
  // strictly between 3/14 (~0.214) and 4/14 (~0.286), so no integer completion count lands
  // exactly on 0.25. 3/14 is the largest achievable value immediately below the margin; 4/14 is
  // the smallest achievable value at or above it, and therefore stands in for both "at" and
  // "immediately above" in terms of the decision the `>=` comparison actually makes.
  it('a 3-completion gap (3/14, the largest achievable value immediately below 0.25) does not clear the margin', () => {
    const logs = [
      ...dates.slice(0, 10).map((d) => log(h.id, d)), // preceding: 10 of 14 completed
      ...dates.slice(14, 27).map((d) => log(h.id, d)), // recent: 13 of 14 completed
    ];
    // diff = 13/14 - 10/14 = 3/14 ~= 0.2143
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('no_positive_recent_comparison');
  });

  it('a 4-completion gap (4/14, the smallest achievable value at or above 0.25) clears the margin', () => {
    const logs = [
      ...dates.slice(0, 9).map((d) => log(h.id, d)), // preceding: 9 of 14 completed
      ...dates.slice(14, 27).map((d) => log(h.id, d)), // recent: 13 of 14 completed
    ];
    // diff = 13/14 - 9/14 = 4/14 ~= 0.2857
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('positive_recent_comparison');
  });
});

describe('margin predicate, pinned at exact equality', () => {
  // At L=14 with both blocks full, no integer completion count lands on exactly 0.25 -- see the
  // block above. That leaves the predicate's own inclusivity (>= vs >) untested by construction:
  // under the current 14-vs-14 block size the two operators are behaviourally identical, and a
  // wrong operator would pass every test in this file so far. This block exists solely to close
  // that gap, using a real, reachable ramp-up block pair rather than a new test-only abstraction.
  //
  // During ramp-up the preceding block can be shorter than 14 (Required explanation 1). At
  // preceding-block length 12 specifically, recentRate=7/14=0.5 and precedingRate=3/12=0.25 gives
  // a difference of *exactly* 0.25 -- verified by exhaustive search over every (R=14, P in
  // [10..14], a of R, b of P) combination the gate permits, and exact in IEEE 754 (0.5, 0.25, and
  // their difference are all precisely representable dyadic fractions, so this is a bit-exact
  // `===`, not an approximation). This is the only reachable pair at the current L/margin that
  // hits the boundary on the nose, which is exactly why it is the one used here.
  //
  // The implemented predicate is `recentRate - precedingRate >= margin`. This test passes under
  // that operator and would fail under `>` -- it is a discriminating test of inclusivity, not a
  // restatement of the value.
  it('a preceding block of length 12 (recentRate=0.5, precedingRate=0.25, diff exactly 0.25) reaches positive_recent_comparison, pinning >= as the intended inclusive boundary', () => {
    const h = habit();
    const periods = [period()];
    const today = todayForResolvedLength(L + 12); // 26: R = dates[12..25] (14), P = dates[0..11] (12)
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    expect(dates.length).toBe(L + 12);

    const precedingBlock = dates.slice(0, 12);
    const recentBlock = dates.slice(12, 26);
    expect(precedingBlock.length).toBe(12);
    expect(recentBlock.length).toBe(L);

    const recentDone = 7; // 7/14 = 0.5
    const precedingDone = 3; // 3/12 = 0.25
    expect(0.5 - 0.25).toBe(0.25); // sanity: the arithmetic below is bit-exact, not approximate

    const logs = [...precedingBlock.slice(0, precedingDone).map((d) => log(h.id, d)), ...recentBlock.slice(0, recentDone).map((d) => log(h.id, d))];

    expect(habitHealthVerdict(h, periods, logs, today)).toBe('positive_recent_comparison');
  });
});

describe('no negative or declining state exists', () => {
  it('a recent block markedly worse than the preceding block still returns no_positive_recent_comparison, never a decline state', () => {
    const h = habit();
    const periods = [period()];
    const today = todayForResolvedLength(2 * L);
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    // preceding: 14 of 14 (perfect). recent: 0 of 14 (total collapse).
    const logs = dates.slice(0, L).map((d) => log(h.id, d));
    const verdict = habitHealthVerdict(h, periods, logs, today);
    expect(verdict).toBe('no_positive_recent_comparison');
    // The return type only has three members and none of them names a decline -- this assertion
    // documents that fact at the value level, not only at the type level.
    const possibleVerdicts = ['insufficient_evidence', 'no_positive_recent_comparison', 'positive_recent_comparison'];
    expect(possibleVerdicts).toContain(verdict);
  });
});

describe('statelessness', () => {
  it('the same inputs evaluated twice, including once after an intervening call with different inputs, return the same verdict', () => {
    const h = habit();
    const periods = [period()];
    const today = todayForResolvedLength(2 * L);
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    const logs = [
      ...dates.slice(0, 9).map((d) => log(h.id, d)),
      ...dates.slice(14, 27).map((d) => log(h.id, d)),
    ];

    const first = habitHealthVerdict(h, periods, logs, today);

    // Interleave a call with an entirely different habit and history.
    const other = habit({ id: 'h2', createdAt: '2020-01-01T00:00:00.000Z' });
    const otherPeriods = [period({ id: 'p2', habitId: 'h2', effectiveFrom: '2020-01-01' })];
    habitHealthVerdict(other, otherPeriods, [], addDays('2020-01-01', 100));

    const second = habitHealthVerdict(h, periods, logs, today);

    expect(second).toBe(first);
    expect(first).toBe('positive_recent_comparison');
  });
});

describe('non-daily schedules -- Scheduled Opportunities, not calendar days, are the unit', () => {
  it('Mon/Wed/Fri: a clear positive comparison is detected once enough opportunities exist', () => {
    const h = habit();
    const periods = [period({ days: [1, 3, 5] })];
    const { today, dates } = walkUntilAtLeast(h, periods, 2 * L);
    expect(dates.length).toBeGreaterThanOrEqual(2 * L);

    const recentBlock = dates.slice(-L);
    const precedingBlock = dates.slice(Math.max(0, dates.length - 2 * L), Math.max(0, dates.length - L));
    expect(recentBlock.length).toBe(L);
    expect(precedingBlock.length).toBe(L);

    // preceding: half completed. recent: fully completed.
    const logs = [...precedingBlock.filter((_, i) => i % 2 === 0).map((d) => log(h.id, d)), ...recentBlock.map((d) => log(h.id, d))];
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('positive_recent_comparison');
  });

  it('weekends-only: a worse recent block still returns no_positive_recent_comparison, not a decline state', () => {
    const h = habit();
    const periods = [period({ days: [0, 6] })];
    const { today, dates } = walkUntilAtLeast(h, periods, 2 * L);

    const recentBlock = dates.slice(-L);
    const precedingBlock = dates.slice(Math.max(0, dates.length - 2 * L), Math.max(0, dates.length - L));

    // preceding fully completed, recent entirely missed.
    const logs = precedingBlock.map((d) => log(h.id, d));
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('no_positive_recent_comparison');
  });
});

describe('pause history', () => {
  it('a schedule pause spanning part of the preceding block contributes zero opportunities to it, rather than a run of misses', () => {
    const h = habit();
    const pauseStart = addDays(CREATED, 5);
    const resumeStart = addDays(CREATED, 15); // 10 calendar days paused
    const periods: HabitSchedulePeriod[] = [
      period({ id: 'p1', effectiveFrom: CREATED, paused: false }),
      period({ id: 'p2', effectiveFrom: pauseStart, paused: true }),
      period({ id: 'p3', effectiveFrom: resumeStart, paused: false }),
    ];

    const { today, dates } = walkUntilAtLeast(h, periods, 2 * L);
    expect(dates.length).toBe(2 * L); // daily cadence resumes after the pause, so this lands exactly

    // None of the paused calendar days appear as Scheduled Opportunities at all.
    for (let d = pauseStart; d < resumeStart; d = addDays(d, 1)) {
      expect(dates).not.toContain(d);
    }

    const recentBlock = dates.slice(-L);
    const precedingBlock = dates.slice(Math.max(0, dates.length - 2 * L), Math.max(0, dates.length - L));
    expect(recentBlock.length).toBe(L);
    expect(precedingBlock.length).toBe(L);
    // The preceding block's calendar span includes the pause (it runs from the 1st opportunity,
    // pre-pause, through the 14th, well after resume), yet its Scheduled Opportunity count is
    // still exactly L -- the paused stretch contributed no opportunities to it, positive or
    // negative.

    // preceding: none completed. recent: fully completed -- unambiguous positive comparison. If
    // the pause had instead been counted as a run of misses (a calendar-day denominator), the
    // preceding block's true opportunity count would differ and this fixture would not isolate
    // the comparison this cleanly.
    const logs = recentBlock.map((d) => log(h.id, d));
    expect(habitHealthVerdict(h, periods, logs, today)).toBe('positive_recent_comparison');
  });
});

describe('transience: an improvement is reported while recent-only, then reverts to no_positive_recent_comparison once it ages into both blocks -- never presented as decline', () => {
  const h = habit();
  const periods = [period()];
  const lowEraLength = L; // opportunities [0, L) are the low-completion era; [L, ...) is the sustained high era

  function logsForHistory(dates: string[]): HabitLog[] {
    return [
      ...dates.slice(0, lowEraLength).filter((_, i) => i % 5 === 0).map((d) => log(h.id, d)), // ~20% of the low era
      ...dates.slice(lowEraLength).map((d) => log(h.id, d)), // 100% of everything from the jump onward
    ];
  }

  it('detects the improvement while the preceding block is still entirely the low era and the recent block is entirely the high era', () => {
    const today = todayForResolvedLength(2 * L); // P = [0, L) low era, R = [L, 2L) high era
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    expect(habitHealthVerdict(h, periods, logsForHistory(dates), today)).toBe('positive_recent_comparison');
  });

  it('returns to no_positive_recent_comparison once both blocks sit entirely inside the high era -- not a regression, since the recent completion rate has not fallen at all', () => {
    const today = todayForResolvedLength(3 * L); // both P and R now sit entirely within [L, 3L)
    const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
    const verdict = habitHealthVerdict(h, periods, logsForHistory(dates), today);
    expect(verdict).toBe('no_positive_recent_comparison');
    expect(verdict).not.toBe('insufficient_evidence');
  });
});

describe('domain-internal naming', () => {
  it('the three verdict values are exactly the approved set, no more and no fewer', () => {
    // A compile-time check as much as a runtime one: this exhaustive switch fails to compile (via
    // the `never`-typed default) if HabitHealthVerdict ever gains or loses a member, independent
    // of whatever any individual test above happened to assert.
    function describeExhaustively(verdict: HabitHealthVerdict): string {
      switch (verdict) {
        case 'insufficient_evidence':
          return 'insufficient_evidence';
        case 'no_positive_recent_comparison':
          return 'no_positive_recent_comparison';
        case 'positive_recent_comparison':
          return 'positive_recent_comparison';
        default: {
          const exhaustive: never = verdict;
          throw new Error(`unhandled HabitHealthVerdict: ${exhaustive}`);
        }
      }
    }

    const all: HabitHealthVerdict[] = ['insufficient_evidence', 'no_positive_recent_comparison', 'positive_recent_comparison'];
    expect(all.map(describeExhaustively)).toEqual(all);
  });
});
