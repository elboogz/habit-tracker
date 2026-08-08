import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitCalendar } from '@/components/habit-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirmAction } from '@/lib/confirm';
import { averageRecoveryTime, recoveryRate } from '@/lib/domain/recovery';
import { retroactiveEntryWindowStart } from '@/lib/domain/schedule';
import {
  consistency,
  countForDay,
  dayKey,
  longestStreak,
  recentHistory,
  streakForHabit,
  totalCompletions,
} from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import type { Habit, HabitLog } from '@/lib/habit-types';

const HISTORY_DAYS = 28;

/**
 * Recovery Time or Recovery Rate, whichever this habit's own display rules allow -- Recovery Rate
 * (rolling, per docs/phase-3-experience-plan.md §7.2) is preferred when displayable; Recovery Time
 * is the fallback; if neither is available yet, the tile is omitted entirely rather than shown
 * empty. Nothing here recomputes the domain layer's own displayAsPercentage decision.
 */
function recoveryTileContent(
  rate: ReturnType<typeof recoveryRate>,
  avgRecoveryDays: number | null,
): { emoji: string; value: string; label: string } | null {
  if (rate.rolling.displayAsPercentage) {
    return { emoji: '🔁', value: `${Math.round((rate.rolling.rate ?? 0) * 100)}%`, label: 'recovery rate' };
  }
  if (avgRecoveryDays !== null) {
    return { emoji: '🔁', value: avgRecoveryDays.toFixed(1), label: 'avg. days to recover' };
  }
  return null;
}

export default function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state, setLogAmountForDate } = useHabitStore();
  const [correctingDate, setCorrectingDate] = useState<string | null>(null);

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
  const total = totalCompletions(habit.id, state.logs);
  const habitConsistency = Math.round(consistency(habit, state.logs, HISTORY_DAYS) * 100);
  const today = dayKey();
  const rate = recoveryRate(habit, state.schedulePeriods, state.logs, today);
  const avgRecoveryDays = averageRecoveryTime(habit, state.schedulePeriods, state.logs, today);
  const recoveryTile = recoveryTileContent(rate, avgRecoveryDays);
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

          <ThemedView style={[styles.totalCard, { borderColor: colors.icon }]}>
            <ThemedText style={styles.totalEmoji}>✅</ThemedText>
            <ThemedText type="title" style={{ fontSize: 40 }}>
              {total}
            </ThemedText>
            <ThemedText style={{ color: colors.icon, fontSize: 14 }}>total completions</ThemedText>
          </ThemedView>

          <ThemedView style={styles.statsRow}>
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>🔥</ThemedText>
              <ThemedText type="title" style={{ fontSize: 22 }}>
                Current: {streak} · Best: {best}
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>streak</ThemedText>
            </ThemedView>
            {recoveryTile && (
              <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
                <ThemedText style={styles.statEmoji}>{recoveryTile.emoji}</ThemedText>
                <ThemedText type="title" style={{ fontSize: 28 }}>
                  {recoveryTile.value}
                </ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>{recoveryTile.label}</ThemedText>
              </ThemedView>
            )}
            <ThemedView style={[styles.statCard, { borderColor: colors.icon }]}>
              <ThemedText style={styles.statEmoji}>📈</ThemedText>
              <ThemedText type="title" style={{ fontSize: 28 }}>
                {habitConsistency}%
              </ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>last {HISTORY_DAYS} days</ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Last {HISTORY_DAYS} days</ThemedText>
            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              Tap any of the last 6 days (dashed border) to add or correct a completion.
            </ThemedText>
            <HabitCalendar
              history={history}
              fillColor={colors.tint}
              emptyColor={colors.icon}
              textColor={colors.text}
              minEditableDate={retroactiveEntryWindowStart(habit, today)}
              onDayPress={(date) => setCorrectingDate((current) => (current === date ? null : date))}
            />
            {correctingDate && (
              <DayCorrectionPanel
                habit={habit}
                date={correctingDate}
                logs={state.logs}
                onSetAmount={(amount) => setLogAmountForDate(habit.id, correctingDate, amount)}
                onClose={() => setCorrectingDate(null)}
              />
            )}
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

/**
 * Inline retroactive-entry panel (docs/phase-4-plan.md section 7.1) -- not a new screen. Adds or
 * corrects a single day's total logged count via setLogAmountForDate, which never sets `reduced`
 * (section 7.3 -- retroactive editing corrects a count, it does not invent a "smaller version").
 * Zeroing out an existing completion is confirmed via the same generic confirmAction pattern used
 * elsewhere in the app (section 7.4); every other change (adding, or correcting to a different
 * nonzero count) needs no confirmation.
 */
function DayCorrectionPanel({
  habit,
  date,
  logs,
  onSetAmount,
  onClose,
}: {
  habit: Habit;
  date: string;
  logs: HabitLog[];
  onSetAmount: (amount: number) => void;
  onClose: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const currentCount = countForDay(logs, habit.id, date);

  function requestSetAmount(amount: number) {
    if (amount === 0 && currentCount > 0) {
      confirmAction(
        'Remove this completion?',
        `This removes your logged completion for ${formatLogDate(date)}.`,
        'Remove',
        () => onSetAmount(0),
      );
      return;
    }
    onSetAmount(amount);
  }

  if (habit.type === 'simple') {
    const done = currentCount > 0;
    return (
      <ThemedView style={[styles.correctionPanel, { borderColor: colors.tint }]}>
        <ThemedText type="defaultSemiBold">{formatLogDate(date)}</ThemedText>
        <Pressable
          onPress={() => {
            requestSetAmount(done ? 0 : 1);
            if (done) return; // wait for confirmAction before closing
            onClose();
          }}
          style={({ pressed }) => [
            styles.correctionToggle,
            { borderColor: colors.tint },
            done && { backgroundColor: colors.tint },
            pressed && { opacity: 0.7 },
          ]}>
          <ThemedText style={{ color: done ? colors.background : colors.text, fontWeight: '600' }}>
            {done ? 'Mark not done' : 'Mark done'}
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.correctionPanel, { borderColor: colors.tint }]}>
      <ThemedText type="defaultSemiBold">{formatLogDate(date)}</ThemedText>
      <ThemedView style={styles.countStepperRow}>
        <Pressable
          onPress={() => requestSetAmount(Math.max(0, currentCount - 1))}
          disabled={currentCount === 0}
          style={({ pressed }) => [
            styles.stepperButton,
            { borderColor: colors.icon },
            currentCount === 0 && { opacity: 0.3 },
            pressed && { opacity: 0.7 },
          ]}>
          <ThemedText style={{ fontSize: 18 }}>−</ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={{ minWidth: 60, textAlign: 'center' }}>
          {currentCount}/{habit.targetCount}
        </ThemedText>
        <Pressable
          onPress={() => requestSetAmount(currentCount + 1)}
          style={({ pressed }) => [styles.stepperButton, { borderColor: colors.icon }, pressed && { opacity: 0.7 }]}>
          <ThemedText style={{ fontSize: 18 }}>+</ThemedText>
        </Pressable>
      </ThemedView>
      <Pressable onPress={onClose} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
        <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>Done</ThemedText>
      </Pressable>
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
  totalCard: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  totalEmoji: {
    fontSize: 24,
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
  correctionPanel: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  correctionToggle: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  countStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
