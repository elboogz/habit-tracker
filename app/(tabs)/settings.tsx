import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/celebration-overlay';
import { ReminderTimesEditor } from '@/components/reminder-times-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirmAction } from '@/lib/confirm';
import { addDays, challengeProgress, dayKey } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import { ensureNotificationPermission, notificationsSupported } from '@/lib/notifications';
import { useCelebration } from '@/lib/use-celebration';

const STREAK_BACKFILL_DAYS = 6;

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    state,
    setNotifications,
    setSoundEnabled,
    debugBackfillLogs,
    debugAdvanceChallenge,
    debugCompleteChallenge,
    resetOnboarding,
    resetAllData,
  } = useHabitStore();
  const { celebration, fire, clear } = useCelebration(state.soundEnabled);
  const [busy, setBusy] = useState(false);
  const [simulatedIds, setSimulatedIds] = useState<Set<string>>(new Set());
  const { enabled, times } = state.notifications;

  async function handleToggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        if (notificationsSupported) {
          const granted = await ensureNotificationPermission();
          if (!granted) return;
        }
        const activeTimes = times.length > 0 ? times : ['09:00'];
        setNotifications(true, activeTimes);
      } else {
        setNotifications(false, times);
      }
    } finally {
      setBusy(false);
    }
  }

  function updateTimes(next: string[]) {
    if (next.length === 0) return;
    setNotifications(enabled, next);
  }

  function handleResetAllData() {
    confirmAction(
      'Reset all app data?',
      'This deletes every habit, log, and challenge, and takes you back through onboarding. This cannot be undone.',
      'Reset',
      () => {
        resetAllData();
        if (Platform.OS === 'web') window.location.reload();
      },
    );
  }

  function handleResetOnboarding() {
    confirmAction(
      'Reset onboarding?',
      'This restarts the first-run flow from the welcome screen. Your habits, logs, and challenges are kept.',
      'Reset',
      () => {
        resetOnboarding();
        if (Platform.OS === 'web') window.location.reload();
      },
    );
  }

  function handleCompleteChallenge(challengeId: string) {
    debugCompleteChallenge(challengeId);
    fire('🏆', 'Challenge complete! 🎉', true);
  }

  function handleSimulateStreak(habitId: string) {
    const today = dayKey();
    const dates: string[] = [];
    for (let i = STREAK_BACKFILL_DAYS; i >= 1; i -= 1) {
      dates.push(addDays(today, -i));
    }
    debugBackfillLogs(habitId, dates);
    setSimulatedIds((current) => new Set([...current, habitId]));
    setTimeout(() => {
      setSimulatedIds((current) => {
        const next = new Set(current);
        next.delete(habitId);
        return next;
      });
    }, 2000);
  }

  const activeChallenges = state.challenges.filter((c) => c.status === 'active');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Settings</ThemedText>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Daily check-ins</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Reminders</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  A friendly nudge to log your habits and keep your streaks alive.
                </ThemedText>
              </ThemedView>
              <Switch
                value={enabled}
                onValueChange={handleToggle}
                disabled={busy}
                trackColor={{ false: colors.icon, true: colors.tint }}
                thumbColor="#fff"
              />
            </ThemedView>

            {enabled && (
              <ThemedView style={{ gap: 8 }}>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Reminder times</ThemedText>
                <ReminderTimesEditor times={times} onChange={updateTimes} />
              </ThemedView>
            )}

            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              Want a nudge for one specific habit? Set per-habit reminder times from that habit&apos;s edit screen.
            </ThemedText>

            {!notificationsSupported && (
              <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                Reminders can&apos;t fire here — Expo Go and web browsers don&apos;t support local notification
                scheduling. Your preferences are saved and will take effect in a development or production build.
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Sound effects</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Celebration chime</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  Plays a sound when you log a habit or complete a challenge.
                </ThemedText>
              </ThemedView>
              <Switch
                value={state.soundEnabled}
                onValueChange={setSoundEnabled}
                trackColor={{ false: colors.icon, true: colors.tint }}
                thumbColor="#fff"
              />
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">About</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedText style={{ color: colors.icon, fontSize: 13, flex: 1 }}>
                Appearance follows your system&apos;s light/dark setting automatically.
              </ThemedText>
            </ThemedView>
          </ThemedView>

          {__DEV__ && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Developer tools</ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                Visible only in development builds. Use these to fast-forward state and verify the core loop and
                challenge-completion celebration without waiting days.
              </ThemedText>

              {activeChallenges.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Active challenges</ThemedText>
                  {activeChallenges.map((challenge) => {
                    const progress = challengeProgress(challenge, state.habits, state.logs);
                    if (progress.habits.length === 0) return null;
                    const atFinalDay = progress.daysElapsed >= progress.totalDays;
                    return (
                      <ThemedView key={challenge.id} style={[styles.devRow, { borderColor: colors.icon }]}>
                        <ThemedView style={{ flex: 1, gap: 2 }}>
                          <ThemedText>
                            {progress.habits.map((h) => h.emoji).join(' ')}{' '}
                            {progress.habits.map((h) => h.name).join(', ')}
                          </ThemedText>
                          <ThemedText style={{ color: colors.icon, fontSize: 12 }}>
                            Day {progress.daysElapsed} of {progress.totalDays}
                          </ThemedText>
                        </ThemedView>
                        <ThemedView style={{ gap: 8 }}>
                          <Pressable
                            disabled={atFinalDay}
                            onPress={() => debugAdvanceChallenge(challenge.id)}
                            style={[styles.devButton, { borderColor: colors.tint }, atFinalDay && { opacity: 0.4 }]}>
                            <ThemedText style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>
                              {atFinalDay ? 'On final day' : 'Jump to final day'}
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            onPress={() => handleCompleteChallenge(challenge.id)}
                            style={[styles.devButton, { borderColor: colors.tint, backgroundColor: colors.tint }]}>
                            <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 13 }}>
                              Complete now 🏆
                            </ThemedText>
                          </Pressable>
                        </ThemedView>
                      </ThemedView>
                    );
                  })}
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    &quot;Jump to final day&quot; backfills earlier days so you can log the habit yourself on the Today
                    tab and trigger the real completion celebration. &quot;Complete now&quot; instantly backfills every
                    day, marks the challenge completed, and fires the celebration here — check the Today and
                    Challenges tabs afterwards to see the post-completion state.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Simulate a streak</ThemedText>
                  {state.habits.map((habit) => {
                    const done = simulatedIds.has(habit.id);
                    return (
                      <ThemedView key={habit.id} style={[styles.devRow, { borderColor: colors.icon }]}>
                        <ThemedText style={{ flex: 1 }}>
                          {habit.emoji} {habit.name}
                        </ThemedText>
                        <Pressable
                          onPress={() => handleSimulateStreak(habit.id)}
                          disabled={done}
                          style={[
                            styles.devButton,
                            { borderColor: colors.tint },
                            done && { backgroundColor: colors.tint },
                          ]}>
                          <ThemedText style={{ color: done ? colors.background : colors.tint, fontWeight: '600', fontSize: 13 }}>
                            {done ? 'Done ✓' : `+${STREAK_BACKFILL_DAYS}-day streak`}
                          </ThemedText>
                        </Pressable>
                      </ThemedView>
                    );
                  })}
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Backfills the last {STREAK_BACKFILL_DAYS} days as done (today is left for you to log), so you can
                    check Progress streaks, best streaks, and the weekly view.
                  </ThemedText>
                </ThemedView>
              )}

              <Pressable onPress={handleResetOnboarding} style={[styles.resetButton, { borderColor: colors.tint }]}>
                <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>Reset onboarding</ThemedText>
              </Pressable>

              <Pressable onPress={handleResetAllData} style={[styles.resetButton, { borderColor: '#d9534f' }]}>
                <ThemedText style={{ color: '#d9534f', fontWeight: '600' }}>Reset all app data</ThemedText>
              </Pressable>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
      <CelebrationOverlay celebration={celebration} onDone={clear} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 28,
  },
  header: {
    gap: 4,
  },
  section: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  devButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
});
