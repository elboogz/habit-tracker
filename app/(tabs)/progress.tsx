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
import { confirmedStateAt, type MomentumStateKey } from '@/lib/domain/momentum';
import { averageRecoveryTime, recoveryEvents, recoveryRate, type RecoveryRateResult } from '@/lib/domain/recovery';
import { consistency, dayKey, recentHistory, totalCompletions } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import type { Habit, HabitLog, HabitSchedulePeriod } from '@/lib/habit-types';

type ViewMode = '14days' | '7days';

const DAYS_BY_MODE: Record<ViewMode, number> = { '14days': 14, '7days': 7 };
type ReflectionMode = 'weekly' | 'monthly';

// Momentum State labels — approved product decision, docs/phase-3-experience-plan.md §7.1. Every
// label describes a stretch of time, never the person; `quiet` gets the gentlest treatment since
// it's shown mid-lapse. This is presentation copy over an already-computed domain enum, not a new
// behavioural calculation.
const MOMENTUM_COPY: Record<MomentumStateKey, { badge: string; narrative: string }> = {
  insufficient_data: {
    badge: 'Getting started',
    narrative: 'Still gathering enough days to show a pattern.',
  },
  building: {
    badge: 'Building momentum',
    narrative: "You're building a pattern that's starting to stick.",
  },
  steady: {
    badge: 'Steady',
    narrative: "You're showing up for this one consistently.",
  },
  thriving: {
    badge: 'Thriving',
    narrative: 'This habit is running strong right now.',
  },
  recovering: {
    badge: 'Recovering',
    narrative: "You're finding your way back. That's the part that counts.",
  },
  rebuilding: {
    badge: 'Rebuilding',
    narrative: "You stepped away from this and you're building it back.",
  },
  quiet: {
    badge: 'Quiet stretch',
    narrative: 'Things have been quiet here lately. Today is a good day to return.',
  },
};

/** Never a bare, possibly-shaming number — mirrors the domain layer's own displayAsPercentage rule rather than reimplementing it. */
function recoveryRateText(result: RecoveryRateResult): string {
  if (result.resolvedCount === 0) return 'Not enough recovery history yet';
  if (!result.displayAsPercentage) return 'Recovery history still building';
  return `${Math.round((result.rate ?? 0) * 100)}%`;
}

/** Null when the window contains no Scheduled Opportunities -- distinct from 0%, see consistency()'s doc comment. */
function consistencyText(habit: Habit, logs: HabitLog[], days: number, schedulePeriods: HabitSchedulePeriod[]): string | null {
  const value = consistency(habit, logs, days, schedulePeriods);
  return value === null ? null : `${Math.round(value * 100)}%`;
}

/** Averages only habits with a defined Consistency in the window; null if none have one. */
function averageConsistencyPct(
  habits: Habit[],
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  days: number,
): number | null {
  const values = habits
    .map((habit) => consistency(habit, logs, days, schedulePeriods))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100);
}

function HabitSnapshot({
  habit,
  logs,
  schedulePeriods,
  today,
  colors,
}: {
  habit: Habit;
  logs: HabitLog[];
  schedulePeriods: HabitSchedulePeriod[];
  today: string;
  colors: (typeof Colors)['light'];
}) {
  const momentumState = confirmedStateAt(habit, schedulePeriods, logs, today);
  const copy = MOMENTUM_COPY[momentumState];
  const total = totalCompletions(habit.id, logs);
  const rate = recoveryRate(habit, schedulePeriods, logs, today);
  const recoveryCount = recoveryEvents(habit, schedulePeriods, logs, today).length;
  const avgRecoveryDays = averageRecoveryTime(habit, schedulePeriods, logs, today);

  return (
    <ThemedView style={{ gap: 6 }}>
      <ThemedView style={styles.momentumRow}>
        <ThemedView style={[styles.momentumBadge, { borderColor: colors.tint }]}>
          <ThemedText style={{ color: colors.tint, fontSize: 13, fontWeight: '700' }}>{copy.badge}</ThemedText>
        </ThemedView>
      </ThemedView>
      <ThemedText style={{ color: colors.icon, fontSize: 14, lineHeight: 19 }}>{copy.narrative}</ThemedText>

      <ThemedText style={{ fontSize: 13 }}>
        <ThemedText type="defaultSemiBold" style={{ fontSize: 13 }}>
          {total}
        </ThemedText>{' '}
        total completions
      </ThemedText>

      <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
        Recovery rate: {recoveryRateText(rate.rolling)}
        {recoveryCount > 0 ? ` · ${recoveryCount} recover${recoveryCount === 1 ? 'y' : 'ies'}` : ''}
      </ThemedText>
      {avgRecoveryDays !== null && (
        <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
          Averages {avgRecoveryDays.toFixed(1)} day{avgRecoveryDays === 1 ? '' : 's'} to bounce back
        </ThemedText>
      )}
    </ThemedView>
  );
}

