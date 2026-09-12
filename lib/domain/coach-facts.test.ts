import type { Habit, HabitLog, HabitSchedulePeriod, LapseReasonEntry } from '../habit-types';
import { addDays } from './day-key';
import {
  buildCoachFacts,
  hasGroundedInsight,
  selectLeadingHabit,
  type CoachFacts,
  type HabitCoachFacts,
  type LapseReasonDistributionKey,
} from './coach-facts';
import { habitHealthVerdict } from './habit-health';
import { confirmedStateAt } from './momentum';
import { averageRecoveryTime, recoveryEvents, recoveryRate } from './recovery';
import { consistency, totalCompletions } from './habit-stats';
import { scheduledOpportunitiesInWindow, scheduledOpportunitiesUpTo } from './schedule';

// Behavioural-contract fixtures for buildCoachFacts, per docs/phase-5-plan.md section 4.2. Every
// field is cross-checked directly against the same authoritative domain function buildCoachFacts
// itself calls, not against a hand-computed expectation -- proving orchestration, never a second
// implementation of the underlying rule.

const CREATED = '2026-01-01';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'ZZ-Distinctive-Habit-Name',
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

function lapseReason(overrides: Partial<LapseReasonEntry> = {}): LapseReasonEntry {
  return {
    id: 'lr1',
    habitId: 'h1',
    missedOpportunityDate: '2026-01-02',
    reason: null,
    skipped: true,
    createdAt: '2026-01-02T12:00:00.000Z',
    updatedAt: '2026-01-02T12:00:00.000Z',
    ...overrides,
  };
}

/** A rich daily history: 41 opportunities, missing (and immediately recovering) on days 2, 10 and 20 -- three closed Lapses, all short, all recovered, clearing every display gate. */
function richHistory(): { h: Habit; periods: HabitSchedulePeriod[]; logs: HabitLog[]; today: string } {
  const h = habit();
  const periods = [period()];
  const today = addDays(CREATED, 41); // 41 opportunities resolved (creation through yesterday, inclusive of both ends)
  const dates = scheduledOpportunitiesUpTo(h, periods, addDays(today, -1));
  const missed = new Set([dates[1], dates[9], dates[19]]); // days 2, 10, 20 (0-indexed)
  const logs = dates.filter((d) => !missed.has(d)).map((d) => log(h.id, d));
  return { h, periods, logs, today };
}

describe('buildCoachFacts -- field-by-field cross-check against the authoritative domain functions', () => {
  const { h, periods, logs, today } = richHistory();
  const facts = buildCoachFacts([h], logs, periods, [], today, 'nudge');
  const habitFacts = facts.habits[0];

  it('produces exactly one record, keyed by habit id', () => {
    expect(facts.habits).toHaveLength(1);
    expect(habitFacts.habitId).toBe(h.id);
  });

  it('momentumState matches confirmedStateAt exactly', () => {
    expect(habitFacts.momentumState).toBe(confirmedStateAt(h, periods, logs, today));
  });

  it('totalCompletions matches totalCompletions exactly', () => {
    expect(habitFacts.totalCompletions).toBe(totalCompletions(h.id, logs));
    expect(habitFacts.totalCompletions).toBe(38); // 41 opportunities minus 3 misses
  });

  it('recoveryCount matches recoveryEvents().length exactly', () => {
    expect(habitFacts.recoveryCount).toBe(recoveryEvents(h, periods, logs, today).length);
    expect(habitFacts.recoveryCount).toBe(3);
  });

  it('recoveryRatePct is present and equals the rounded rolling rate once the display gate clears', () => {
    const rate = recoveryRate(h, periods, logs, today);
    expect(rate.rolling.displayAsPercentage).toBe(true); // 3 resolved instances, all recovered -- clears both gates
    expect(habitFacts.recoveryRatePct).toBe(Math.round((rate.rolling.rate ?? 0) * 100));
    expect(habitFacts.recoveryRatePct).toBe(100);
  });

  it('averageRecoveryTimeDays is present and equals averageRecoveryTime rounded to one decimal place', () => {
    const avg = averageRecoveryTime(h, periods, logs, today);
    expect(avg).not.toBeNull();
    expect(habitFacts.averageRecoveryTimeDays).toBe(Math.round((avg ?? 0) * 10) / 10);
    expect(habitFacts.averageRecoveryTimeDays).toBe(1);
  });

  it('consistencyPct and consistencyWindowOpportunities are present and match the underlying calls (14-day window)', () => {
    const rate = consistency(h, logs, 14, periods, today);
    expect(rate).not.toBeNull();
    expect(habitFacts.consistencyPct).toBe(Math.round((rate ?? 0) * 100));
    expect(habitFacts.consistencyWindowOpportunities).toBe(scheduledOpportunitiesInWindow(h, periods, 14, today).length);
    expect(habitFacts.consistencyWindowOpportunities).toBe(14);
  });

  it('habitHealth matches habitHealthVerdict exactly', () => {
    expect(habitFacts.habitHealth).toBe(habitHealthVerdict(h, periods, logs, today));
  });

  it('lapseReasonCounts is present with all six keys, all zero (no lapse reasons supplied)', () => {
    const expected: Record<LapseReasonDistributionKey, number> = {
      too_busy: 0,
      forgot: 0,
      low_energy: 0,
      not_feeling_it: 0,
      something_else: 0,
      skipped_without_reason: 0,
    };
    expect(habitFacts.lapseReasonCounts).toEqual(expected);
  });
});

