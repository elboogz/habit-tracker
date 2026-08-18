import {
  addDays,
  calendarConsistency,
  calendarStreakForHabit,
  challengeProgress,
  consistency,
  countForDay,
  dayKey,
  isDoneOnDay,
  isDoneToday,
  longestStreak,
  recentHistory,
  reducedTargetFor,
  streakForHabit,
  totalCompletions,
} from './habit-stats';
import type { Challenge, Habit, HabitLog, HabitSchedulePeriod } from '../habit-types';

// Characterization tests: capture today's exact behavior before Phase 2 adds anything new.
// These functions are relocated from the pre-Phase-2 lib/habit-stats.ts unchanged (see the
// re-export barrel at lib/habit-stats.ts) — no behavior is expected to differ here.

function simpleHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function countHabit(target: number, overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h2',
    name: 'Drink Water',
    emoji: '💧',
    type: 'count',
    targetCount: target,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function log(habitId: string, date: string, count = 1): HabitLog {
  return { id: `${habitId}-${date}-${count}-${Math.random()}`, habitId, date, count, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

function reducedLog(habitId: string, date: string, count: number): HabitLog {
  return { id: `${habitId}-${date}-reduced-${Math.random()}`, habitId, date, count, reduced: true, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

describe('dayKey / addDays', () => {
  it('formats a given date as local YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('subtracts days', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('countForDay / isDoneOnDay', () => {
  it('sums multiple logs for a count habit on the same day', () => {
    const habit = countHabit(3);
    const logs = [log(habit.id, '2026-01-01', 1), log(habit.id, '2026-01-01', 1)];
    expect(countForDay(logs, habit.id, '2026-01-01')).toBe(2);
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(false);
  });

  it('marks a count habit done once the target is met', () => {
    const habit = countHabit(2);
    const logs = [log(habit.id, '2026-01-01', 1), log(habit.id, '2026-01-01', 1)];
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(true);
  });

  it('marks a simple habit done with any positive count', () => {
    const habit = simpleHabit();
    const logs = [log(habit.id, '2026-01-01', 1)];
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(true);
  });

  it('is not done on a day with no logs', () => {
    const habit = simpleHabit();
    expect(isDoneOnDay(habit, [], '2026-01-01')).toBe(false);
  });

  // Phase 4 -- docs/phase-4-plan.md section 2.2: a reduced completion counts fully as done, not
  // partial credit, so every downstream consumer treats the day as completed.
  it('a reduced completion counts as done even when well below the full target', () => {
    const habit = countHabit(8);
    const logs = [reducedLog(habit.id, '2026-01-01', 2)];
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(true);
  });

  it('a non-reduced log below target still does not count as done', () => {
    const habit = countHabit(8);
    const logs = [log(habit.id, '2026-01-01', 2)];
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(false);
  });

  it('pre-Phase-4 logs with no reduced field are completely unaffected', () => {
    const habit = countHabit(2);
    const logs = [log(habit.id, '2026-01-01', 1), log(habit.id, '2026-01-01', 1)];
    expect(isDoneOnDay(habit, logs, '2026-01-01')).toBe(true);
  });
});

describe('reducedTargetFor (Phase 4)', () => {
  it('is null for a simple (yes/no) habit -- no measurable target to derive a smaller version from', () => {
    expect(reducedTargetFor(simpleHabit())).toBeNull();
  });

  it('is null for a count habit with no targetCount set', () => {
    expect(reducedTargetFor(countHabit(8, { targetCount: undefined }))).toBeNull();
  });

  it('derives a default of roughly a third of the full target, floored at 1', () => {
    expect(reducedTargetFor(countHabit(8))).toBe(3); // round(8/3) = 3
    expect(reducedTargetFor(countHabit(30))).toBe(10);
    expect(reducedTargetFor(countHabit(1))).toBe(1); // max(1, round(1/3)) = 1
    expect(reducedTargetFor(countHabit(2))).toBe(1); // max(1, round(2/3)) = 1
  });

  it('prefers an explicit reducedTarget over the derived default', () => {
    expect(reducedTargetFor(countHabit(8, { reducedTarget: 5 }))).toBe(5);
  });
});

describe('isDoneToday', () => {
  it('reflects whether today has a qualifying log', () => {
    const habit = simpleHabit();
    const today = dayKey();
    expect(isDoneToday(habit, [log(habit.id, today)])).toBe(true);
    expect(isDoneToday(habit, [])).toBe(false);
  });
});

// simpleHabit() defaults to createdAt 2020-01-01 with zero schedule periods -- daily/unpaused, and
// old enough that no window used below reaches its creation floor. For a daily habit in that
// shape, every calendar day is a Scheduled Opportunity, so schedule-aware streakForHabit/
// longestStreak below produce identical numbers to the pre-Scheduled-Opportunity version for these
// cases; only the added `schedulePeriods` argument changes. Schedule-shape-specific behavior
// (Mon/Wed/Fri, a paused sub-range) is covered separately below.
describe('streakForHabit (schedule-aware)', () => {
  it('is 0 with no logs', () => {
    expect(streakForHabit(simpleHabit(), [], [])).toBe(0);
  });

  it('counts consecutive completed days ending today', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs, [])).toBe(3);
  });

  it('still counts a streak ending yesterday if today has no log yet', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs, [])).toBe(2);
  });

  it('breaks on a gap', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs, [])).toBe(1);
  });

  it('accepts an explicit asOfDate instead of always using live "now" -- needed by send-coaching-push, which computes each recipient\'s own local today', () => {
    const habit = simpleHabit();
    const logs = [log(habit.id, '2026-03-10'), log(habit.id, '2026-03-09'), log(habit.id, '2026-03-08')];
    expect(streakForHabit(habit, logs, [], '2026-03-10')).toBe(3);
    // A date far from "now" produces a result based on that date, not the live default.
    expect(streakForHabit(habit, logs, [], '2026-01-01')).toBe(0);
  });

  it('a non-scheduled day neither breaks nor extends the streak, for a Mon/Wed/Fri habit', () => {
    // 2026-05-01 is a Friday. Perfect adherence on 04-27 (Mon), 04-29 (Wed), 05-01 (Fri) -- the
    // calendar-day gaps between them (Tue/Thu/weekend) are never Scheduled Opportunities at all,
    // so they don't appear in the walk to break the streak the way a raw calendar-day walk would.
    const habit = simpleHabit({ createdAt: '2020-01-01T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2020-01-01', days: [1, 3, 5], paused: false, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    ];
    const logs = [log(habit.id, '2026-04-27'), log(habit.id, '2026-04-29'), log(habit.id, '2026-05-01')];
    expect(streakForHabit(habit, logs, periods, '2026-05-01')).toBe(3);
  });

  it('a paused sub-range is skipped, not counted as a break', () => {
    const habit = simpleHabit({ createdAt: '2020-01-01T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2020-01-01', days: 'daily' as const, paused: false, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'p2', habitId: habit.id, effectiveFrom: '2026-05-04', days: 'daily' as const, paused: true, createdAt: '2026-05-04T00:00:00.000Z', updatedAt: '2026-05-04T00:00:00.000Z' },
      { id: 'p3', habitId: habit.id, effectiveFrom: '2026-05-06', days: 'daily' as const, paused: false, createdAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' },
    ];
    const logs = [log(habit.id, '2026-05-01'), log(habit.id, '2026-05-02'), log(habit.id, '2026-05-03'), log(habit.id, '2026-05-06')];
    // 05-04/05-05 are paused (excluded entirely, not misses) -- the streak reaches all the way
    // back to 05-01 through the pause, not just to 05-06.
    expect(streakForHabit(habit, logs, periods, '2026-05-06')).toBe(4);
  });
});

