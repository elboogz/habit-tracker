import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';

import { addDays, dayKey } from './habit-stats';
import type { Challenge, Habit, HabitLog, HabitState, HabitType } from './habit-types';
import { scheduleAllReminders } from './notifications';

const STORAGE_KEY = 'habit-tracker/state-v1';

let nextHabitSeq = 1;

const initialState: HabitState = {
  habits: [],
  logs: [],
  challenges: [],
  hasOnboarded: false,
  notifications: { enabled: false, times: ['09:00'] },
  soundEnabled: true,
};

/** Pre-migration challenges stored a single `habitId` instead of `habitIds: string[]`. */
type LegacyChallenge = Omit<Challenge, 'habitIds'> & { habitId?: string; habitIds?: string[] };

function migrateChallenges(challenges: LegacyChallenge[] | undefined): Challenge[] {
  if (!challenges) return [];
  return challenges.map((challenge) => ({
    ...challenge,
    habitIds: challenge.habitIds ?? (challenge.habitId ? [challenge.habitId] : []),
  }));
}

type Action =
  | { type: 'hydrate'; state: HabitState }
  | { type: 'addHabit'; habit: Habit }
  | { type: 'updateHabit'; habit: Habit }
  | { type: 'deleteHabit'; habitId: string }
  | { type: 'logHabit'; habitId: string; amount: number }
  | { type: 'unlogHabit'; habitId: string }
  | { type: 'setChallengeStatus'; challengeId: string; status: Challenge['status'] }
  | { type: 'startChallenge'; habitIds: string[]; durationDays: number }
  | { type: 'completeOnboarding' }
  | { type: 'resetOnboarding' }
  | { type: 'setNotifications'; enabled: boolean; times: string[] }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'debugBackfillLogs'; habitId: string; dates: string[] }
  | { type: 'debugAdvanceChallenge'; challengeId: string }
  | { type: 'debugCompleteChallenge'; challengeId: string }
  | { type: 'resetAllData' };

