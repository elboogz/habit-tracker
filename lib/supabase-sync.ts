import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Challenge, Habit, HabitLog, HabitSchedulePeriod, HabitState } from './habit-types';
import { dequeue, enqueue, peekAll } from './sync-queue';
import { supabase } from './supabase';

const WATERMARK_PREFIX = 'habit-tracker/sync-watermark-v1:';
const EPOCH = '1970-01-01T00:00:00.000Z';

type HabitRow = {
  id: string;
  name: string;
  emoji: string;
  type: string;
  target_count: number | null;
  reminder_times: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type HabitLogRow = {
  id: string;
  habit_id: string;
  date: string;
  count: number;
  logged_at: string;
  updated_at: string;
};

type ChallengeRow = {
  id: string;
  habit_ids: string[];
  duration_days: number;
  start_date: string;
  status: string;
  updated_at: string;
  deleted_at: string | null;
};

type SettingsRow = {
  has_onboarded: boolean;
  notifications_enabled: boolean;
  notification_times: string[];
  sound_enabled: boolean;
  updated_at: string;
};

type HabitSchedulePeriodRow = {
  id: string;
  habit_id: string;
  effective_from: string;
  days_of_week: number[] | null; // null = daily
  paused: boolean;
  created_at: string;
  updated_at: string;
};

function habitToRow(habit: Habit, userId: string, deleted = false): Record<string, unknown> {
  // A soft-delete must bump updated_at to "now" (not reuse the stale value) — otherwise
  // another device's watermark-based pull could already be past it and miss the tombstone.
  const updatedAt = deleted ? new Date().toISOString() : habit.updatedAt;
  return {
    id: habit.id,
    user_id: userId,
    name: habit.name,
    emoji: habit.emoji,
    type: habit.type,
    target_count: habit.targetCount ?? null,
    reminder_times: habit.reminderTimes ?? null,
    created_at: habit.createdAt,
    updated_at: updatedAt,
    deleted_at: deleted ? updatedAt : null,
  };
}

function rowToHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    type: row.type as Habit['type'],
    targetCount: row.target_count ?? undefined,
    reminderTimes: row.reminder_times ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function logToRow(log: HabitLog, userId: string): Record<string, unknown> {
  return {
    id: log.id,
    user_id: userId,
    habit_id: log.habitId,
    date: log.date,
    count: log.count,
    logged_at: log.loggedAt,
    updated_at: log.updatedAt,
  };
}

function rowToLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    date: row.date,
    count: row.count,
    loggedAt: row.logged_at,
    updatedAt: row.updated_at,
  };
}

function challengeToRow(challenge: Challenge, userId: string, deleted = false): Record<string, unknown> {
  const updatedAt = deleted ? new Date().toISOString() : challenge.updatedAt;
  return {
    id: challenge.id,
    user_id: userId,
    habit_ids: challenge.habitIds,
    duration_days: challenge.durationDays,
    start_date: challenge.startDate,
    status: challenge.status,
    updated_at: updatedAt,
    deleted_at: deleted ? updatedAt : null,
  };
}

function rowToChallenge(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    habitIds: row.habit_ids,
    durationDays: row.duration_days,
    startDate: row.start_date,
    status: row.status as Challenge['status'],
    updatedAt: row.updated_at,
  };
}

function periodToRow(period: HabitSchedulePeriod, userId: string): Record<string, unknown> {
  return {
    id: period.id,
    user_id: userId,
    habit_id: period.habitId,
    effective_from: period.effectiveFrom,
    days_of_week: period.days === 'daily' ? null : period.days,
    paused: period.paused,
    created_at: period.createdAt,
    updated_at: period.updatedAt,
  };
}