// The pre-Scheduled-Opportunity behavior, preserved verbatim under calendarStreakForHabit's own
// name -- see its doc comment in lib/domain/habit-stats.ts for why it still exists (the two Edge
// Functions call it, and neither fetches habit_schedule_periods yet).
describe('calendarStreakForHabit', () => {
  it('is 0 with no logs', () => {
    expect(calendarStreakForHabit(simpleHabit(), [])).toBe(0);
  });

  it('counts consecutive completed days ending today', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(calendarStreakForHabit(habit, logs)).toBe(3);
  });

  it('still counts a streak ending yesterday if today has no log yet', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(calendarStreakForHabit(habit, logs)).toBe(2);
  });

  it('breaks on a gap', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -2))];
    expect(calendarStreakForHabit(habit, logs)).toBe(1);
  });

  it('accepts an explicit asOfDate instead of always using live "now"', () => {
    const habit = simpleHabit();
    const logs = [log(habit.id, '2026-03-10'), log(habit.id, '2026-03-09'), log(habit.id, '2026-03-08')];
    expect(calendarStreakForHabit(habit, logs, '2026-03-10')).toBe(3);
    expect(calendarStreakForHabit(habit, logs, '2026-01-01')).toBe(0);
  });
});

describe('longestStreak (schedule-aware)', () => {
  it('is 0 with no logs', () => {
    expect(longestStreak(simpleHabit(), [], [])).toBe(0);
  });

  it('finds the longest run across a gap', () => {
    const habit = simpleHabit();
    const logs = [
      log(habit.id, '2026-01-01'),
      log(habit.id, '2026-01-02'),
      log(habit.id, '2026-01-03'),
      // gap on 01-04
      log(habit.id, '2026-01-05'),
      log(habit.id, '2026-01-06'),
    ];
    expect(longestStreak(habit, logs, [])).toBe(3);
  });

  it('a Mon/Wed/Fri habit with perfect adherence over 2 weeks reads a 6-long streak, not broken by weekends/Tue/Thu', () => {
    const habit = simpleHabit({ createdAt: '2020-01-01T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2020-01-01', days: [1, 3, 5], paused: false, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    ];
    // 2026-05-01 is a Friday. Perfect MWF adherence 04-20 (Mon) through 05-01 (Fri): 6 opportunities.
    const dates = ['2026-04-20', '2026-04-22', '2026-04-24', '2026-04-27', '2026-04-29', '2026-05-01'];
    const logs = dates.map((date) => log(habit.id, date));
    expect(longestStreak(habit, logs, periods)).toBe(6);
  });
});

describe('recentHistory', () => {
  it('returns the requested number of days, oldest first', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const history = recentHistory(habit, [log(habit.id, today)], 3);
    expect(history).toHaveLength(3);
    expect(history[2].date).toBe(today);
    expect(history[2].done).toBe(true);
    expect(history[0].done).toBe(false);
  });
});

