import type { Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';
import { addDays } from './day-key';
import {
  averageRecoveryTime,
  closedLapses,
  recoverableLapseInstances,
  recoveryEvents,
  recoveryRate,
} from './recovery';

// Behavioral-contract fixtures for the domain layer, per docs/phase-2-implementation-plan.md
// Revision 2, sections 3 and 8. Each fixture below corresponds to a worked example in the plan.
//
// CORRECTION discovered during implementation (reported alongside this commit, not silently
// fixed): the plan's worked example C ("several misses with no return") described the pairwise
// instance whose *resolving* date is today as "open, not yet resolved". That directly
// contradicts examples A and B, both of which resolve a pair whose resolving date IS today (a
// completion logged today immediately closes the pair and fires the Recovery Event same-day --
// this is the whole point of the celebration feature). The correct, consistent rule (matching A
// and B, and matching the rest of the domain layer's "always live, nothing cached" philosophy):
// a pair resolves based on its resolving date's *current* completed status regardless of whether
// that date is today, exactly like every other derived value in this app. There is no principled
// reason for pairwise resolution to "wait" for a day to end -- if the user completes later today,
// the very next recomputation reflects that, same as it always does. Fixture C below uses this
// corrected arithmetic (8 resolved instances, not 7).

function habit(createdAt: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: `${createdAt}T00:00:00.000Z`,
    updatedAt: `${createdAt}T00:00:00.000Z`,
    ...overrides,
  };
}

function log(habitId: string, date: string): HabitLog {
  return { id: `${habitId}-${date}`, habitId, date, count: 1, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

function pausedPeriod(effectiveFrom: string, paused: boolean, id: string): HabitSchedulePeriod {
  return { id, habitId: 'h1', effectiveFrom, days: 'daily', paused, createdAt: `${effectiveFrom}T00:00:00.000Z`, updatedAt: `${effectiveFrom}T00:00:00.000Z` };
}

describe('example A -- miss then complete', () => {
  const h = habit('2026-07-01');
  const logs = [log('h1', '2026-07-01'), log('h1', '2026-07-03')];
  const today = '2026-07-03';

  it('resolves one recovered instance', () => {
    expect(recoverableLapseInstances(h, [], logs, today)).toEqual([
      { habitId: 'h1', missedOpportunityDate: '2026-07-02', resolvingOpportunityDate: '2026-07-03', recovered: true },
    ]);
  });

  it('fires a Recovery Event on the completion date', () => {
    expect(recoveryEvents(h, [], logs, today)).toEqual([{ habitId: 'h1', date: '2026-07-03' }]);
  });

  it('closes a Lapse with a 1-day recovery time', () => {
    expect(closedLapses(h, [], logs, today)).toEqual([
      { habitId: 'h1', firstMissedDate: '2026-07-02', recoveredDate: '2026-07-03', recoveryTimeDays: 1 },
    ]);
    expect(averageRecoveryTime(h, [], logs, today)).toBe(1);
  });

  it('is below the sample-size threshold for a displayed percentage', () => {
    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime).toEqual({ resolvedCount: 1, recoveredCount: 1, rate: 1, displayAsPercentage: false });
  });
});

describe('example B -- miss, miss, then complete', () => {
  const h = habit('2026-07-01');
  const logs = [log('h1', '2026-07-01'), log('h1', '2026-07-04')];
  const today = '2026-07-04';

  it('resolves one not-recovered instance followed by one recovered instance', () => {
    expect(recoverableLapseInstances(h, [], logs, today)).toEqual([
      { habitId: 'h1', missedOpportunityDate: '2026-07-02', resolvingOpportunityDate: '2026-07-03', recovered: false },
      { habitId: 'h1', missedOpportunityDate: '2026-07-03', resolvingOpportunityDate: '2026-07-04', recovered: true },
    ]);
  });

  it('closes a single 2-day Lapse (lapse-level granularity differs from the pairwise count)', () => {
    expect(closedLapses(h, [], logs, today)).toEqual([
      { habitId: 'h1', firstMissedDate: '2026-07-02', recoveredDate: '2026-07-04', recoveryTimeDays: 2 },
    ]);
  });

  it('rate reflects 1 of 2 resolved, still below the sample-size threshold', () => {
    expect(recoveryRate(h, [], logs, today).lifetime).toEqual({
      resolvedCount: 2,
      recoveredCount: 1,
      rate: 0.5,
      displayAsPercentage: false,
    });
  });
});

describe('example C -- several misses with no return (corrected arithmetic, see file header)', () => {
  const h = habit('2026-07-01');
  const logs = [log('h1', '2026-07-01')]; // nothing logged 07-02 through today
  const today = '2026-07-10';

  it('resolves 8 instances, all not recovered, and closes no Lapse', () => {
    const instances = recoverableLapseInstances(h, [], logs, today);
    expect(instances).toHaveLength(8);
    expect(instances.every((instance) => !instance.recovered)).toBe(true);
    expect(instances[0]).toEqual({
      habitId: 'h1',
      missedOpportunityDate: '2026-07-02',
      resolvingOpportunityDate: '2026-07-03',
      recovered: false,
    });
    expect(closedLapses(h, [], logs, today)).toEqual([]);
    expect(averageRecoveryTime(h, [], logs, today)).toBeNull();
  });

  it('a 0% rate with enough samples is still suppressed by the shame threshold, not shown as 0%', () => {
    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime).toEqual({ resolvedCount: 8, recoveredCount: 0, rate: 0, displayAsPercentage: false });
  });
});

