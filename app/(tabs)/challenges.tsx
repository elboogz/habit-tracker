import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addDays, challengeProgress, type ChallengeProgress } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import type { Challenge } from '@/lib/habit-types';

const STATUS_LABEL: Record<Challenge['status'], string> = {
  active: 'In progress',
  completed: 'Completed 🏆',
  failed: 'Didn’t finish',
};

const DURATION_OPTIONS = [3, 5, 7, 14, 21, 30];

export default function ChallengesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state, startChallenge } = useHabitStore();
  const { habits, logs, challenges } = state;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [duration, setDuration] = useState(3);

  const activeChallenge = challenges.find((c) => c.status === 'active');
  const activeProgress = activeChallenge ? challengeProgress(activeChallenge, habits, logs) : null;
  const past = challenges.filter((c) => c.status !== 'active').slice().reverse();
  // Habits with the same name (e.g. accidentally added twice) should only offer one pick here.
  const pickableHabits = habits.filter(
    (habit, index) => habits.findIndex((other) => other.name === habit.name) === index,
  );

  function toggleHabit(habitId: string) {
    setSelectedIds((current) =>
      current.includes(habitId) ? current.filter((existing) => existing !== habitId) : [...current, habitId],
    );
  }

  function handleStart() {
    if (selectedIds.length === 0) return;
    startChallenge(selectedIds, duration);
    setSelectedIds([]);
    setDuration(3);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Challenges</ThemedText>
            <ThemedText style={{ color: colors.icon }}>
              Pick the habits to include and how long to run for — complete all of them every day to keep it alive.
            </ThemedText>
          </ThemedView>

          {activeChallenge && activeProgress && activeProgress.habits.length > 0 && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Active</ThemedText>
              <ThemedView style={[styles.activeCard, { borderColor: colors.tint }]}>
                <ThemedText type="defaultSemiBold">
                  🚩 {activeProgress.habits.map((h) => h.emoji).join(' ')}{' '}
                  {activeProgress.habits.map((h) => h.name).join(', ')}
                </ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 14 }}>
                  Day {activeProgress.daysElapsed} of {activeProgress.totalDays}
                  {activeProgress.todayDone ? ' — today is locked in!' : ' — log them all today to keep going'}
                </ThemedText>
                <DayDots progress={activeProgress} tint={colors.tint} muted={colors.icon} />
              </ThemedView>
            </ThemedView>
          )}

          {!activeChallenge && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Start a new challenge</ThemedText>
              {habits.length === 0 ? (
                <ThemedText style={{ color: colors.icon, fontSize: 14 }}>
                  Add a habit on the Today tab, then come back here to challenge yourself.
                </ThemedText>
              ) : (
                <>
                  <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Choose the habits to include</ThemedText>
                  <ThemedView style={{ gap: 8 }}>
                    {pickableHabits.map((habit) => {
                      const selected = selectedIds.includes(habit.id);
                      return (
                        <Pressable
                          key={habit.id}
                          onPress={() => toggleHabit(habit.id)}
                          style={({ pressed }) => [
                            styles.habitOption,
                            { borderColor: selected ? colors.tint : colors.icon },
                            selected && { backgroundColor: colors.tint + '22' },
                            pressed && { opacity: 0.7 },
                          ]}>
                          <ThemedText>
                            {habit.emoji} {habit.name}
                          </ThemedText>
                          <ThemedView
                            style={[
                              styles.checkbox,
                              { borderColor: colors.tint },
                              selected && { backgroundColor: colors.tint },
                            ]}>
                            {selected && (
                              <ThemedText style={{ color: colors.background, fontSize: 14 }}>✓</ThemedText>
                            )}
                          </ThemedView>
                        </Pressable>
                      );
                    })}
                  </ThemedView>

                  <ThemedText style={{ color: colors.icon, fontSize: 13 }}>How long?</ThemedText>
                  <ThemedView style={styles.durationRow}>
                    {DURATION_OPTIONS.map((days) => (
                      <Pressable
                        key={days}
                        onPress={() => setDuration(days)}
                        style={[
                          styles.durationChip,
                          { borderColor: colors.tint },
                          duration === days && { backgroundColor: colors.tint },
                        ]}>
                        <ThemedText
                          style={{
                            color: duration === days ? colors.background : colors.tint,
                            fontWeight: '600',
                          }}>
                          {days}-day
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>

                  <Pressable
                    onPress={handleStart}
                    disabled={selectedIds.length === 0}
                    style={[
                      styles.startButton,
                      { backgroundColor: colors.tint },
                      selectedIds.length === 0 && { opacity: 0.4 },
                    ]}>
                    <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 16 }}>
                      Start {duration}-day challenge
                    </ThemedText>
                  </Pressable>
                </>
              )}
            </ThemedView>
          )}

          {past.length > 0 && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Past challenges</ThemedText>
              <ThemedView style={{ gap: 8 }}>
                {past.map((challenge) => {
                  const challengeHabits = habits.filter((habit) => challenge.habitIds.includes(habit.id));
                  if (challengeHabits.length === 0) return null;
                  const endDateKey = addDays(challenge.startDate, challenge.durationDays - 1);
                  const endDate = formatChallengeDate(endDateKey);
                  return (
                    <ThemedView key={challenge.id} style={[styles.pastRow, { borderColor: colors.icon }]}>
                      <ThemedView style={{ flex: 1, gap: 2 }}>
                        <ThemedText>
                          {challengeHabits.map((h) => h.emoji).join(' ')}{' '}
                          {challengeHabits.map((h) => h.name).join(', ')}
                        </ThemedText>
                        <ThemedText style={{ color: colors.icon, fontSize: 12 }}>
                          {challenge.durationDays}-day · ended {endDate}
                        </ThemedText>
                      </ThemedView>
                      <ThemedText
                        style={{
                          color: challenge.status === 'completed' ? colors.tint : colors.icon,
                          fontWeight: '600',
                          fontSize: 13,
                        }}>
                        {STATUS_LABEL[challenge.status]}
                      </ThemedText>
                    </ThemedView>
                  );
                })}
              </ThemedView>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function formatChallengeDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function DayDots({ progress, tint, muted }: { progress: ChallengeProgress; tint: string; muted: string }) {
  return (
    <ThemedView style={styles.dotRow}>
      {Array.from({ length: progress.totalDays }).map((_, index) => {
        const dayNumber = index + 1;
        const filled = dayNumber <= progress.daysCompleted;
        const isCurrent = dayNumber === progress.daysElapsed && !filled;
        return (
          <ThemedView
            key={index}
            style={[
              styles.dot,
              { borderColor: isCurrent ? tint : muted },
              filled && { backgroundColor: tint, borderColor: tint },
            ]}>
            <ThemedText style={{ fontSize: 12, color: filled ? '#fff' : muted }}>{dayNumber}</ThemedText>
          </ThemedView>
        );
      })}
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
    gap: 24,
  },
  header: {
    gap: 4,
  },
  section: {
    gap: 12,
  },
  activeCard: {
    gap: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  dotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  startButton: {
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 4,
  },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
});