// simpleHabit() defaults to createdAt 2020-01-01 with zero schedule periods -- daily/unpaused,
// and old enough that no window used below reaches its creation floor. For a daily habit in that
// shape, every calendar day in the window is a Scheduled Opportunity, so the schedule-aware
// consistency() below produces identical numbers to the old calendar-day version for these three
// cases; only the added `schedulePeriods` argument changes. Schedule-shape-specific behavior
// (Mon/Wed/Fri, Sundays-only, paused periods, zero opportunities) is covered separately below.
describe('consistency (schedule-aware)', () => {
  it('computes the completed fraction over the window', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1))];
    expect(consistency(habit, logs, 4, [])).toBe(0.5);
  });

  it('accepts an explicit asOfDate for the same reason streakForHabit does', () => {
    const habit = simpleHabit();
    const logs = [log(habit.id, '2026-03-10'), log(habit.id, '2026-03-09')];
    expect(consistency(habit, logs, 4, [], '2026-03-10')).toBe(0.5);
  });

  // Changed from the pre-Scheduled-Opportunity version's `toBe(0)`: a 0-day window has zero
  // Scheduled Opportunities to evaluate, which is a "nothing to measure" case, not a "measured
  // and got zero" case -- see consistency()'s doc comment. calendarConsistency (below) keeps the
  // old `0` behavior for the Edge Functions that still call it.
  it('is null for a window of 0 days -- no opportunities to evaluate, not a 0% measurement', () => {
    expect(consistency(simpleHabit(), [], 0, [])).toBeNull();
  });

  it('excludes non-scheduled days from the denominator for a Mon/Wed/Fri habit', () => {
    // 2026-05-01 is a Friday. Mon/Wed/Fri in the following 2 weeks: 05-01, 05-04, 05-06, 05-08,
    // 05-11, 05-13. All six completed -- calendar-day consistency would cap around 43% (6/14);
    // schedule-aware consistency reflects the actual perfect adherence.
    const habit = simpleHabit({ createdAt: '2026-04-01T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2026-04-01', days: [1, 3, 5], paused: false, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
    ];
    const scheduledDates = ['2026-05-01', '2026-05-04', '2026-05-06', '2026-05-08', '2026-05-11', '2026-05-13'];
    const logs = scheduledDates.map((date) => log(habit.id, date));
    expect(consistency(habit, logs, 14, periods, '2026-05-14')).toBe(1);
  });

  it('excludes a paused period from both numerator and denominator', () => {
    // Daily habit, paused for 4 days inside a 14-day window; every day outside the pause is
    // completed. Calendar-day consistency would read 10/14 (~71%), penalizing the paused days;
    // schedule-aware consistency excludes them from the opportunity count entirely.
    const habit = simpleHabit({ createdAt: '2026-04-01T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2026-04-01', days: 'daily' as const, paused: false, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' },
      { id: 'p2', habitId: habit.id, effectiveFrom: '2026-05-08', days: 'daily' as const, paused: true, createdAt: '2026-05-08T00:00:00.000Z', updatedAt: '2026-05-08T00:00:00.000Z' },
      { id: 'p3', habitId: habit.id, effectiveFrom: '2026-05-12', days: 'daily' as const, paused: false, createdAt: '2026-05-12T00:00:00.000Z', updatedAt: '2026-05-12T00:00:00.000Z' },
    ];
    const today = '2026-05-14'; // window: 05-01 through 05-14; paused 05-08 through 05-11 inclusive
    const unpausedDates = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-12', '2026-05-13', '2026-05-14'];
    const logs = unpausedDates.map((date) => log(habit.id, date));
    expect(consistency(habit, logs, 14, periods, today)).toBe(1);
  });

  it('is null when the window contains zero Scheduled Opportunities (Sundays-only habit, viewed before the first Sunday)', () => {
    // Created Monday 2026-05-04; first Sunday is 2026-05-10. Viewed on 2026-05-06 (Wednesday),
    // the window has had no Scheduled Opportunity yet.
    const habit = simpleHabit({ createdAt: '2026-05-04T00:00:00.000Z' });
    const periods = [
      { id: 'p1', habitId: habit.id, effectiveFrom: '2026-05-04', days: [0], paused: false, createdAt: '2026-05-04T00:00:00.000Z', updatedAt: '2026-05-04T00:00:00.000Z' },
    ];
    expect(consistency(habit, [], 7, periods, '2026-05-06')).toBeNull();
  });
});