describe('example D -- miss, pause, resume, then complete', () => {
  const h = habit('2026-07-01');
  const logs = [log('h1', '2026-07-01'), log('h1', '2026-07-06')];
  const periods = [pausedPeriod('2026-07-03', true, 'p1'), pausedPeriod('2026-07-06', false, 'p2')];
  const today = '2026-07-06';

  it('treats the next scheduled opportunity after the pause as the resolving date, regardless of the calendar gap', () => {
    expect(recoverableLapseInstances(h, periods, logs, today)).toEqual([
      { habitId: 'h1', missedOpportunityDate: '2026-07-02', resolvingOpportunityDate: '2026-07-06', recovered: true },
    ]);
  });

  it('recovery time spans the full calendar gap including the paused days', () => {
    expect(averageRecoveryTime(h, periods, logs, today)).toBe(4);
  });
});

describe('example E -- non-scheduled days between completions (Mon/Wed/Fri)', () => {
  // createdAt is the first Monday itself (not the preceding Friday, 2026-05-01) so the habit's
  // creation-date floor excludes that earlier Friday entirely -- otherwise it would be an extra,
  // unlogged Scheduled Opportunity the test isn't accounting for.
  const h = habit('2026-05-04');
  const periods = [{ id: 'p1', habitId: 'h1', effectiveFrom: '2026-05-04', days: [1, 3, 5], paused: false, createdAt: '2026-05-04T00:00:00.000Z', updatedAt: '2026-05-04T00:00:00.000Z' }];
  const logs = [log('h1', '2026-05-04'), log('h1', '2026-05-06'), log('h1', '2026-05-08')]; // Mon, Wed, Fri
  const today = '2026-05-08';

  it('never treats the non-scheduled days as misses -- zero resolved instances', () => {
    expect(recoverableLapseInstances(h, periods, logs, today)).toEqual([]);
    const rate = recoveryRate(h, periods, logs, today);
    expect(rate.lifetime).toEqual({ resolvedCount: 0, recoveredCount: 0, rate: null, displayAsPercentage: false });
  });
});

