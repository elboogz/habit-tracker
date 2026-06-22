export type HabitType = 'simple' | 'count';

export type Habit = {
  id: string;
  name: string;
  emoji: string;
  type: HabitType;
  /** Only set for 'count' habits — e.g. 8 glasses of water per day. */
  targetCount?: number;
  /** Optional per-habit daily reminder times, 'HH:mm' 24-hour local time. */
  reminderTimes?: string[];
  createdAt: string;
  /** ISO timestamp of the last change — drives last-write-wins merging during Supabase sync. */
  updatedAt: string;
};

export type HabitLog = {
  id: string;
  habitId: string;
  /** Local day key, 'YYYY-MM-DD'. */
  date: string;
  /** 1 for simple habits, running tally for count habits. */
  count: number;
  loggedAt: string;
  /** ISO timestamp of the last change — drives last-write-wins merging during Supabase sync. */
  updatedAt: string;
};

export type ChallengeStatus = 'active' | 'completed' | 'failed';

export type Challenge = {
  id: string;
  /** All habits that must be completed each day for this challenge to count. */
  habitIds: string[];
  durationDays: number;
  /** Local day key, 'YYYY-MM-DD'. */
  startDate: string;
  status: ChallengeStatus;
  /** ISO timestamp of the last change — drives last-write-wins merging during Supabase sync. */
  updatedAt: string;
};

export type NotificationPrefs = {
  enabled: boolean;
  /** 'HH:mm', 24-hour, local time. */
  times: string[];
};

export type HabitState = {
  habits: Habit[];
  logs: HabitLog[];
  challenges: Challenge[];
  hasOnboarded: boolean;
  notifications: NotificationPrefs;
  soundEnabled: boolean;
};

export const EMOJI_CHOICES = [
  '💧', '📚', '🏃', '🧘', '🥗',
  '😴', '✍️', '🦷', '🎯', '🌱',
  '💪', '🎨', '🧹', '💊', '🎵',
];
