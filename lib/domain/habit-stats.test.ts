import {
  addDays,
  challengeProgress,
  consistency,
  countForDay,
  dayKey,
  isDoneOnDay,
  isDoneToday,
  longestStreak,
  recentHistory,
  streakForHabit,
} from './habit-stats';
import type { Challenge, Habit, HabitLog } from '../habit-types';

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
});

describe('isDoneToday', () => {
  it('reflects whether today has a qualifying log', () => {
    const habit = simpleHabit();
    const today = dayKey();
    expect(isDoneToday(habit, [log(habit.id, today)])).toBe(true);
    expect(isDoneToday(habit, [])).toBe(false);
  });
});

describe('streakForHabit', () => {
  it('is 0 with no logs', () => {
    expect(streakForHabit(simpleHabit(), [])).toBe(0);
  });

  it('counts consecutive completed days ending today', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs)).toBe(3);
  });

  it('still counts a streak ending yesterday if today has no log yet', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, addDays(today, -1)), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs)).toBe(2);
  });

  it('breaks on a gap', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -2))];
    expect(streakForHabit(habit, logs)).toBe(1);
  });
});

describe('longestStreak', () => {
  it('is 0 with no logs', () => {
    expect(longestStreak(simpleHabit(), [])).toBe(0);
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
    expect(longestStreak(habit, logs)).toBe(3);
  });
});

describe('recentHistory / consistency', () => {
  it('returns the requested number of days, oldest first', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const history = recentHistory(habit, [log(habit.id, today)], 3);
    expect(history).toHaveLength(3);
    expect(history[2].date).toBe(today);
    expect(history[2].done).toBe(true);
    expect(history[0].done).toBe(false);
  });

  it('computes the completed fraction over the window', () => {
    const habit = simpleHabit();
    const today = dayKey();
    const logs = [log(habit.id, today), log(habit.id, addDays(today, -1))];
    expect(consistency(habit, logs, 4)).toBe(0.5);
  });

  it('is 0 for a window of 0 days', () => {
    expect(consistency(simpleHabit(), [], 0)).toBe(0);
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