describe('example F -- retroactive completion', () => {
  const h = habit('2026-07-01');
  const today = '2026-07-03';

  it('a recovery event exists before the retroactive fill', () => {
    const logs = [log('h1', '2026-07-01'), log('h1', '2026-07-03')];
    expect(recoveryEvents(h, [], logs, today)).toEqual([{ habitId: 'h1', date: '2026-07-03' }]);
  });

  it('disappears entirely once the gap is retroactively filled -- nothing is cached', () => {
    const logsAfterBackfill = [log('h1', '2026-07-01'), log('h1', '2026-07-02'), log('h1', '2026-07-03')];
    expect(recoverableLapseInstances(h, [], logsAfterBackfill, today)).toEqual([]);
    expect(recoveryEvents(h, [], logsAfterBackfill, today)).toEqual([]);
  });
});

describe('sparse recovery history below the display threshold', () => {
  it('shows no percentage with only 2 resolved instances lifetime', () => {
    const h = habit('2026-01-01');
    const logs = [log('h1', '2026-01-01'), log('h1', '2026-01-03'), log('h1', '2026-01-04')];
    const today = '2026-01-06'; // 01-02 missed (recovered on 01-03), 01-05 missed (not recovered by today 01-06)
    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime).toEqual({ resolvedCount: 2, recoveredCount: 1, rate: 0.5, displayAsPercentage: false });
  });
});

describe('display thresholds', () => {
  it('suppresses a percentage below the shame threshold even with enough samples (25%, 4 resolved)', () => {
    const h = habit('2026-01-01');
    // 01-01 done; 01-02..01-05 all missed; 01-06 done (today) -- one 4-miss lapse, closes with 1 recovery
    const logs = [log('h1', '2026-01-01'), log('h1', '2026-01-06')];
    const today = '2026-01-06';
    const instances = recoverableLapseInstances(h, [], logs, today);
    expect(instances).toHaveLength(4);
    expect(instances.filter((instance) => instance.recovered)).toHaveLength(1);
    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime.rate).toBeCloseTo(0.25);
    expect(rate.lifetime.displayAsPercentage).toBe(false);
  });

  it('shows a percentage at or above the shame threshold with enough samples (67%, 3 resolved)', () => {
    const h = habit('2026-01-01');
    const logs = [
      log('h1', '2026-01-01'),
      log('h1', '2026-01-03'),
      log('h1', '2026-01-04'),
      log('h1', '2026-01-06'),
      log('h1', '2026-01-07'),
    ];
    const today = '2026-01-09'; // 01-02 recovered on 01-03; 01-05 recovered on 01-06; 01-08 not recovered by 01-09
    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime.resolvedCount).toBe(3);
    expect(rate.lifetime.recoveredCount).toBe(2);
    expect(rate.lifetime.rate).toBeCloseTo(2 / 3);
    expect(rate.lifetime.displayAsPercentage).toBe(true);
  });
});

describe('rolling vs. lifetime Recovery Rate horizons', () => {
  it('the rolling window only reflects the last 10 resolved instances, lifetime reflects all of them', () => {
    const h = habit('2026-01-01');
    // Alternating complete/miss from day 2 onward, each miss immediately recovered the next day --
    // 12 such recovered instances, followed by 2 unresolved-then-resolved-as-failed instances.
    const logs: HabitLog[] = [log('h1', '2026-01-01')];
    let cursor = '2026-01-01';
    for (let i = 0; i < 12; i += 1) {
      cursor = addDays(cursor, 2); // skip the missed day, log the recovery day
      logs.push(log('h1', cursor));
    }
    // Two trailing miss-then-miss episodes (not recovered), each also a separate resolved instance.
    const trailingMissDay2 = addDays(cursor, 3);
    const today = trailingMissDay2;

    const rate = recoveryRate(h, [], logs, today);
    expect(rate.lifetime.resolvedCount).toBe(14);
    expect(rate.lifetime.recoveredCount).toBe(12);
    expect(rate.rolling.resolvedCount).toBe(10);
    expect(rate.rolling.recoveredCount).toBe(8); // last 10 = 8 of the recovered ones + both trailing not-recovered ones
    expect(rate.lifetime.rate).not.toEqual(rate.rolling.rate);
  });
});
