import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Habit, NotificationPrefs } from './habit-types';

const REMINDER_MESSAGES = [
  { title: 'Ready when you are', body: "Your habits are waiting — even a small rep counts today." },
  { title: "Don't lose the streak", body: 'A quick check-in keeps your momentum alive.' },
  { title: 'Quick nudge 👋', body: 'Got a minute to log today’s habits?' },
];

/**
 * expo-notifications scheduling only works reliably in a development or
 * production build. In Expo Go (executionEnvironment === 'storeClient')
 * and on web, the scheduling API fails silently — preferences are saved but
 * reminders won't fire. A development build is required for real delivery.
 */
export const notificationsSupported =
  Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient';

/**
 * Asks for notification permission if not already decided. Returns whether the
 * app can schedule reminders — callers should treat `false` as "stay opted out".
 * On web this resolves based on the browser Notification API where available,
 * but never throws.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    // Some platforms (web without Notification support, etc.) reject outright.
    return false;
  }
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}

/**
 * Replaces all scheduled reminders with the global daily check-in times plus
 * one daily reminder per habit-specific `reminderTimes` entry. This is the
 * retention hook's delivery mechanism — locally scheduled, not remote push
 * (see CLAUDE.md for why). No-ops safely on web and swallows scheduling errors
 * so a misbehaving platform never blocks saving preferences.
 */
export async function scheduleAllReminders(notifications: NotificationPrefs, habits: Habit[]): Promise<void> {
  if (!notificationsSupported) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!notifications.enabled) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('habit-reminders', {
        name: 'Habit reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const tasks: Promise<unknown>[] = [];

    notifications.times.forEach((time, index) => {
      const { hour, minute } = parseTime(time);
      const message = REMINDER_MESSAGES[index % REMINDER_MESSAGES.length];
      tasks.push(
        Notifications.scheduleNotificationAsync({
          content: { title: message.title, body: message.body },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'habit-reminders' },
        }),
      );
    });

    habits.forEach((habit) => {
      (habit.reminderTimes ?? []).forEach((time) => {
        const { hour, minute } = parseTime(time);
        tasks.push(
          Notifications.scheduleNotificationAsync({
            content: {
              title: `${habit.emoji} ${habit.name}`,
              body: `Time to log ${habit.name.toLowerCase()} — keep your streak going!`,
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'habit-reminders' },
          }),
        );
      });
    });

    await Promise.all(tasks);
  } catch {
    // Scheduling can fail in Expo Go / unsupported environments — preferences are still saved
    // and will take effect next time scheduling succeeds (e.g. after a dev/prod build).
  }
}
