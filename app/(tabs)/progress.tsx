import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitHeatmap } from '@/components/habit-heatmap';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInsight, type Insight, type InsightKind } from '@/lib/ai-coach';
import { consistency, longestStreak, recentHistory, streakForHabit } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';

type ViewMode = '14days' | '7days';

const DAYS_BY_MODE: Record<ViewMode, number> = { '14days': 14, '7days': 7 };
type ReflectionMode = 'weekly' | 'monthly';

export default function ProgressScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state } = useHabitStore();
  const { habits, logs } = state;
  const [viewMode, setViewMode] = useState<ViewMode>('14days');
  const days = DAYS_BY_MODE[viewMode];

  const hasHabits = habits.length > 0;
  const [nudge, setNudge] = useState<Insight | null>(null);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [reflectionMode, setReflectionMode] = useState<ReflectionMode>('weekly');
  const [reflection, setReflection] = useState<Insight | null>(null);
  const [reflectionLoading, setReflectionLoading] = useState(false);

  useEffect(() => {
    if (!hasHabits) return;
    let cancelled = false;
    setNudgeLoading(true);
    getInsight('nudge').then((result) => {
      if (!cancelled) {
        setNudge(result);
        setNudgeLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch once per mount — the Edge Function's own freshness cache decides whether
    // that means an instant cache hit or a fresh generation.
  }, [hasHabits]);

  useEffect(() => {
    if (!hasHabits) return;
    let cancelled = false;
    setReflectionLoading(true);
    setReflection(null);
    getInsight(reflectionMode as InsightKind).then((result) => {
      if (!cancelled) {
        setReflection(result);
        setReflectionLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasHabits, reflectionMode]);

  const overallConsistency =
    habits.length === 0
      ? 0
      : Math.round((habits.reduce((sum, habit) => sum + consistency(habit, logs, days), 0) / habits.length) * 100);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Progress</ThemedText>
            <ThemedText style={{ color: colors.icon }}>
              {habits.length === 0
                ? 'Your consistency story starts once you log a habit'
                : `${overallConsistency}% consistent over the last ${days} days`}
            </ThemedText>
          </ThemedView>

          {hasHabits && (
            <ThemedView style={[styles.coachCard, { borderColor: colors.tint }]}>
              <ThemedView style={styles.coachHeader}>
                <ThemedText type="defaultSemiBold">🧠 Coach</ThemedText>
              </ThemedView>

              {nudgeLoading ? (
                <ThemedView style={styles.coachLoading}>
                  <ActivityIndicator color={colors.tint} />
                  <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Thinking about your habits...</ThemedText>
                </ThemedView>
              ) : (
                <ThemedText style={{ fontSize: 14, lineHeight: 20 }}>{nudge?.content ?? 'No tip yet.'}</ThemedText>
              )}

              <ThemedView style={[styles.coachDivider, { borderColor: colors.icon }]} />

              <ThemedView style={styles.segmented}>
                <Pressable
                  onPress={() => setReflectionMode('weekly')}
                  style={[
                    styles.segment,
                    { borderColor: colors.icon },
                    reflectionMode === 'weekly' && { backgroundColor: colors.tint, borderColor: colors.tint },
                  ]}>
                  <ThemedText style={{ color: reflectionMode === 'weekly' ? colors.background : colors.text, fontSize: 13 }}>
                    This week
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setReflectionMode('monthly')}
                  style={[
                    styles.segment,
                    { borderColor: colors.icon },
                    reflectionMode === 'monthly' && { backgroundColor: colors.tint, borderColor: colors.tint },
                  ]}>
                  <ThemedText style={{ color: reflectionMode === 'monthly' ? colors.background : colors.text, fontSize: 13 }}>
                    This month
                  </ThemedText>
                </Pressable>
              </ThemedView>

              {reflectionLoading ? (
                <ThemedView style={styles.coachLoading}>
                  <ActivityIndicator color={colors.tint} />
                  <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Putting together your reflection...</ThemedText>
                </ThemedView>
              ) : (
                <ThemedText style={{ fontSize: 14, lineHeight: 20 }}>{reflection?.content ?? 'No reflection yet.'}</ThemedText>
              )}
            </ThemedView>
          )}

          {habits.length > 0 && (
            <ThemedView style={styles.segmented}>
              <Pressable
                onPress={() => setViewMode('14days')}
                style={[
                  styles.segment,
                  { borderColor: colors.icon },
                  viewMode === '14days' && { backgroundColor: colors.tint, borderColor: colors.tint },
                ]}>
                <ThemedText style={{ color: viewMode === '14days' ? colors.background : colors.text }}>
                  Last 14 days
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setViewMode('7days')}
                style={[
                  styles.segment,
                  { borderColor: colors.icon },
                  viewMode === '7days' && { backgroundColor: colors.tint, borderColor: colors.tint },
                ]}>
                <ThemedText style={{ color: viewMode === '7days' ? colors.background : colors.text }}>
                  Last 7 days
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          <ThemedView style={styles.list}>
            {habits.map((habit) => {
              const streak = streakForHabit(habit, logs);
              const best = longestStreak(habit, logs);
              const history = recentHistory(habit, logs, days);
              const habitConsistency = Math.round(consistency(habit, logs, days) * 100);

              return (
                <Pressable
                  key={habit.id}
                  onPress={() => router.push(`/habit/${habit.id}`)}
                  style={({ pressed }) => [
                    styles.card,
                    { borderColor: colors.icon },
                    pressed && { opacity: 0.7 },
                  ]}>
                  <ThemedView style={styles.cardHeader}>
                    <ThemedView style={{ gap: 2, flex: 1 }}>
                      <ThemedText type="defaultSemiBold">
                        {habit.emoji} {habit.name}
                      </ThemedText>
                      <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                        🔥 {streak} day streak · 🏆 best {best}
                      </ThemedText>
                    </ThemedView>
                    <IconSymbol name="chevron.right" size={18} color={colors.icon} />
                  </ThemedView>

                  <HabitHeatmap history={history} fillColor={colors.tint} emptyColor={colors.icon} />
                  <ThemedText style={{ color: colors.icon, fontSize: 12 }}>
                    {habitConsistency}% consistent over the last {days} days
                  </ThemedText>
                </Pressable>
              );
            })}
          </ThemedView>

          {habits.length === 0 && (
            <ThemedView style={[styles.emptyState, { borderColor: colors.icon }]}>
              <ThemedText style={{ fontSize: 32 }}>📊</ThemedText>
              <ThemedText type="defaultSemiBold">No data yet</ThemedText>
              <ThemedText style={{ color: colors.icon, textAlign: 'center' }}>
                Streaks, consistency percentages, and history charts will show up here as you track habits on the
                Today tab.
              </ThemedText>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
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
    gap: 20,
  },
  header: {
    gap: 4,
  },
  coachCard: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coachLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coachDivider: {
    borderBottomWidth: 1,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  list: {
    gap: 12,
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    padding: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
