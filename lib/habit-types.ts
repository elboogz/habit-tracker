export type HabitType = 'simple' | 'count';

export type Habit = {
  id: string;
  name: string;
  emoji: string;
  type: HabitType;
  /** Only set for 'count' habits — e.g. 8 glasses of water per day. */
  targetCount?: number;
  /**
   * Explicit smaller target for "Do a smaller version" (Phase 4 — habits with a measurable target
   * only, today exactly type === 'count'). Falls back to a derived default (see
   * lib/domain/habit-stats.ts's reducedTargetFor) when unset.
   */
  reducedTarget?: number;
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
  /** True when this entry is a reduced ("smaller version") completion, not the full target. */
  reduced?: boolean;
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

/** 'daily', or the set of weekdays it applies to (0=Sunday..6=Saturday, matches Date.getDay()). */
export type ScheduleDays = 'daily' | number[];

/**
 * One append-only, effective-dated schedule/pause period for a habit (Phase 2 — see
 * docs/phase-2-implementation-plan.md). The period governing a given date is the one with the
 * greatest `effectiveFrom <= date`; there is no `effectiveTo`, so a new period is always an
 * insert, never an edit of a prior row — this is what guarantees changing a habit's schedule
 * never recalculates the meaning of past periods. A habit with no periods behaves as daily and
 * unpaused, which is also the entirety of the migration story for every habit that predates
 * this concept: nothing is backfilled, the default reproduces current behavior exactly.
 */
export type HabitSchedulePeriod = {
  id: string;
  habitId: string;
  /** Local day key, 'YYYY-MM-DD', inclusive. */
  effectiveFrom: string;
  days: ScheduleDays;
  paused: boolean;
  createdAt: string;
  /** ISO timestamp of the last change — drives last-write-wins merging during Supabase sync. */
  updatedAt: string;
};

/** Phase 4 — the recovery card's "Reflect" and "Skip for today" options. */
export type LapseReasonKey = 'too_busy' | 'forgot' | 'low_energy' | 'not_feeling_it' | 'something_else';

/**
 * One acknowledged-miss record, written by either "Skip for today" or "Reflect" on the recovery
 * card (never by "Continue today" or dismiss, which record nothing — see
 * docs/phase-4-plan.md section 4.1). Purely additive/informational: no domain function in
 * lib/domain/ reads this to compute a metric; it exists to feed Phase 5's coach and to derive
 * the recovery card's own suppression window (lapseReasonSuppressionUntil in
 * lib/domain/recovery.ts).
 */
export type LapseReasonEntry = {
  id: string;
  habitId: string;
  /**
   * The Scheduled Opportunity date this entry is about. For a Reflect-originated row this is the
   * open lapse's firstMissedDate; for a card-level "Skip for today" row this is simply today's
   * date — see docs/phase-4-plan.md section 4.1.
   */
  missedOpportunityDate: string;
  reason: LapseReasonKey | null; // null when skipped
  note?: string; // optional free text, 'something_else' only
  skipped: boolean;
  createdAt: string;
  /** ISO timestamp of the last change — drives last-write-wins merging during Supabase sync. */
  updatedAt: string;
};

export type HabitState = {
  habits: Habit[];
  logs: HabitLog[];
  challenges: Challenge[];
  /**
   * Schedule/pause history per habit. No UI writes to this yet as of Phase 2 — every habit
   * simply has zero periods, which resolves to daily/unpaused (see lib/domain/schedule.ts).
   */
  schedulePeriods: HabitSchedulePeriod[];
  /** Phase 4 — acknowledged-miss records from the recovery card's Skip/Reflect actions. */
  lapseReasons: LapseReasonEntry[];
  hasOnboarded: boolean;
  notifications: NotificationPrefs;
  soundEnabled: boolean;
};

export const EMOJI_CHOICES = [
  '💧', '📚', '🏃', '🧘', '🥗',
  '😴', '✍️', '🦷', '🎯', '🌱',
  '💪', '🎨', '🧹', '💊', '🎵',
];
