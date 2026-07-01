import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from './auth-store';
import { addDays, dayKey } from './habit-stats';
import type { Challenge, Habit, HabitLog, HabitState, HabitType } from './habit-types';
import { scheduleAllReminders } from './notifications';
import { diffAndSync, enqueueFullUpload, pullRemoteChanges, pushPendingChanges, type RemoteChanges } from './supabase-sync';

/** Pre-auth storage key, written before this app had accounts. Only read once, as a one-time migration into a brand-new account. */
const LEGACY_STORAGE_KEY = 'habit-tracker/state-v1';
const scopedKey = (userId: string) => `habit-tracker/state-v1:${userId}`;

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

/** Pre-sync local data has no updatedAt — backfill it once so last-write-wins merging has something to compare against. */
function backfillTimestamps(state: HabitState): HabitState {
  return {
    ...state,
    habits: state.habits.map((habit) => ({ ...habit, updatedAt: habit.updatedAt ?? habit.createdAt })),
    logs: state.logs.map((log) => ({ ...log, updatedAt: log.updatedAt ?? log.loggedAt })),
    challenges: state.challenges.map((challenge) => ({
      ...challenge,
      updatedAt: challenge.updatedAt ?? new Date().toISOString(),
    })),
  };
}

type Action =
  | { type: 'hydrate'; state: HabitState }
  | { type: 'mergeRemote'; changes: RemoteChanges }
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
  | { type: 'debugFillHistory'; mode: 'full' | 'alternating' }
  | { type: 'resetAllData' };