function rowToPeriod(row: HabitSchedulePeriodRow): HabitSchedulePeriod {
  return {
    id: row.id,
    habitId: row.habit_id,
    effectiveFrom: row.effective_from,
    days: row.days_of_week ?? 'daily',
    paused: row.paused,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function settingsToRow(state: HabitState, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    has_onboarded: state.hasOnboarded,
    notifications_enabled: state.notifications.enabled,
    notification_times: state.notifications.times,
    sound_enabled: state.soundEnabled,
    updated_at: new Date().toISOString(),
  };
}

async function getWatermark(userId: string): Promise<string> {
  return (await AsyncStorage.getItem(WATERMARK_PREFIX + userId)) ?? EPOCH;
}

async function setWatermark(userId: string, value: string): Promise<void> {
  await AsyncStorage.setItem(WATERMARK_PREFIX + userId, value);
}

/** Drains the outbox in order against Supabase. Stops on the first failure (e.g. offline) so ordering is preserved and the rest retry next trigger. */
export async function pushPendingChanges(): Promise<void> {
  const ops = await peekAll();
  for (const op of ops) {
    try {
      const { error } =
        op.op === 'upsert'
          ? await supabase.from(op.table).upsert(op.payload)
          : await supabase.from(op.table).delete().eq('id', op.payload.id as string);
      if (error) return;
    } catch {
      return;
    }
    await dequeue(op.id);
  }
}

export type RemoteChanges = {
  habits: Habit[];
  deletedHabitIds: string[];
  logs: HabitLog[];
  challenges: Challenge[];
  deletedChallengeIds: string[];
  schedulePeriods: HabitSchedulePeriod[];
  settings: Partial<HabitState> | null;
};

/** Fetches rows changed since the last pull and advances the per-user watermark. Returns null on failure (offline) — caller should no-op. */
export async function pullRemoteChanges(userId: string): Promise<RemoteChanges | null> {
  const since = await getWatermark(userId);

  const [habitsRes, logsRes, challengesRes, schedulePeriodsRes, settingsRes] = await Promise.all([
    supabase.from('habits').select('*').eq('user_id', userId).gt('updated_at', since),
    supabase.from('habit_logs').select('*').eq('user_id', userId).gt('updated_at', since),
    supabase.from('challenges').select('*').eq('user_id', userId).gt('updated_at', since),
    supabase.from('habit_schedule_periods').select('*').eq('user_id', userId).gt('updated_at', since),
    supabase.from('user_settings').select('*').eq('user_id', userId).gt('updated_at', since).maybeSingle(),
  ]);

  if (habitsRes.error || logsRes.error || challengesRes.error || schedulePeriodsRes.error || settingsRes.error) {
    return null;
  }

  let latest = since;
  const bump = (ts: string) => {
    if (ts > latest) latest = ts;
  };

  const habits: Habit[] = [];
  const deletedHabitIds: string[] = [];
  for (const row of (habitsRes.data ?? []) as HabitRow[]) {
    bump(row.updated_at);
    if (row.deleted_at) deletedHabitIds.push(row.id);
    else habits.push(rowToHabit(row));
  }

  const logs = ((logsRes.data ?? []) as HabitLogRow[]).map((row) => {
    bump(row.updated_at);
    return rowToLog(row);
  });

  const challenges: Challenge[] = [];
  const deletedChallengeIds: string[] = [];
  for (const row of (challengesRes.data ?? []) as ChallengeRow[]) {
    bump(row.updated_at);
    if (row.deleted_at) deletedChallengeIds.push(row.id);
    else challenges.push(rowToChallenge(row));
  }

  // No delete/tombstone case here: schedule periods are append-only (see
  // docs/phase-2-implementation-plan.md section 1), so every changed row is a new or corrected period.
  const schedulePeriods = ((schedulePeriodsRes.data ?? []) as HabitSchedulePeriodRow[]).map((row) => {
    bump(row.updated_at);
    return rowToPeriod(row);
  });

  let settings: Partial<HabitState> | null = null;
  if (settingsRes.data) {
    const row = settingsRes.data as SettingsRow;
    bump(row.updated_at);
    settings = {
      hasOnboarded: row.has_onboarded,
      notifications: { enabled: row.notifications_enabled, times: row.notification_times },
      soundEnabled: row.sound_enabled,
    };
  }

  if (latest !== since) await setWatermark(userId, latest);

  return { habits, deletedHabitIds, logs, challenges, deletedChallengeIds, schedulePeriods, settings };
}

/** Enqueues every habit/log/challenge/schedule period/setting in `state` for upload — used once, the first time pre-existing local (pre-auth) data is adopted into a freshly signed-up account. */
export async function enqueueFullUpload(state: HabitState, userId: string): Promise<void> {
  for (const habit of state.habits) {
    await enqueue('habits', 'upsert', habitToRow(habit, userId));
  }
  for (const log of state.logs) {
    await enqueue('habit_logs', 'upsert', logToRow(log, userId));
  }
  for (const challenge of state.challenges) {
    await enqueue('challenges', 'upsert', challengeToRow(challenge, userId));
  }
  for (const period of state.schedulePeriods) {
    await enqueue('habit_schedule_periods', 'upsert', periodToRow(period, userId));
  }
  await enqueue('user_settings', 'upsert', settingsToRow(state, userId));
}

/**
 * Diffs two state snapshots and enqueues the minimal set of sync ops, then kicks off a push.
 * This is the only place that decides what gets synced — mutators in habit-store.tsx don't
 * need to know about Supabase at all, they just update the reducer as before.
 */
export async function diffAndSync(prev: HabitState, next: HabitState, userId: string): Promise<void> {
  const prevHabits = new Map(prev.habits.map((h) => [h.id, h]));
  for (const habit of next.habits) {
    if (prevHabits.get(habit.id) !== habit) await enqueue('habits', 'upsert', habitToRow(habit, userId));
    prevHabits.delete(habit.id);
  }
  for (const removed of prevHabits.values()) {
    await enqueue('habits', 'upsert', habitToRow(removed, userId, true));
  }

  const prevLogs = new Map(prev.logs.map((l) => [l.id, l]));
  for (const log of next.logs) {
    if (!prevLogs.has(log.id)) await enqueue('habit_logs', 'upsert', logToRow(log, userId));
    prevLogs.delete(log.id);
  }
  for (const removed of prevLogs.values()) {
    await enqueue('habit_logs', 'delete', { id: removed.id });
  }

  const prevChallenges = new Map(prev.challenges.map((c) => [c.id, c]));
  for (const challenge of next.challenges) {
    if (prevChallenges.get(challenge.id) !== challenge) {
      await enqueue('challenges', 'upsert', challengeToRow(challenge, userId));
    }
    prevChallenges.delete(challenge.id);
  }
  for (const removed of prevChallenges.values()) {
    await enqueue('challenges', 'upsert', challengeToRow(removed, userId, true));
  }

  // No delete branch: schedule periods are never removed locally (append-only, see
  // docs/phase-2-implementation-plan.md section 1) -- only new or (defensively) corrected ones.
  const prevPeriods = new Map(prev.schedulePeriods.map((p) => [p.id, p]));
  for (const period of next.schedulePeriods) {
    if (prevPeriods.get(period.id) !== period) {
      await enqueue('habit_schedule_periods', 'upsert', periodToRow(period, userId));
    }
    prevPeriods.delete(period.id);
  }

  if (
    prev.hasOnboarded !== next.hasOnboarded ||
    prev.notifications !== next.notifications ||
    prev.soundEnabled !== next.soundEnabled
  ) {
    await enqueue('user_settings', 'upsert', settingsToRow(next, userId));
  }

  await pushPendingChanges();
}