describe('recoveryRatePct: structural absence, not a false flag', () => {
  it('is entirely absent from the record when displayAsPercentage is false (too few resolved instances)', () => {
    const h = habit();
    const periods = [period()];
    // One miss, one recovery -- a single resolved instance, below minResolvedLapsesForPercentage (3).
    const logs = [log(h.id, CREATED), log(h.id, addDays(CREATED, 2))];
    const today = addDays(CREATED, 3);

    const rate = recoveryRate(h, periods, logs, today);
    expect(rate.rolling.displayAsPercentage).toBe(false); // sanity: the gate really is closed here

    const habitFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge').habits[0];
    expect('recoveryRatePct' in habitFacts).toBe(false);
    expect(Object.keys(habitFacts)).not.toContain('recoveryRatePct');
    expect(JSON.stringify(habitFacts)).not.toContain('recoveryRatePct');
  });
});

describe('averageRecoveryTimeDays: structural absence below the closed-Lapse threshold', () => {
  it('is entirely absent when fewer than minClosedLapsesForRecoveryTime (2) Lapses have closed', () => {
    const h = habit();
    const periods = [period()];
    const logs = [log(h.id, CREATED), log(h.id, addDays(CREATED, 2))]; // exactly one closed Lapse
    const today = addDays(CREATED, 3);

    expect(averageRecoveryTime(h, periods, logs, today)).toBeNull(); // sanity

    const habitFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge').habits[0];
    expect('averageRecoveryTimeDays' in habitFacts).toBe(false);
  });
});

describe('consistencyPct / consistencyWindowOpportunities: structural absence together', () => {
  it('are both absent when the Consistency window contains no Scheduled Opportunities (habit paused throughout)', () => {
    const h = habit();
    const periods: HabitSchedulePeriod[] = [
      period({ id: 'p1', effectiveFrom: CREATED, paused: true }), // paused from creation onward
    ];
    const today = addDays(CREATED, 20);

    expect(consistency(h, [], 14, periods, today)).toBeNull(); // sanity

    const habitFacts = buildCoachFacts([h], [], periods, [], today, 'nudge').habits[0];
    expect('consistencyPct' in habitFacts).toBe(false);
    expect('consistencyWindowOpportunities' in habitFacts).toBe(false);
  });
});

