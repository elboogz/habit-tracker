import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { ensureNotificationPermission } from './notifications';
import { supabase } from './supabase';

export type CoachPushResult = { error: string | null };

export type CoachPushPrefs = { enabled: boolean; time: string | null };

export async function getCoachPushPrefs(userId: string): Promise<CoachPushPrefs | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('coach_push_enabled, coach_push_time')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return { enabled: data.coach_push_enabled, time: data.coach_push_time };
}

/**
 * Requests notification permission, registers an Expo push token for this device, and saves the
 * chosen daily time + this device's IANA timezone to `user_settings` — read by the
 * `send-coaching-push` Edge Function (via Supabase Cron) to decide when to send.
 */
export async function enableCoachPush(userId: string, time: string): Promise<CoachPushResult> {
  const granted = await ensureNotificationPermission();
  if (!granted) return { error: 'Notification permission was not granted.' };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    return { error: 'Missing EAS project ID — this device build needs to be linked via `eas init`.' };
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not get a push token on this device.' };
  }

  const { error: tokenError } = await supabase.from('push_tokens').upsert({ token, user_id: userId });
  if (tokenError) return { error: tokenError.message };

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { error: settingsError } = await supabase.from('user_settings').upsert({
    user_id: userId,
    coach_push_enabled: true,
    coach_push_time: time,
    coach_push_timezone: timezone,
  });
  if (settingsError) return { error: settingsError.message };

  return { error: null };
}

export async function disableCoachPush(userId: string): Promise<CoachPushResult> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, coach_push_enabled: false });
  return { error: error?.message ?? null };
}