function reducer(state: HabitState, action: Action): HabitState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'addHabit':
      return { ...state, habits: [...state.habits, action.habit] };
    case 'updateHabit':
      return {
        ...state,
        habits: state.habits.map((habit) => (habit.id === action.habit.id ? action.habit : habit)),
      };
    case 'deleteHabit':
      return {
        ...state,
        habits: state.habits.filter((habit) => habit.id !== action.habitId),
        logs: state.logs.filter((log) => log.habitId !== action.habitId),
        challenges: state.challenges
          .map((challenge) =>
            challenge.status === 'active'
              ? { ...challenge, habitIds: challenge.habitIds.filter((id) => id !== action.habitId) }
              : challenge,
          )
          .filter((challenge) => challenge.status !== 'active' || challenge.habitIds.length > 0),
      };
    case 'logHabit': {
      const log = {
        id: `${action.habitId}-${Date.now()}`,
        habitId: action.habitId,
        date: dayKey(),
        count: action.amount,
        loggedAt: new Date().toISOString(),
      };
      return { ...state, logs: [...state.logs, log] };
    }
    case 'unlogHabit': {
      const today = dayKey();
      const todaysLogs = state.logs.filter((log) => log.habitId === action.habitId && log.date === today);
      if (todaysLogs.length === 0) return state;
      const lastLog = todaysLogs.reduce((latest, log) => (log.loggedAt > latest.loggedAt ? log : latest));
      return { ...state, logs: state.logs.filter((log) => log.id !== lastLog.id) };
    }
    case 'setChallengeStatus':
      return {
        ...state,
        challenges: state.challenges.map((challenge) =>
          challenge.id === action.challengeId ? { ...challenge, status: action.status } : challenge,
        ),
      };
    case 'startChallenge': {
      if (action.habitIds.length === 0) return state;
      if (state.challenges.some((challenge) => challenge.status === 'active')) return state;
      const challenge: Challenge = {
        id: `challenge-${Date.now()}`,
        habitIds: action.habitIds,
        durationDays: action.durationDays,
        startDate: dayKey(),
        status: 'active',
      };
      return { ...state, challenges: [...state.challenges, challenge] };
    }
    case 'completeOnboarding':
      return { ...state, hasOnboarded: true };
    case 'resetOnboarding':
      return { ...state, hasOnboarded: false };
    case 'setNotifications':
      return { ...state, notifications: { enabled: action.enabled, times: action.times } };
    case 'setSoundEnabled':
      return { ...state, soundEnabled: action.enabled };
    case 'debugBackfillLogs': {
      const habit = state.habits.find((h) => h.id === action.habitId);
      if (!habit) return state;
      const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
      const filteredLogs = state.logs.filter(
        (log) => !(log.habitId === action.habitId && action.dates.includes(log.date)),
      );
      const newLogs: HabitLog[] = action.dates.map((date, index) => ({
        id: `${action.habitId}-debug-${date}-${index}`,
        habitId: action.habitId,
        date,
        count: amount,
        loggedAt: new Date().toISOString(),
      }));
      return { ...state, logs: [...filteredLogs, ...newLogs] };
    }
    case 'debugAdvanceChallenge': {
      const challenge = state.challenges.find((c) => c.id === action.challengeId);
      if (!challenge || challenge.status !== 'active') return state;
      const challengeHabits = state.habits.filter((h) => challenge.habitIds.includes(h.id));
      if (challengeHabits.length === 0) return state;

      const today = dayKey();
      const newStartDate = addDays(today, -(challenge.durationDays - 1));
      const pastDates: string[] = [];
      for (let i = 0; i < challenge.durationDays - 1; i += 1) {
        pastDates.push(addDays(newStartDate, i));
      }

      let logs = state.logs;
      for (const habit of challengeHabits) {
        const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
        logs = logs.filter((log) => !(log.habitId === habit.id && pastDates.includes(log.date)));
        const newLogs: HabitLog[] = pastDates.map((date, index) => ({
          id: `${habit.id}-debug-${date}-${index}`,
          habitId: habit.id,
          date,
          count: amount,
          loggedAt: new Date().toISOString(),
        }));
        logs = [...logs, ...newLogs];
      }

      return {
        ...state,
        logs,
        challenges: state.challenges.map((c) => (c.id === challenge.id ? { ...c, startDate: newStartDate } : c)),
      };
    }
    case 'debugCompleteChallenge': {
      const challenge = state.challenges.find((c) => c.id === action.challengeId);
      if (!challenge || challenge.status !== 'active') return state;
      const challengeHabits = state.habits.filter((h) => challenge.habitIds.includes(h.id));
      if (challengeHabits.length === 0) return state;

      const today = dayKey();
      const newStartDate = addDays(today, -(challenge.durationDays - 1));
      const allDates: string[] = [];
      for (let i = 0; i < challenge.durationDays; i += 1) {
        allDates.push(addDays(newStartDate, i));
      }

      let logs = state.logs;
      for (const habit of challengeHabits) {
        const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
        logs = logs.filter((log) => !(log.habitId === habit.id && allDates.includes(log.date)));
        const newLogs: HabitLog[] = allDates.map((date, index) => ({
          id: `${habit.id}-debug-${date}-${index}`,
          habitId: habit.id,
          date,
          count: amount,
          loggedAt: new Date().toISOString(),
        }));
        logs = [...logs, ...newLogs];
      }

      return {
        ...state,
        logs,
        challenges: state.challenges.map((c) =>
          c.id === challenge.id ? { ...c, startDate: newStartDate, status: 'completed' } : c,
        ),
      };
    }
    case 'resetAllData':
      return { ...initialState };
    default:
      return state;
  }
}