describe('kind selects the Consistency window: nudge=14 / weekly=7 / monthly=30, restoring the pre-Phase-5 per-kind windows', () => {
  // The raw 14/7/30 values are pinned in lib/domain/config.test.ts, alongside every other
  // Phase 2+ domain threshold -- not re-pinned here, matching the established convention (neither
  // momentum.test.ts nor recovery.test.ts re-pins MOMENTUM_CONFIG/RECOVERY_CONFIG either). The
  // tests below exercise buildCoachFacts' *behaviour* under each kind, not the constant's value.

  it('consistencyWindowOpportunities differs by kind for the identical habit, logs, and today -- the denominator changes because the window itself changes, not because anything else does', () => {
    const h = habit();
    const periods = [period()];
    const today = addDays(CREATED, 31); // enough daily history for a full 30-day window
    // consistency()'s window is the trailing `days` calendar days ENDING AT AND INCLUDING today
    // (scheduledOpportunitiesInWindow's own convention) -- a different boundary from Habit
    // Health's "through yesterday," so dates/logs here must include today itself.
    const dates = scheduledOpportunitiesUpTo(h, periods, today);
    const logs = dates.map((d) => log(h.id, d)); // fully completed throughout, including today

    const nudgeFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge').habits[0];
    const weeklyFacts = buildCoachFacts([h], logs, periods, [], today, 'weekly').habits[0];
    const monthlyFacts = buildCoachFacts([h], logs, periods, [], today, 'monthly').habits[0];

    expect(nudgeFacts.consistencyWindowOpportunities).toBe(14);
    expect(weeklyFacts.consistencyWindowOpportunities).toBe(7);
    expect(monthlyFacts.consistencyWindowOpportunities).toBe(30);

    // The habit is fully completed throughout, so consistencyPct is 100 regardless of kind here --
    // the *opportunity count* (the denominator) is what varies; a separate fixture below varies
    // the *rate* by kind too, for a habit whose completion pattern differs across the three windows.
    expect(nudgeFacts.consistencyPct).toBe(100);
    expect(weeklyFacts.consistencyPct).toBe(100);
    expect(monthlyFacts.consistencyPct).toBe(100);
  });

  it('consistencyPct itself differs by kind when the completion pattern differs between the recent week, the recent two weeks, and the recent month', () => {
    const h = habit();
    const periods = [period()];
    const today = addDays(CREATED, 31);
    const dates = scheduledOpportunitiesUpTo(h, periods, today); // 32 opportunities (days 0-31), through today inclusive
    // Miss every opportunity except the most recent 7 days (days 25-31, i.e. today and the six
    // before it). So: last 7 days = 100% done; last 14 days = 7 done of 14 (50%); last 30 days =
    // 7 done of 30 (~23%).
    const logs = dates.slice(-7).map((d) => log(h.id, d));

    const weeklyFacts = buildCoachFacts([h], logs, periods, [], today, 'weekly').habits[0]; // last 7 days
    const nudgeFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge').habits[0]; // last 14 days
    const monthlyFacts = buildCoachFacts([h], logs, periods, [], today, 'monthly').habits[0]; // last 30 days

    expect(weeklyFacts.consistencyPct).toBe(100);
    expect(nudgeFacts.consistencyPct).toBe(50);
    expect(monthlyFacts.consistencyPct).toBe(Math.round((7 / 30) * 100));
    expect(monthlyFacts.consistencyPct).not.toBe(weeklyFacts.consistencyPct);
    expect(monthlyFacts.consistencyPct).not.toBe(nudgeFacts.consistencyPct);
  });

  it('every field other than consistencyPct/consistencyWindowOpportunities is identical across kinds for the same inputs', () => {
    const { h, periods, logs, today } = richHistory();
    const nudgeFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge').habits[0];
    const monthlyFacts = buildCoachFacts([h], logs, periods, [], today, 'monthly').habits[0];

    const { consistencyPct: _n1, consistencyWindowOpportunities: _n2, ...nudgeRest } = nudgeFacts;
    const { consistencyPct: _m1, consistencyWindowOpportunities: _m2, ...monthlyRest } = monthlyFacts;
    expect(monthlyRest).toEqual(nudgeRest);
  });
});

describe('habitHealth is always present, including insufficient_evidence', () => {
  it('a brand-new habit with no history still carries a habitHealth field', () => {
    const h = habit();
    const periods = [period()];
    const habitFacts = buildCoachFacts([h], [], periods, [], CREATED, 'nudge').habits[0];
    expect(habitFacts.habitHealth).toBe('insufficient_evidence');
  });
});