export default function ProgressScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state } = useHabitStore();
  const { habits, logs, schedulePeriods } = state;
  const today = dayKey();
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

  // Aggregate summary across every habit. Momentum State and Recovery Rate are per-habit concepts
  // in the domain layer (lib/domain/momentum.ts, lib/domain/recovery.ts) with no cross-habit
  // aggregate function — inventing one here (e.g. "worst state wins") would be a new behavioural
  // rule, which this phase must not add. Total Completions and Consistency are safe to sum/average
  // because they're plain arithmetic over already-computed per-habit domain outputs, matching this
  // screen's pre-existing overallConsistency precedent. Momentum/Recovery are shown per habit below.
  const aggregateTotalCompletions = habits.reduce((sum, habit) => sum + totalCompletions(habit.id, logs), 0);
  const aggregateWeeklyConsistency = averageConsistencyPct(habits, logs, schedulePeriods, 7);
  const aggregateMonthlyConsistency = averageConsistencyPct(habits, logs, schedulePeriods, 30);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Progress</ThemedText>
            {!hasHabits && (
              <ThemedText style={{ color: colors.icon }}>Your progress story starts once you log a habit</ThemedText>
            )}
          </ThemedView>

          {hasHabits && (
            <ThemedView style={{ gap: 4 }}>
              <ThemedText type="defaultSemiBold" style={{ fontSize: 15 }}>
                {aggregateTotalCompletions} completions logged so far
              </ThemedText>
              {(aggregateWeeklyConsistency !== null || aggregateMonthlyConsistency !== null) && (
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  {aggregateWeeklyConsistency !== null && `${aggregateWeeklyConsistency}% consistent this week`}
                  {aggregateWeeklyConsistency !== null && aggregateMonthlyConsistency !== null && ' · '}
                  {aggregateMonthlyConsistency !== null && `${aggregateMonthlyConsistency}% over the last 30 days`}
                </ThemedText>
              )}
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                See each habit below for its own momentum and recovery.
              </ThemedText>
            </ThemedView>
          )}

          {hasHabits && (
            <ThemedView style={[styles.coachCard, { borderColor: colors.tint }]}>
              <ThemedView style={styles.coachHeader}>
                <ThemedText type="defaultSemiBold">🧠 Coach</ThemedText>
              </ThemedView>

              <ThemedText style={{ color: colors.icon, fontSize: 12, fontWeight: '600' }}>💡 Today&apos;s tip</ThemedText>
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
                    📅 This week
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
                    🗓️ This month
                  </ThemedText>
                </Pressable>
              </ThemedView>

              <ThemedText style={{ color: colors.icon, fontSize: 12, fontWeight: '600' }}>
                {reflectionMode === 'weekly' ? '📅 Weekly reflection' : '🗓️ Monthly reflection'}
              </ThemedText>
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
            </ThemedView>
          )}

          <ThemedView style={styles.list}>
            {habits.map((habit) => {
              const history = recentHistory(habit, logs, days);
              const habitConsistencyText = consistencyText(habit, logs, days, schedulePeriods);

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
                    <ThemedText type="defaultSemiBold" style={{ flex: 1 }}>
                      {habit.emoji} {habit.name}
                    </ThemedText>
                    <IconSymbol name="chevron.right" size={18} color={colors.icon} />
                  </ThemedView>

                  <HabitSnapshot habit={habit} logs={logs} schedulePeriods={schedulePeriods} today={today} colors={colors} />

                  <HabitHeatmap history={history} fillColor={colors.tint} emptyColor={colors.icon} />
                  {habitConsistencyText !== null && (
                    <ThemedText style={{ color: colors.icon, fontSize: 12 }}>
                      {habitConsistencyText} over the last {days} days
                    </ThemedText>
                  )}
                </Pressable>
              );
            })}
          </ThemedView>

          {habits.length === 0 && (
            <ThemedView style={[styles.emptyState, { borderColor: colors.icon }]}>
              <ThemedText style={{ fontSize: 32 }}>📊</ThemedText>
              <ThemedText type="defaultSemiBold">No data yet</ThemedText>
              <ThemedText style={{ color: colors.icon, textAlign: 'center' }}>
                Once you start logging on the Today tab, you&apos;ll see how you&apos;re really doing here, not just
                whether you kept a streak, but how you come back after a day off.
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
  momentumRow: {
    flexDirection: 'row',
  },
  momentumBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    alignSelf: 'flex-start',
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