type HabitStore = {
  state: HabitState;
  hydrated: boolean;
  addHabit: (input: {
    name: string;
    emoji: string;
    type: HabitType;
    targetCount?: number;
    reminderTimes?: string[];
  }) => Habit;
  updateHabit: (habit: Habit) => void;
  deleteHabit: (habitId: string) => void;
  logHabit: (habitId: string, amount?: number) => void;
  /** Removes the most recently logged entry for this habit today — used to "uncheck" a habit. */
  unlogHabit: (habitId: string) => void;
  setChallengeStatus: (challengeId: string, status: Challenge['status']) => void;
  /** Starts a new challenge covering all of `habitIds`. No-ops if a challenge is already active. */
  startChallenge: (habitIds: string[], durationDays: number) => void;
  completeOnboarding: () => void;
  /** Re-shows the onboarding flow without touching habits/logs/challenges — dev tools only. */
  resetOnboarding: () => void;
  setNotifications: (enabled: boolean, times: string[]) => void;
  setSoundEnabled: (enabled: boolean) => void;
  /** Backfills logs for the given day keys — for the dev tools panel only. */
  debugBackfillLogs: (habitId: string, dates: string[]) => void;
  /** Shifts a challenge so today is its final day, with all earlier days backfilled — dev tools only. */
  debugAdvanceChallenge: (challengeId: string) => void;
  /** Backfills every day of a challenge (including today) and marks it completed — dev tools only. */
  debugCompleteChallenge: (challengeId: string) => void;
  /** Wipes all app data back to a fresh install, including onboarding — dev tools only. */
  resetAllData: () => void;
};

const HabitStoreContext = createContext<HabitStore | null>(null);

export function HabitStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          dispatch({
            type: 'hydrate',
            state: { ...initialState, ...parsed, challenges: migrateChallenges(parsed.challenges) },
          });
        } catch {
          // Corrupt or pre-migration data — fall back to the initial empty state.
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Skip the pre-hydration write — otherwise the initial empty state would
    // briefly overwrite whatever was already persisted on disk.
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    scheduleAllReminders(state.notifications, state.habits);
  }, [hydrated, state.notifications, state.habits]);

  const store = useMemo<HabitStore>(
    () => ({
      state,
      hydrated,
      addHabit: (input) => {
        const habit: Habit = {
          id: `habit-${Date.now()}-${nextHabitSeq++}`,
          name: input.name,
          emoji: input.emoji,
          type: input.type,
          targetCount: input.type === 'count' ? input.targetCount : undefined,
          reminderTimes: input.reminderTimes && input.reminderTimes.length > 0 ? input.reminderTimes : undefined,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'addHabit', habit });
        return habit;
      },
      updateHabit: (habit) => dispatch({ type: 'updateHabit', habit }),
      deleteHabit: (habitId) => dispatch({ type: 'deleteHabit', habitId }),
      logHabit: (habitId, amount = 1) => dispatch({ type: 'logHabit', habitId, amount }),
      unlogHabit: (habitId) => dispatch({ type: 'unlogHabit', habitId }),
      setChallengeStatus: (challengeId, status) => dispatch({ type: 'setChallengeStatus', challengeId, status }),
      startChallenge: (habitIds, durationDays) => dispatch({ type: 'startChallenge', habitIds, durationDays }),
      completeOnboarding: () => dispatch({ type: 'completeOnboarding' }),
      resetOnboarding: () => dispatch({ type: 'resetOnboarding' }),
      setNotifications: (enabled, times) => dispatch({ type: 'setNotifications', enabled, times }),
      setSoundEnabled: (enabled) => dispatch({ type: 'setSoundEnabled', enabled }),
      debugBackfillLogs: (habitId, dates) => dispatch({ type: 'debugBackfillLogs', habitId, dates }),
      debugAdvanceChallenge: (challengeId) => dispatch({ type: 'debugAdvanceChallenge', challengeId }),
      debugCompleteChallenge: (challengeId) => dispatch({ type: 'debugCompleteChallenge', challengeId }),
      resetAllData: () => dispatch({ type: 'resetAllData' }),
    }),
    [state, hydrated],
  );

  return <HabitStoreContext.Provider value={store}>{children}</HabitStoreContext.Provider>;
}

export function useHabitStore(): HabitStore {
  const store = useContext(HabitStoreContext);
  if (!store) throw new Error('useHabitStore must be used within a HabitStoreProvider');
  return store;
}