describe('lapse-reason distribution', () => {
  it('buckets a null reason as skipped_without_reason, counts a stated reason under its own key, and never leaks another habit\'s entries', () => {
    const h1 = habit({ id: 'h1' });
    const h2 = habit({ id: 'h2', name: 'Other habit' });
    const periods = [period({ habitId: 'h1' }), period({ id: 'p2', habitId: 'h2' })];
    const lapseReasons: LapseReasonEntry[] = [
      lapseReason({ id: 'lr1', habitId: 'h1', reason: null, skipped: true }),
      lapseReason({ id: 'lr2', habitId: 'h1', reason: 'forgot', skipped: false }),
      lapseReason({ id: 'lr3', habitId: 'h1', reason: 'forgot', skipped: false }),
      lapseReason({ id: 'lr4', habitId: 'h2', reason: 'too_busy', skipped: false }), // must not count toward h1
    ];
    const today = addDays(CREATED, 5);

    const facts = buildCoachFacts([h1, h2], [], periods, lapseReasons, today, 'nudge');
    const h1Facts = facts.habits.find((hf) => hf.habitId === 'h1')!;
    const h2Facts = facts.habits.find((hf) => hf.habitId === 'h2')!;

    expect(h1Facts.lapseReasonCounts).toEqual({
      too_busy: 0,
      forgot: 2,
      low_energy: 0,
      not_feeling_it: 0,
      something_else: 0,
      skipped_without_reason: 1,
    });
    expect(h2Facts.lapseReasonCounts).toEqual({
      too_busy: 1,
      forgot: 0,
      low_energy: 0,
      not_feeling_it: 0,
      something_else: 0,
      skipped_without_reason: 0,
    });
  });
});