// The pre-Scheduled-Opportunity behavior, preserved verbatim under calendarConsistency's own name
// -- see its doc comment in lib/domain/habit-stats.ts for why it still exists (the two Edge
// Functions call it, and neither fetches habit_schedule_periods yet).
describe('calendarConsistency', () => {
  it('computes the completed fraction over the window', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1))];
    expect(calendarConsistency(habit, logs, 4)).toBe(0.5);
  });

  it('accepts an explicit asOfDate for the same reason streakForHabit does', () => {
    const habit = simpleHabit();
    const logs = [log(habit.id, '2026-03-10'), log(habit.id, '2026-03-09')];
    expect(calendarConsistency(habit, logs, 4, '2026-03-10')).toBe(0.5);
  });

  it('is 0 for a window of 0 days', () => {
    expect(calendarConsistency(simpleHabit(), [], 0)).toBe(0);
  });
});

describe('totalCompletions', () => {
  it('is 0 with no logs', () => {
    expect(totalCompletions('h1', [])).toBe(0);
  });

  it('counts every log for the habit, regardless of date, and never resets', () => {
    const logs = [
      log('h1', '2026-01-01'),
      log('h1', '2026-01-02'),
      log('h1', '2026-06-15'),
      log('h2', '2026-01-01'), // a different habit's log must not count
    ];
    expect(totalCompletions('h1', logs)).toBe(3);
  });

  it('counts multiple same-day logs for a count habit individually, matching cumulative "never resets" semantics', () => {
    const logs = [log('h2', '2026-01-01', 1), log('h2', '2026-01-01', 1), log('h2', '2026-01-01', 1)];
    expect(totalCompletions('h2', logs)).toBe(3);
  });
});