function reducer(state: HabitState, action: Action): HabitState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'mergeRemote': {
      const { changes } = action;
      const habits = state.habits.filter((habit) => !changes.deletedHabitIds.includes(habit.id));
      for (const habit of changes.habits) {
        const index = habits.findIndex((existing) => existing.id === habit.id);
        if (index === -1) habits.push(habit);
        else if (habit.updatedAt >= habits[index].updatedAt) habits[index] = habit;
      }

      const logs = state.logs.filter((log) => !changes.deletedHabitIds.includes(log.habitId));
      const existingLogIds = new Set(logs.map((log) => log.id));
      for (const log of changes.logs) {
        if (!existingLogIds.has(log.id)) logs.push(log);
      }

      const challenges = state.challenges.filter((challenge) => !changes.deletedChallengeIds.includes(challenge.id));
      for (const challenge of changes.challenges) {
        const index = challenges.findIndex((existing) => existing.id === challenge.id);
        if (index === -1) challenges.push(challenge);
        else if (challenge.updatedAt >= challenges[index].updatedAt) challenges[index] = challenge;
      }

      return { ...state, habits, logs, challenges, ...(changes.settings ?? {}) };
    }
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
            challenge.status === 'active' && challenge.habitIds.includes(action.habitId)
              ? {
                  ...challenge,
                  habitIds: challenge.habitIds.filter((id) => id !== action.habitId),
                  updatedAt: new Date().toISOString(),
                }
              : challenge,
          )
          .filter((challenge) => challenge.status !== 'active' || challenge.habitIds.length > 0),
      };
    case 'logHabit': {
      const now = new Date().toISOString();
      const log: HabitLog = {
        id: Crypto.randomUUID(),
        habitId: action.habitId,
        date: dayKey(),
        count: action.amount,
        loggedAt: now,
        updatedAt: now,
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
          challenge.id === action.challengeId
            ? { ...challenge, status: action.status, updatedAt: new Date().toISOString() }
            : challenge,
        ),
      };
    case 'startChallenge': {
      if (action.habitIds.length === 0) return state;
      // Multiple challenges can run at once as long as they don't share a habit — a habit can
      // only belong to one active challenge at a time, since challengeProgress requires every
      // included habit to be done to count a day.
      const overlapsActiveChallenge = state.challenges.some(
        (challenge) =>
          challenge.status === 'active' && challenge.habitIds.some((id) => action.habitIds.includes(id)),
      );
      if (overlapsActiveChallenge) return state;
      const challenge: Challenge = {
        id: Crypto.randomUUID(),
        habitIds: action.habitIds,
        durationDays: action.durationDays,
        startDate: dayKey(),
        status: 'active',
        updatedAt: new Date().toISOString(),
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
      const now = new Date().toISOString();
      const filteredLogs = state.logs.filter(
        (log) => !(log.habitId === action.habitId && action.dates.includes(log.date)),
      );
      const newLogs: HabitLog[] = action.dates.map((date, index) => ({
        id: `${action.habitId}-debug-${date}-${index}`,
        habitId: action.habitId,
        date,
        count: amount,
        loggedAt: now,
        updatedAt: now,
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

      const now = new Date().toISOString();
      let logs = state.logs;
      for (const habit of challengeHabits) {
        const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
        logs = logs.filter((log) => !(log.habitId === habit.id && pastDates.includes(log.date)));
        const newLogs: HabitLog[] = pastDates.map((date, index) => ({
          id: `${habit.id}-debug-${date}-${index}`,
          habitId: habit.id,
          date,
          count: amount,
          loggedAt: now,
          updatedAt: now,
        }));
        logs = [...logs, ...newLogs];
      }

      return {
        ...state,
        logs,
        challenges: state.challenges.map((c) =>
          c.id === challenge.id ? { ...c, startDate: newStartDate, updatedAt: now } : c,
        ),
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

      const now = new Date().toISOString();
      let logs = state.logs;
      for (const habit of challengeHabits) {
        const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
        logs = logs.filter((log) => !(log.habitId === habit.id && allDates.includes(log.date)));
        const newLogs: HabitLog[] = allDates.map((date, index) => ({
          id: `${habit.id}-debug-${date}-${index}`,
          habitId: habit.id,
          date,
          count: amount,
          loggedAt: now,
          updatedAt: now,
        }));
        logs = [...logs, ...newLogs];
      }

      return {
        ...state,
        logs,
        challenges: state.challenges.map((c) =>
          c.id === challenge.id ? { ...c, startDate: newStartDate, status: 'completed', updatedAt: now } : c,
        ),
      };
    }
    case 'debugFillHistory': {
      const today = dayKey();
      const dates: string[] = [];
      for (let i = 29; i >= 0; i -= 1) {
        dates.push(addDays(today, -i));
      }
      const dateSet = new Set(dates);
      const now = new Date().toISOString();
      // Clear all logs in the window first so the fill is idempotent and alternating mode
      // correctly leaves odd-indexed habits with zero completions in the window.
      let logs = state.logs.filter((log) => !dateSet.has(log.date));
      state.habits.forEach((habit, index) => {
        if (action.mode === 'alternating' && index % 2 !== 0) return;
        const amount = habit.type === 'count' ? (habit.targetCount ?? 1) : 1;
        const newLogs: HabitLog[] = dates.map((date) => ({
          id: `${habit.id}-debug-fill-${date}`,
          habitId: habit.id,
          date,
          count: amount,
          loggedAt: now,
          updatedAt: now,
        }));
        logs = [...logs, ...newLogs];
      });
      return { ...state, logs };
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
  /** Fills the last 30 days of logs for all habits (full) or every other habit (alternating) — dev tools only. */
  debugFillHistory: (mode: 'full' | 'alternating') => void;
  /** Wipes all app data back to a fresh install, including onboarding — dev tools only. */
  resetAllData: () => void;
};

const HabitStoreContext = createContext<HabitStore | null>(null);

export function HabitStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [state, dispatch] = useReducer(reducer, initialState);
  const [hydrated, setHydrated] = useState(false);

  // Baseline for diffing local mutations against, to decide what to push to Supabase.
  // Updated on every render so a 'hydrate'/'mergeRemote' dispatch never gets re-diffed
  // against itself; skipNextDiffRef additionally guards the dev-only full reset.
  const prevSyncedStateRef = useRef<HabitState | null>(null);
  const skipNextDiffRef = useRef(false);

  // Hydrate whenever the signed-in user changes: load that user's local cache, or — if
  // this device has never seen this account before — adopt any pre-existing (pre-auth)
  // local data instead of discarding it, then push it up as that user's first sync.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);

    if (!userId) {
      dispatch({ type: 'hydrate', state: initialState });
      setHydrated(true);
      return;
    }

    (async () => {
      const scoped = await AsyncStorage.getItem(scopedKey(userId));
      if (cancelled) return;

      if (scoped) {
        try {
          const parsed = JSON.parse(scoped);
          dispatch({
            type: 'hydrate',
            state: { ...initialState, ...parsed, challenges: migrateChallenges(parsed.challenges) },
          });
        } catch {
          dispatch({ type: 'hydrate', state: initialState });
        }
      } else {
        const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        let migrated: HabitState | null = null;
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            migrated = backfillTimestamps({
              ...initialState,
              ...parsed,
              challenges: migrateChallenges(parsed.challenges),
            });
          } catch {
            // Corrupt legacy data — fall back to a fresh start below.
          }
        }
        dispatch({ type: 'hydrate', state: migrated ?? initialState });
        if (migrated) {
          await enqueueFullUpload(migrated, userId);
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }

      if (cancelled) return;
      setHydrated(true);

      await pushPendingChanges();
      const changes = await pullRemoteChanges(userId);
      if (!cancelled && changes) dispatch({ type: 'mergeRemote', changes });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    // Skip the pre-hydration write — otherwise the initial empty state would
    // briefly overwrite whatever was already persisted on disk.
    if (!hydrated || !userId) return;
    AsyncStorage.setItem(scopedKey(userId), JSON.stringify(state));
  }, [state, hydrated, userId]);

  // Mirror local mutations out to Supabase in the background. Diffing against the last
  // synced snapshot (rather than hooking every mutator) keeps habit-store's mutators
  // backend-agnostic — they only ever touch the local reducer.
  useEffect(() => {
    if (!hydrated || !userId) {
      prevSyncedStateRef.current = state;
      return;
    }
    const prev = prevSyncedStateRef.current;
    prevSyncedStateRef.current = state;
    if (!prev) return;
    if (skipNextDiffRef.current) {
      skipNextDiffRef.current = false;
      return;
    }
    diffAndSync(prev, state, userId);
  }, [state, hydrated, userId]);

  // Catch up on remote changes (e.g. from another device) whenever the app comes back
  // to the foreground — there's no realtime subscription, so this is the pull trigger.
  useEffect(() => {
    if (!hydrated || !userId) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      (async () => {
        await pushPendingChanges();
        const changes = await pullRemoteChanges(userId);
        if (changes) dispatch({ type: 'mergeRemote', changes });
      })();
    });
    return () => subscription.remove();
  }, [hydrated, userId]);

  useEffect(() => {
    if (!hydrated) return;
    scheduleAllReminders(state.notifications, state.habits);
  }, [hydrated, state.notifications, state.habits]);

  const store = useMemo<HabitStore>(
    () => ({
      state,
      hydrated,
      addHabit: (input) => {
        const now = new Date().toISOString();
        const habit: Habit = {
          id: Crypto.randomUUID(),
          name: input.name,
          emoji: input.emoji,
          type: input.type,
          targetCount: input.type === 'count' ? input.targetCount : undefined,
          reminderTimes: input.reminderTimes && input.reminderTimes.length > 0 ? input.reminderTimes : undefined,
          createdAt: now,
          updatedAt: now,
        };
        dispatch({ type: 'addHabit', habit });
        return habit;
      },
      updateHabit: (habit) => dispatch({ type: 'updateHabit', habit: { ...habit, updatedAt: new Date().toISOString() } }),
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
      debugFillHistory: (mode) => dispatch({ type: 'debugFillHistory', mode }),
      resetAllData: () => {
        // Local-only preview reset — must not propagate as a mass-delete to the real account.
        skipNextDiffRef.current = true;
        dispatch({ type: 'resetAllData' });
      },
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