describe('multi-habit input', () => {
  it('produces one record per habit, in input order, each correctly keyed', () => {
    const h1 = habit({ id: 'h1' });
    const h2 = habit({ id: 'h2', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' });
    const periods = [period({ habitId: 'h1' }), period({ id: 'p2', habitId: 'h2', effectiveFrom: '2020-01-01' })];
    const facts = buildCoachFacts([h1, h2], [], periods, [], '2026-06-01', 'nudge');

    expect(facts.habits).toHaveLength(2);
    expect(facts.habits[0].habitId).toBe('h1');
    expect(facts.habits[1].habitId).toBe('h2');
  });

  it('returns an empty habits array for no habits at all', () => {
    expect(buildCoachFacts([], [], [], [], CREATED, 'nudge')).toEqual({ habits: [] });
  });
});

describe('habit ids only, never habit names', () => {
  it('the habit\'s distinctive name never appears anywhere in the serialised facts', () => {
    const { h, periods, logs, today } = richHistory();
    const facts = buildCoachFacts([h], logs, periods, [], today, 'nudge');
    expect(JSON.stringify(facts)).not.toContain(h.name);
    expect(JSON.stringify(facts)).not.toContain(h.emoji);
    expect(Object.keys(facts.habits[0])).not.toContain('name');
    expect(Object.keys(facts.habits[0])).not.toContain('emoji');
  });
});

describe('determinism', () => {
  it('identical inputs produce a deep-equal result on repeated calls', () => {
    const { h, periods, logs, today } = richHistory();
    const first = buildCoachFacts([h], logs, periods, [], today, 'nudge');
    const second = buildCoachFacts([h], logs, periods, [], today, 'nudge');
    expect(second).toEqual(first);
  });
});

describe('structural closure: flat and numeric-leaved except the three named closed-categorical exceptions', () => {
  const MOMENTUM_STATES = ['insufficient_data', 'building', 'steady', 'recovering', 'rebuilding', 'thriving', 'quiet'];
  const HABIT_HEALTH_VERDICTS = ['insufficient_evidence', 'no_positive_recent_comparison', 'positive_recent_comparison'];
  const LAPSE_REASON_KEYS = ['too_busy', 'forgot', 'low_energy', 'not_feeling_it', 'something_else', 'skipped_without_reason'];

  function assertHabitFactsShape(habitFacts: HabitCoachFacts) {
    for (const [key, value] of Object.entries(habitFacts)) {
      if (key === 'habitId') {
        expect(typeof value).toBe('string'); // the one intentionally free-form string leaf
      } else if (key === 'momentumState') {
        expect(MOMENTUM_STATES).toContain(value);
      } else if (key === 'habitHealth') {
        expect(HABIT_HEALTH_VERDICTS).toContain(value);
      } else if (key === 'lapseReasonCounts') {
        expect(Object.keys(value as object).sort()).toEqual([...LAPSE_REASON_KEYS].sort());
        for (const count of Object.values(value as Record<string, unknown>)) {
          expect(typeof count).toBe('number');
        }
      } else {
        expect(typeof value).toBe('number');
      }
    }
  }

  it('holds for a fully-populated record', () => {
    const { h, periods, logs, today } = richHistory();
    const facts: CoachFacts = buildCoachFacts([h], logs, periods, [], today, 'nudge');
    assertHabitFactsShape(facts.habits[0]);
  });

  it('holds for a minimally-populated record (all optional fields absent)', () => {
    const h = habit();
    const periods = [period()];
    const facts = buildCoachFacts([h], [], periods, [], CREATED, 'nudge');
    assertHabitFactsShape(facts.habits[0]);
  });
});

// hasGroundedInsight -- built directly against hand-fixtured HabitCoachFacts records rather than
// through buildCoachFacts, since these are adversarial combinations chosen to stress the
// predicate's logic in isolation, not necessarily naturally-occurring domain states.

function fullHabitFacts(overrides: Partial<HabitCoachFacts> = {}): HabitCoachFacts {
  return {
    habitId: 'h1',
    momentumState: 'insufficient_data',
    totalCompletions: 0,
    recoveryCount: 0,
    lapseReasonCounts: {
      too_busy: 0,
      forgot: 0,
      low_energy: 0,
      not_feeling_it: 0,
      something_else: 0,
      skipped_without_reason: 0,
    },
    habitHealth: 'insufficient_evidence',
    ...overrides,
  };
}

function coachFactsOf(...habits: HabitCoachFacts[]): CoachFacts {
  return { habits };
}

// Revised eligibility boundary (docs/phase-5-plan.md section 6.5's amendment): only recovering,
// rebuilding, building, and thriving qualify through Momentum; steady, quiet, and insufficient_data
// do not qualify on their own, though a steady or quiet habit remains eligible through a positive
// Habit Health comparison. This narrows the first (broader) version of the predicate, which treated
// every non-insufficient_data Momentum State as eligible -- deliberately revised so the fallback is
// reachable for the established-habit case (steady/quiet with no positive Habit Health) it exists
// to cover, not only during a brand-new habit's insufficient_data window.

describe('hasGroundedInsight: qualifying Momentum states (true through Momentum alone)', () => {
  it.each<HabitCoachFacts['momentumState']>(['recovering', 'rebuilding', 'building', 'thriving'])(
    '%s qualifies on its own, with no positive Habit Health',
    (momentumState) => {
      const f = coachFactsOf(fullHabitFacts({ momentumState, habitHealth: 'no_positive_recent_comparison' }));
      expect(hasGroundedInsight(f)).toBe(true);
    },
  );
});

describe('hasGroundedInsight: non-qualifying Momentum states (false on their own)', () => {
  it.each<HabitCoachFacts['momentumState']>(['steady', 'quiet', 'insufficient_data'])(
    '%s does not qualify on its own, with no positive Habit Health',
    (momentumState) => {
      const f = coachFactsOf(fullHabitFacts({ momentumState, habitHealth: 'no_positive_recent_comparison' }));
      expect(hasGroundedInsight(f)).toBe(false);
    },
  );

  it('insufficient_evidence Habit Health does not rescue a non-qualifying Momentum state either', () => {
    const f = coachFactsOf(fullHabitFacts({ momentumState: 'insufficient_data', habitHealth: 'insufficient_evidence' }));
    expect(hasGroundedInsight(f)).toBe(false);
  });
});

describe('hasGroundedInsight: Habit Health qualifies independently of a non-qualifying Momentum state', () => {
  it('steady + positive_recent_comparison is true', () => {
    const f = coachFactsOf(fullHabitFacts({ momentumState: 'steady', habitHealth: 'positive_recent_comparison' }));
    expect(hasGroundedInsight(f)).toBe(true);
  });

  it('quiet + positive_recent_comparison is true', () => {
    const f = coachFactsOf(fullHabitFacts({ momentumState: 'quiet', habitHealth: 'positive_recent_comparison' }));
    expect(hasGroundedInsight(f)).toBe(true);
  });

  it('insufficient_data + positive_recent_comparison is true', () => {
    const f = coachFactsOf(fullHabitFacts({ momentumState: 'insufficient_data', habitHealth: 'positive_recent_comparison' }));
    expect(hasGroundedInsight(f)).toBe(true);
  });

  it('a qualifying Momentum state plus positive Habit Health together is still true (no exclusivity bug)', () => {
    const f = coachFactsOf(fullHabitFacts({ momentumState: 'thriving', habitHealth: 'positive_recent_comparison' }));
    expect(hasGroundedInsight(f)).toBe(true);
  });
});

describe('hasGroundedInsight: fact-richness never substitutes for eligibility', () => {
  it('false for a single habit with nothing populated beyond the always-present fields at their least-informative values', () => {
    const f = coachFactsOf(fullHabitFacts());
    expect(hasGroundedInsight(f)).toBe(false);
  });

  it('false for an empty habits array -- nothing to report at all', () => {
    expect(hasGroundedInsight(coachFactsOf())).toBe(false);
  });

  it.each<HabitCoachFacts['momentumState']>(['steady', 'quiet'])(
    'KEY CASE: false for a fact-rich record with %s Momentum -- every supporting field populated and non-zero, with neither eligibility condition met',
    (momentumState) => {
      // Deliberately adversarial: proves the predicate keys off momentumState/habitHealth alone
      // and is not accidentally swayed by the mere presence or magnitude of the supporting
      // statistics, for exactly the two states (steady, quiet) the revised rule now excludes.
      const f = coachFactsOf(
        fullHabitFacts({
          momentumState,
          habitHealth: 'no_positive_recent_comparison',
          totalCompletions: 500,
          recoveryCount: 12,
          recoveryRatePct: 90,
          averageRecoveryTimeDays: 1.2,
          consistencyPct: 95,
          consistencyWindowOpportunities: 14,
          lapseReasonCounts: {
            too_busy: 4,
            forgot: 3,
            low_energy: 2,
            not_feeling_it: 1,
            something_else: 1,
            skipped_without_reason: 1,
          },
        }),
      );
      expect(hasGroundedInsight(f)).toBe(false);
    },
  );

  it('false when only lapse-reason counts are populated -- lapse reasons contextualise an existing insight, they do not manufacture one on their own', () => {
    const f = coachFactsOf(
      fullHabitFacts({
        momentumState: 'insufficient_data',
        habitHealth: 'no_positive_recent_comparison',
        lapseReasonCounts: {
          too_busy: 0,
          forgot: 5,
          low_energy: 0,
          not_feeling_it: 0,
          something_else: 0,
          skipped_without_reason: 0,
        },
      }),
    );
    expect(hasGroundedInsight(f)).toBe(false);
  });

  it('lapse reasons do not rescue eligibility even paired with a non-qualifying Momentum state and no positive Habit Health', () => {
    const f = coachFactsOf(
      fullHabitFacts({
        momentumState: 'steady',
        habitHealth: 'no_positive_recent_comparison',
        lapseReasonCounts: {
          too_busy: 3,
          forgot: 2,
          low_energy: 0,
          not_feeling_it: 0,
          something_else: 0,
          skipped_without_reason: 0,
        },
      }),
    );
    expect(hasGroundedInsight(f)).toBe(false);
  });
});

describe('hasGroundedInsight: message-level .some semantics', () => {
  it('true if only one habit among several qualifies', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'h1', momentumState: 'insufficient_data', habitHealth: 'insufficient_evidence' }),
      fullHabitFacts({ habitId: 'h2', momentumState: 'steady', habitHealth: 'no_positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'h3', momentumState: 'recovering', habitHealth: 'no_positive_recent_comparison' }), // the one that qualifies
    );
    expect(hasGroundedInsight(f)).toBe(true);
  });

  it('false across multiple habits when none of them qualifies', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'h1', momentumState: 'insufficient_data', habitHealth: 'insufficient_evidence' }),
      fullHabitFacts({ habitId: 'h2', momentumState: 'steady', habitHealth: 'no_positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'h3', momentumState: 'quiet', habitHealth: 'no_positive_recent_comparison' }),
    );
    expect(hasGroundedInsight(f)).toBe(false);
  });
});

