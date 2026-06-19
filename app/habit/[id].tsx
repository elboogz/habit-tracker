import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitCalendar } from '@/components/habit-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { consistency, longestStreak, recentHistory, streakForHabit } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';

const HISTORY_DAYS = 28;

export default function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state } = useHabitStore();

  const habit = state.habits.find((candidate) => candidate.id === id);

  if (!habit) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Habit' }} />
        <SafeAreaView style={styles.centered}>
          <ThemedText>This habit no longer exists.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const streak = streakForHabit(habit, state.logs);
  const best = longestStreak(habit, state.logs);
  const history = recentHistory(habit, state.logs, HISTORY_DAYS);
  const totalCompletions = state.logs.filter((log) => log.habitId === habit.id).length;
  const habitConsistency = Math.round(consistency(habit, state.logs, HISTORY_DAYS) * 100);
  const recentLogs = state.logs
    .filter((log) => log.habitId === habit.id)
    .slice(-10)
    .reverse();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `${habit.emoji} ${habit.name}` }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Habit History</ThemedText>
            <ThemedText style={{ color: colors.icon }}>
              {habit.emoji} {habit.name}
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.statsRow}>
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>🔥</ThemedText>
              <ThemedText type="title" style={{ fontSize: 28 }}>
                {streak}
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>day streak</ThemedText>
            </ThemedView>
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>🏆</ThemedText>
              <ThemedText type="title" style={{ fontSize: 28 }}>
                {best}
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>best streak</ThemedText>
            </ThemedView>
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>📈</ThemedText>
              <ThemedText type="title" style={{ fontSize: 28 }}>
                {habitConsistency}%
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>last {HISTORY_DAYS} days</ThemedText>
            </ThemedView>
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>✅</ThemedText>
              <ThemedText type="title" style={{ fontSize: 28 }}>
                {totalCompletions}
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>total logs</ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Last {HISTORY_DAYS} days</ThemedText>
            <HabitCalendar history={history} fillColor={colors.tint} emptyColor={colors.icon} textColor={colors.text} />
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Recent activity</ThemedText>
            {recentLogs.length === 0 ? (
              <ThemedText style={{ color: colors.icon }}>Nothing logged yet — get started on the Today tab.</ThemedText>
            ) : (
              <ThemedView style={{ gap: 8 }}>
                {recentLogs.map((log) => (
                  <ThemedView key={log.id} style={[styles.logRow, { borderColor: colors.icon }]}>
                    <ThemedText>{formatLogDate(log.date)}</ThemedText>
                    <ThemedText style={{ color: colors.icon }}>
                      {habit.type === 'count' ? `${habit.emoji} +${log.count}` : '✅ Completed'}
                    </ThemedText>
                  </ThemedView>
                ))}
              </ThemedView>
            )}
          </ThemedView>

          <Pressable
            onPress={() => router.push({ pathname: '/habit-form', params: { id: habit.id } })}
            style={({ pressed }) => [styles.editButton, { borderColor: colors.tint }, pressed && { opacity: 0.7 }]}>
            <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>Edit habit</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function formatLogDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isToday) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: 24,
    gap: 24,
  },
  header: {
    gap: 4,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  statEmoji: {
    fontSize: 20,
  },
  section: {
    gap: 12,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  editButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
});
