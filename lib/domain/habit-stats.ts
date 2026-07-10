import type { Challenge, Habit, HabitLog } from '../habit-types';

/** Local day key 'YYYY-MM-DD' — avoids UTC off-by-one issues from toISOString(). */
export function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount);
  return dayKey(date);
}

function logsForHabitOnDay(logs: HabitLog[], habitId: string, date: string): HabitLog[] {
  return logs.filter((log) => log.habitId === habitId && log.date === date);
}

export function countForDay(logs: HabitLog[], habitId: string, date: string): number {
  return logsForHabitOnDay(logs, habitId, date).reduce((sum, log) => sum + log.count, 0);
}

export function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const total = countForDay(logs, habit.id, date);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}

export function isDoneToday(habit: Habit, logs: HabitLog[]): boolean {
  return isDoneOnDay(habit, logs, dayKey());
}

/** Consecutive days (ending today or yesterday) where the habit's target was met. */
export function streakForHabit(habit: Habit, logs: HabitLog[]): number {
  const today = dayKey();
  let cursor = isDoneOnDay(habit, logs, today) ? today : addDays(today, -1);

  let streak = 0;
  while (isDoneOnDay(habit, logs, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive completed days across the habit's entire history. */
export function longestStreak(habit: Habit, logs: HabitLog[]): number {
  const habitLogs = logs.filter((log) => log.habitId === habit.id);
  if (habitLogs.length === 0) return 0;

  const earliest = habitLogs.reduce((min, log) => (log.date < min ? log.date : min), habitLogs[0].date);
  const today = dayKey();

  let longest = 0;
  let current = 0;
  let cursor = earliest;
  while (cursor <= today) {
    if (isDoneOnDay(habit, logs, cursor)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return longest;
}

export type DayStatus = { date: string; done: boolean; count: number };

/** Most recent `days` days (oldest first) with completion status — powers the heatmap/bars. */
export function recentHistory(habit: Habit, logs: HabitLog[], days: number): DayStatus[] {
  const today = dayKey();
  const result: DayStatus[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const count = countForDay(logs, habit.id, date);
    result.push({ date, count, done: isDoneOnDay(habit, logs, date) });
  }
  return result;
}

/** Fraction (0-1) of the last `days` days the habit was completed. */
export function consistency(habit: Habit, logs: HabitLog[], days: number): number {
  const history = recentHistory(habit, logs, days);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}

export type ChallengeProgress = {
  habits: Habit[];
  daysElapsed: number;
  daysCompleted: number;
  totalDays: number;
  isComplete: boolean;
  isFailed: boolean;
  todayDone: boolean;
};

/** A challenge day counts only if every included habit was done that day. */
function allDoneOnDay(habits: Habit[], logs: HabitLog[], date: string): boolean {
  return habits.length > 0 && habits.every((habit) => isDoneOnDay(habit, logs, date));
}

/** How a challenge is tracking — used by both the banner on Today and the Challenges tab. */
export function challengeProgress(
  challenge: Challenge,
  habits: Habit[],
  logs: HabitLog[],
): ChallengeProgress {
  const challengeHabits = habits.filter((candidate) => challenge.habitIds.includes(candidate.id));
  const today = dayKey();
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, dateDiffInDays(challenge.startDate, today) + 1),
  );

  let daysCompleted = 0;
  let failed = false;
  for (let i = 0; i < daysElapsed; i += 1) {
    const date = addDays(challenge.startDate, i);
    const done = allDoneOnDay(challengeHabits, logs, date);
    if (done) {
      daysCompleted += 1;
    } else if (date !== today) {
      failed = true;
    }
  }

  const isComplete = daysCompleted >= challenge.durationDays;
  return {
    habits: challengeHabits,
    daysElapsed,
    daysCompleted,
    totalDays: challenge.durationDays,
    isComplete,
    isFailed: !isComplete && failed,
    todayDone: allDoneOnDay(challengeHabits, logs, today),
  };
}

function dateDiffInDays(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}