// selectLeadingHabit -- Route C's deterministic cross-habit selection (docs/phase-5-plan.md
// section 6.3's "Cross-habit selection precedence"). Built against the same fullHabitFacts/
// coachFactsOf fixtures as hasGroundedInsight above, since it operates over the identical shape.

describe('selectLeadingHabit: each tier in isolation', () => {
  it('selects a recovering habit when it is the only qualifying one', () => {
    const f = coachFactsOf(fullHabitFacts({ habitId: 'h1', momentumState: 'recovering' }));
    expect(selectLeadingHabit(f)?.habitId).toBe('h1');
  });

  it('selects a rebuilding habit when it is the only qualifying one', () => {
    const f = coachFactsOf(fullHabitFacts({ habitId: 'h1', momentumState: 'rebuilding' }));
    expect(selectLeadingHabit(f)?.habitId).toBe('h1');
  });

  it('selects a building habit when it is the only qualifying one', () => {
    const f = coachFactsOf(fullHabitFacts({ habitId: 'h1', momentumState: 'building' }));
    expect(selectLeadingHabit(f)?.habitId).toBe('h1');
  });

  it('selects a thriving habit when it is the only qualifying one', () => {
    const f = coachFactsOf(fullHabitFacts({ habitId: 'h1', momentumState: 'thriving' }));
    expect(selectLeadingHabit(f)?.habitId).toBe('h1');
  });

  it('selects a Habit-Health-only qualifying habit (steady momentum, positive comparison)', () => {
    const f = coachFactsOf(fullHabitFacts({ habitId: 'h1', momentumState: 'steady', habitHealth: 'positive_recent_comparison' }));
    expect(selectLeadingHabit(f)?.habitId).toBe('h1');
  });
});