describe('challengeProgress — current failure semantics (preserved exactly through Phase 2)', () => {
  function challenge(overrides: Partial<Challenge> = {}): Challenge {
    return {
      id: 'c1',
      habitIds: ['h1'],
      durationDays: 3,
      startDate: dayKey(),
      status: 'active',
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('is not failed and not complete on day 1 with today still pending', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const progress = challengeProgress(challenge({ startDate: today }), [habit], []);
    expect(progress.isFailed).toBe(false);
    expect(progress.isComplete).toBe(false);
    expect(progress.daysElapsed).toBe(1);
    expect(progress.todayDone).toBe(false);
  });

  it('completes once every day in the window is done', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const start = addDays(today, -2);
    const logs = [log(habit.id, start), log(habit.id, addDays(start, 1)), log(habit.id, addDays(start, 2))];
    const progress = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs);
    expect(progress.isComplete).toBe(true);
    expect(progress.isFailed).toBe(false);
    expect(progress.daysCompleted).toBe(3);
  });

  it('a single missed non-today day fails the challenge outright (today behavior, not yet tolerant — Phase 7 changes this)', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const start = addDays(today, -2);
    // start day missed entirely; the other two days done
    const logs = [log(habit.id, addDays(start, 1)), log(habit.id, addDays(start, 2))];
    const progress = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs);
    expect(progress.isFailed).toBe(true);
    expect(progress.isComplete).toBe(false);
  });

  it('requires every habit in the challenge to be done on a given day for it to count', () => {
    const habitA = simpleHabit({ id: 'ha' });
    const habitB = simpleHabit({ id: 'hb' });
    const today = dayKey();
    const logs = [log('ha', today)]; // habitB not logged today
    const progress = challengeProgress(
      challenge({ habitIds: ['ha', 'hb'], startDate: today, durationDays: 3 }),
      [habitA, habitB],
      logs,
    );
    expect(progress.todayDone).toBe(false);
  });
});

describe('challengeProgress — schedule awareness (Phase 2 threading, section 7)', () => {
  function challenge(overrides: Partial<Challenge> = {}): Challenge {
    return {
      id: 'c1',
      habitIds: ['h1'],
      durationDays: 3,
      startDate: dayKey(),
      status: 'active',
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('defaults to identical output with no schedulePeriods argument at all (backward compatible signature)', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const start = addDays(today, -2);
    const logs = [log(habit.id, addDays(start, 1)), log(habit.id, addDays(start, 2))];
    const withoutArg = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs);
    const withEmptyArg = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs, []);
    expect(withoutArg).toEqual(withEmptyArg);
  });

  it('does not blame a habit for a day it was paused, unlike a genuine miss', () => {
    const habit = simpleHabit({ id: 'h1', createdAt: '2020-01-01T00:00:00.000Z' });
    const today = dayKey();
    const start = addDays(today, -2);
    const pausedDay = start; // habit is paused for the challenge's first day only
    const periods: HabitSchedulePeriod[] = [
      { id: 'p1', habitId: 'h1', effectiveFrom: pausedDay, days: 'daily', paused: true, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'p2', habitId: 'h1', effectiveFrom: addDays(pausedDay, 1), days: 'daily', paused: false, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' },
    ];
    // No log at all on the paused day; the other two days completed.
    const logs = [log(habit.id, addDays(start, 1)), log(habit.id, addDays(start, 2))];

    const withoutSchedule = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs);
    const withSchedule = challengeProgress(challenge({ startDate: start, durationDays: 3 }), [habit], logs, periods);

    // Without schedule awareness, the unlogged paused day reads as a genuine miss and fails the
    // challenge (matching the pre-Phase-2 fixture above) -- with it, the paused day isn't a
    // Scheduled Opportunity at all, so it can't be blamed, and the challenge completes instead.
    expect(withoutSchedule.isFailed).toBe(true);
    expect(withSchedule.isFailed).toBe(false);
    expect(withSchedule.isComplete).toBe(true);
  });
});
