import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/celebration-overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  challengeProgress,
  countForDay,
  dayKey,
  isDoneOnDay,
  isDoneToday,
  streakForHabit,
} from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import type { Habit } from '@/lib/habit-types';
import { useCelebration } from '@/lib/use-celebration';

const STREAK_MESSAGES = ['Nice work! 🎉', "You're on a roll!", 'Keep it up! 💪', 'Consistency wins.'];

function formatTodayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function TodayScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state, logHabit, unlogHabit, setChallengeStatus } = useHabitStore();
  const { celebration, fire, clear } = useCelebration(state.soundEnabled);

  const today = dayKey();
  const { habits, logs, challenges } = state;
  const activeChallenges = challenges.filter((challenge) => challenge.status === 'active');

  // Mark challenges as failed once a day passes without completion — keeps the
  // Challenges tab honest without requiring the user to do anything.
  useEffect(() => {
    for (const challenge of challenges) {
      if (challenge.status !== 'active') continue;
      const progress = challengeProgress(challenge, habits, logs);
      if (progress.isFailed) setChallengeStatus(challenge.id, 'failed');
    }
  }, [challenges, habits, logs, setChallengeStatus]);

  const completedCount = habits.filter((habit) => isDoneToday(habit, logs)).length;

  function handleLog(habit: Habit) {
    const wasDoneToday = isDoneToday(habit, logs);
    if (habit.type === 'simple' && wasDoneToday) return;

    logHabit(habit.id, 1);

    const syntheticLog = { id: 'pending', habitId: habit.id, date: today, count: 1, loggedAt: '', updatedAt: '' };
    const nextLogs = [...logs, syntheticLog];
    const nowDone = isDoneOnDay(habit, nextLogs, today);

    if (!nowDone) {
      const count = countForDay(nextLogs, habit.id, today);
      fire(habit.emoji, `${count} of ${habit.targetCount} today — keep going!`);
      return;
    }

    if (wasDoneToday) {
      fire(habit.emoji, 'Bonus rep — nice!');
      return;
    }

    const wasAllDoneBefore = habits.every((h) => isDoneOnDay(h, logs, today));
    const allDoneNow = habits.every((h) => isDoneOnDay(h, nextLogs, today));
    const justCompletedAllHabits = habits.length > 1 && allDoneNow && !wasAllDoneBefore;

    const habitChallenge = challenges.find((c) => c.status === 'active' && c.habitIds.includes(habit.id));
    if (habitChallenge) {
      const progress = challengeProgress(habitChallenge, habits, nextLogs);
      if (progress.isComplete) {
        setChallengeStatus(habitChallenge.id, 'completed');
        fire('🏆', 'Challenge complete! 🎉', true);
        return;
      }
      if (progress.todayDone) {
        if (justCompletedAllHabits) {
          fire('🎉', "All habits done for today — you're crushing it!", true);
        } else {
          fire('🚩', `Day ${progress.daysElapsed} of ${progress.totalDays} — challenge on track!`);
        }
        return;
      }
      const remaining = progress.habits.filter((h) => !isDoneOnDay(h, nextLogs, today)).length;
      fire(habit.emoji, `${remaining} more habit${remaining === 1 ? '' : 's'} to go for today's challenge`);
      return;
    }

    if (justCompletedAllHabits) {
      fire('🎉', "All habits done for today — you're crushing it!", true);
      return;
    }

    const streak = streakForHabit(habit, nextLogs);
    const message = streak > 1 ? `🔥 ${streak} day streak!` : STREAK_MESSAGES[streak % STREAK_MESSAGES.length];
    fire(habit.emoji, message);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Today</ThemedText>
            <ThemedText style={{ color: colors.icon }}>{formatTodayLabel()}</ThemedText>
            {habits.length > 0 && (
              <ThemedText style={{ color: colors.icon }}>
                {`${completedCount} of ${habits.length} done today`}
              </ThemedText>
            )}
            {habits.length === 0 && (
              <ThemedText style={{ color: colors.icon }}>Add your first habit to get started</ThemedText>
            )}
          </ThemedView>

          {activeChallenges.length > 0 && (
            <ThemedView style={{ gap: 8 }}>
              {activeChallenges.map((challenge) => {
                const progress = challengeProgress(challenge, habits, logs);
                if (progress.habits.length === 0) return null;
                return (
                  <Pressable key={challenge.id} onPress={() => router.push('/(tabs)/challenges')}>
                    <ThemedView style={[styles.challengeBanner, { borderColor: colors.tint }]}>
                      <ThemedText type="defaultSemiBold">
                        🚩 Day {progress.daysElapsed} of {progress.totalDays} challenge
                      </ThemedText>
                      <ThemedText style={{ color: colors.icon, fontSize: 14 }}>
                        {progress.habits.map((h) => h.emoji).join(' ')}{' '}
                        {progress.habits.length === 1 ? progress.habits[0].name : `${progress.habits.length} habits`}{' '}
                        — {progress.todayDone ? "today's set is locked in" : 'log them all today to keep your run alive'}
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                );
              })}
            </ThemedView>
          )}

          <ThemedView style={styles.list}>
            {habits.map((habit) => {
              const done = isDoneToday(habit, logs);
              const streak = streakForHabit(habit, logs);
              const todayCount = countForDay(logs, habit.id, today);

              return (
                <ThemedView
                  key={habit.id}
                  style={[
                    styles.habitRow,
                    { borderColor: colors.icon },
                    habit.type === 'count' && { alignItems: 'flex-start' },
                  ]}>
                  <Pressable
                    onPress={() => (done ? unlogHabit(habit.id) : handleLog(habit))}
                    style={({ pressed }) => [
                      styles.checkbox,
                      { borderColor: colors.tint },
                      done && { backgroundColor: colors.tint },
                      pressed && { opacity: 0.7 },
                    ]}>
                    {done && <ThemedText style={{ color: colors.background, fontSize: 16 }}>✓</ThemedText>}
                  </Pressable>
                  <ThemedView style={styles.habitInfo}>
                    <Pressable
                      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                      onPress={() => router.push(`/habit/${habit.id}`)}>
                      <ThemedText type="defaultSemiBold">
                        {habit.emoji} {habit.name}
                      </ThemedText>
                      <ThemedText style={{ color: colors.icon, fontSize: 14 }}>
                        🔥 {streak} day streak{habit.reminderTimes?.length ? ' · 🔔' : ''}
                      </ThemedText>
                    </Pressable>
                    {habit.type === 'count' && (
                      <ThemedView style={styles.countStepper}>
                        <Pressable
                          onPress={() => unlogHabit(habit.id)}
                          disabled={todayCount === 0}
                          style={({ pressed }) => [
                            styles.miniStepperButton,
                            { borderColor: colors.icon },
                            todayCount === 0 && { opacity: 0.3 },
                            pressed && { opacity: 0.7 },
                          ]}>
                          <ThemedText style={{ fontSize: 16 }}>−</ThemedText>
                        </Pressable>
                        <ThemedText style={{ fontSize: 13, fontWeight: '700', minWidth: 34, textAlign: 'center' }}>
                          {todayCount}/{habit.targetCount}
                        </ThemedText>
                        <Pressable
                          onPress={() => handleLog(habit)}
                          style={({ pressed }) => [
                            styles.miniStepperButton,
                            { borderColor: colors.icon },
                            pressed && { opacity: 0.7 },
                          ]}>
                          <ThemedText style={{ fontSize: 16 }}>+</ThemedText>
                        </Pressable>
                      </ThemedView>
                    )}
                  </ThemedView>
                  <IconSymbol name="chevron.right" size={18} color={colors.icon} />
                </ThemedView>
              );
            })}
          </ThemedView>

          <Pressable
            onPress={() => router.push('/habit-form')}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.tint },
              pressed && { opacity: 0.8 },
            ]}>
            <IconSymbol name="plus" size={18} color={colors.background} />
            <ThemedText style={{ color: colors.background, fontWeight: '600' }}>Add a habit</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <CelebrationOverlay celebration={celebration} onDone={clear} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 20,
  },
  header: {
    gap: 4,
  },
  challengeBanner: {
    gap: 4,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  list: {
    gap: 8,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  checkbox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniStepperButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitInfo: {
    flex: 1,
    gap: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
});