describe('selectLeadingHabit: precedence when habits qualify through different tiers', () => {
  it('a recovering/rebuilding habit beats a building/thriving habit', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'z-growth', momentumState: 'building' }),
      fullHabitFacts({ habitId: 'a-recovery', momentumState: 'recovering' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('a-recovery');
  });

  it('a building/thriving habit beats a Habit-Health-only qualifying habit', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'z-growth', momentumState: 'thriving' }),
      fullHabitFacts({ habitId: 'a-health', momentumState: 'steady', habitHealth: 'positive_recent_comparison' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('z-growth');
  });

  it('a recovering/rebuilding habit beats a Habit-Health-only qualifying habit even when alphabetically later', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'a-health', momentumState: 'steady', habitHealth: 'positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'z-recovery', momentumState: 'recovering' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('z-recovery');
  });

  it('a fully non-qualifying habit is never selected regardless of tie-break order', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'a-nonqualifying', momentumState: 'quiet', habitHealth: 'no_positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'z-building', momentumState: 'building' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('z-building');
  });
});

describe('selectLeadingHabit: ascending lexical habitId tie-break', () => {
  it('breaks a tie within the recovering/rebuilding tier by ascending habitId', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'zzz', momentumState: 'recovering' }),
      fullHabitFacts({ habitId: 'aaa', momentumState: 'rebuilding' }),
      fullHabitFacts({ habitId: 'mmm', momentumState: 'recovering' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('aaa');
  });

  it('breaks a tie within the building/thriving tier by ascending habitId', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'zzz', momentumState: 'building' }),
      fullHabitFacts({ habitId: 'aaa', momentumState: 'thriving' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('aaa');
  });

  it('breaks a tie within the Habit-Health-only tier by ascending habitId', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'zzz', momentumState: 'quiet', habitHealth: 'positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'aaa', momentumState: 'steady', habitHealth: 'positive_recent_comparison' }),
    );
    expect(selectLeadingHabit(f)?.habitId).toBe('aaa');
  });

  it('does not mutate the order of facts.habits itself while breaking a tie', () => {
    const habitA = fullHabitFacts({ habitId: 'zzz', momentumState: 'recovering' });
    const habitB = fullHabitFacts({ habitId: 'aaa', momentumState: 'recovering' });
    const f = coachFactsOf(habitA, habitB);
    selectLeadingHabit(f);
    expect(f.habits[0]).toBe(habitA);
    expect(f.habits[1]).toBe(habitB);
  });
});

describe('selectLeadingHabit: no qualifying habit', () => {
  it('returns null when no habit qualifies under any tier', () => {
    const f = coachFactsOf(
      fullHabitFacts({ habitId: 'h1', momentumState: 'steady', habitHealth: 'no_positive_recent_comparison' }),
      fullHabitFacts({ habitId: 'h2', momentumState: 'quiet', habitHealth: 'insufficient_evidence' }),
    );
    expect(selectLeadingHabit(f)).toBeNull();
  });

  it('returns null for an empty habits array', () => {
    expect(selectLeadingHabit(coachFactsOf())).toBeNull();
  });
});
