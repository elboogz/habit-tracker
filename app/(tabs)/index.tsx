import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/celebration-overlay';
import { RecoveryCard } from '@/components/recovery-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isRecoveryEvent, lapseReasonSuppressionUntil, openLapse } from '@/lib/domain/recovery';
import { isScheduledOpportunity, nextScheduledOpportunityAfter } from '@/lib/domain/schedule';
import {
  challengeProgress,
  countForDay,
  dayKey,
  isDoneOnDay,
  isDoneToday,
  reducedTargetFor,
  totalCompletions,
} from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import type { Habit, HabitSchedulePeriod, LapseReasonEntry, LapseReasonKey } from '@/lib/habit-types';
import { useRecoveryCardDismissals, type RecoveryCardDismissals } from '@/lib/recovery-card-dismissals';
import { useCelebration } from '@/lib/use-celebration';

const ROUTINE_MESSAGES = ['Nice work! 🎉', "You're on a roll!", 'Keep it up! 💪', 'Consistency wins.'];

// Reference copy from docs/phase-3-experience-plan.md §6.2 -- reused verbatim, not reinvented.
// Reserved for the moment a Scheduled Opportunity is completed immediately after a miss: a
// stronger celebration than any routine completion, per the approved plan's emotional hierarchy.
const RECOVERY_MESSAGES = (total: number) => [
  'That is a recovery. Coming back is the skill that builds lasting habits.',
  'You returned after a missed day. That matters more than maintaining a perfect record.',
  `Back on track. Your ${total} total completions are still yours.`,
];

// Phase 4 (docs/phase-4-plan.md section 3.6) -- copy-only variant of RECOVERY_MESSAGES for a
// reduced ("smaller version") completion that resolves a Recovery Event: acknowledges the
// smaller scope without ever framing it as lesser. Same big:true celebration strength as a full
// recovery, since resolving the lapse is what matters, not the size of the completion.
const REDUCED_RECOVERY_MESSAGES = (total: number) => [
  'A smaller version still counts. Your progress is still moving.',
  'Showing up in a smaller way is still showing up.',
  `That still counts. Your ${total} total completions are still yours.`,
];

// Every 25 completions is a quiet milestone -- routine celebration strength (never big: true,
// which is reserved for recovery per §6.2), a small acknowledgment rather than a badge or level.
const MILESTONE_STEP = 25;

function milestoneMessage(total: number): string | null {
  if (total <= 0 || total % MILESTONE_STEP !== 0) return null;
  return `${total} completions. That's real, lasting progress.`;
}

function formatTodayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * The later of the two independently-computed suppression sources (docs/phase-4-plan.md section
 * 3.4): lapseReasonSuppressionUntil (synced, covers Skip/Reflect) and the local-only dismissal
 * record (covers Continue today/dismiss). Null means "not suppressed at all", not "suppressed
 * until the epoch" -- absence from either source is the common case.
 */
function recoveryCardSuppressedUntil(
  habit: Habit,
  schedulePeriods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  openLapseStart: string,
  today: string,
  localDismissals: RecoveryCardDismissals,
): string | null {
  const fromLapseReason = lapseReasonSuppressionUntil(habit, schedulePeriods, lapseReasons, openLapseStart, today);
  const fromLocal = localDismissals[habit.id] ?? null;
  const candidates = [fromLapseReason, fromLocal].filter((d): d is string => d !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b > a ? b : a));
}

export default function TodayScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state, logHabit, unlogHabit, setChallengeStatus, addLapseReason, logReducedCompletion, pauseHabit } =
    useHabitStore();
  const { celebration, fire, clear } = useCelebration(state.soundEnabled);
  const { dismissals, dismiss } = useRecoveryCardDismissals();

  const today = dayKey();
  const { habits, logs, challenges, schedulePeriods, lapseReasons } = state;
  const activeChallenges = challenges.filter((challenge) => challenge.status === 'active');

  // Challenge-failure detection used to live here as a screen-level effect (only evaluated while
  // Today happened to be mounted); it now lives in HabitStoreProvider itself (see
  // lib/habit-store.tsx) so it runs regardless of which screen is open. Semantics unchanged --
  // see docs/phase-2-implementation-plan.md section 7.

  const completedCount = habits.filter((habit) => isDoneToday(habit, logs)).length;

  // Phase 4 recovery card eligibility (docs/phase-4-plan.md section 3.1): an open, actionable lapse
  // that today can still do something about, not already suppressed by a prior card action.
  const eligibleHabits = habits.filter((habit) => {
    const lapse = openLapse(habit, schedulePeriods, logs, today);
    if (!lapse) return false;
    if (!isScheduledOpportunity(schedulePeriods, habit, today)) return false;
    const suppressedUntil = recoveryCardSuppressedUntil(
      habit,
      schedulePeriods,
      lapseReasons,
      lapse.firstMissedDate,
      today,
      dismissals,
    );
    return suppressedUntil === null || today >= suppressedUntil;
  });

  function handleRecoveryContinue(habit: Habit) {
    dismiss(habit.id, nextScheduledOpportunityAfter(schedulePeriods, habit, today));
  }

  function handleRecoverySkip(habit: Habit) {
    addLapseReason({ habitId: habit.id, missedOpportunityDate: today, reason: null, skipped: true });
  }

  function handleRecoverySmallerVersion(habit: Habit) {
    const target = reducedTargetFor(habit);
    if (target === null) return; // the card only renders this option when non-null

    logReducedCompletion(habit.id);

    const syntheticLog = { id: 'pending', habitId: habit.id, date: today, count: target, reduced: true, loggedAt: '', updatedAt: '' };
    const nextLogs = [...logs, syntheticLog];
    const total = totalCompletions(habit.id, nextLogs);

    if (isRecoveryEvent(habit, schedulePeriods, nextLogs, today, today)) {
      const messages = REDUCED_RECOVERY_MESSAGES(total);
      fire(habit.emoji, messages[total % messages.length], true);
      return;
    }
    fire(habit.emoji, 'A smaller version still counts.');
  }

  function handleRecoveryAdjustSchedule(habit: Habit) {
    router.push({ pathname: '/habit-form', params: { id: habit.id } });
  }

  function handleRecoveryPause(habit: Habit) {
    // Appends a new paused period effective today -- no confirmation, pausing is trivially
    // reversible (docs/phase-4-plan.md section 3.5). This alone removes the habit from
    // eligibleHabits on the next render, since today stops being a Scheduled Opportunity; no
    // separate local dismissal is needed.
    pauseHabit(habit.id);
  }

  function handleReflectChoice(habit: Habit, reason: LapseReasonKey, note?: string) {
    // Reflect engages with the lapse as a whole, so it's keyed to the lapse's own origin date --
    // unlike the card-level Skip, which is about today's specific opportunity (docs/phase-4-plan.md
    // section 4.1).
    const lapse = openLapse(habit, schedulePeriods, logs, today);
    addLapseReason({
      habitId: habit.id,
      missedOpportunityDate: lapse?.firstMissedDate ?? today,
      reason,
      note,
      skipped: false,
    });
  }

  function handleReflectSkip(habit: Habit) {
    const lapse = openLapse(habit, schedulePeriods, logs, today);
    addLapseReason({
      habitId: habit.id,
      missedOpportunityDate: lapse?.firstMissedDate ?? today,
      reason: null,
      skipped: true,
    });
  }

  function handleRecoveryDismissAll() {
    for (const habit of eligibleHabits) {
      dismiss(habit.id, nextScheduledOpportunityAfter(schedulePeriods, habit, today));
    }
  }

  function handleLog(habit: Habit) {
    const wasDoneToday = isDoneToday(habit, logs);
    if (habit.type === 'simple' && wasDoneToday) return;

    logHabit(habit.id, 1);

    const syntheticLog = { id: 'pending', habitId: habit.id, date: today, count: 1, loggedAt: '', updatedAt: '' };
    const nextLogs = [...logs, syntheticLog];
    const nowDone = isDoneOnDay(habit, nextLogs, today);

    if (!nowDone) {
      const count = countForDay(nextLogs, habit.id, today);
      fire(habit.emoji, `${count} of ${habit.targetCount} today, keep going!`);
      return;
    }

    if (wasDoneToday) {
      fire(habit.emoji, 'Bonus rep, nice!');
      return;
    }

    const wasAllDoneBefore = habits.every((h) => isDoneOnDay(h, logs, today));
    const allDoneNow = habits.every((h) => isDoneOnDay(h, nextLogs, today));
    const justCompletedAllHabits = habits.length > 1 && allDoneNow && !wasAllDoneBefore;

    const habitChallenge = challenges.find((c) => c.status === 'active' && c.habitIds.includes(habit.id));
    if (habitChallenge) {
      const progress = challengeProgress(habitChallenge, habits, nextLogs, schedulePeriods);
      if (progress.isComplete) {
        setChallengeStatus(habitChallenge.id, 'completed');
        fire('🏆', 'Challenge complete! 🎉', true);
        return;
      }
      if (progress.todayDone) {
        if (justCompletedAllHabits) {
          fire('🎉', "All habits done for today, you're crushing it!", true);
        } else {
          fire('🚩', `Day ${progress.daysElapsed} of ${progress.totalDays}, challenge on track!`);
        }
        return;
      }
      const remaining = progress.habits.filter((h) => !isDoneOnDay(h, nextLogs, today)).length;
      fire(habit.emoji, `${remaining} more habit${remaining === 1 ? '' : 's'} to go for today's challenge`);
      return;
    }

    if (justCompletedAllHabits) {
      fire('🎉', "All habits done for today, you're crushing it!", true);
      return;
    }

    const total = totalCompletions(habit.id, nextLogs);

    // A Recovery Event -- today's completion immediately follows a missed Scheduled Opportunity
    // -- gets a stronger celebration than a routine one, independent of any streak or Momentum
    // State timing (see docs/phase-3-experience-plan.md §6.2). This check is evaluated fresh from
    // the domain layer; nothing about "recovery" is computed here.
    if (isRecoveryEvent(habit, schedulePeriods, nextLogs, today, today)) {
      const recoveryMessages = RECOVERY_MESSAGES(total);
      fire(habit.emoji, recoveryMessages[total % recoveryMessages.length], true);
      return;
    }

    const milestone = milestoneMessage(total);
    if (milestone) {
      fire(habit.emoji, milestone);
      return;
    }

    fire(habit.emoji, ROUTINE_MESSAGES[total % ROUTINE_MESSAGES.length]);
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

          <RecoveryCard
            eligibleHabits={eligibleHabits}
            onContinue={handleRecoveryContinue}
            onSmallerVersion={handleRecoverySmallerVersion}
            onSkip={handleRecoverySkip}
            onPause={handleRecoveryPause}
            onAdjustSchedule={handleRecoveryAdjustSchedule}
            onReflectChoice={handleReflectChoice}
            onReflectSkip={handleReflectSkip}
            onDismissAll={handleRecoveryDismissAll}
          />

          {activeChallenges.length > 0 && (
            <ThemedView style={{ gap: 8 }}>
              {activeChallenges.map((challenge) => {
                const progress = challengeProgress(challenge, habits, logs, schedulePeriods);
                if (progress.habits.length === 0) return null;
                return (
                  <Pressable key={challenge.id} onPress={() => router.push('/(tabs)/challenges')}>
                    <ThemedView style={[styles.challengeBanner, { borderColor: colors.tint }]}>
                      <ThemedText type="defaultSemiBold">
                        🚩 Day {progress.daysElapsed} of {progress.totalDays} challenge
                      </ThemedText>
                      <ThemedText style={{ color: colors.icon, fontSize: 14 }}>
                        {progress.habits.map((h) => h.emoji).join(' ')}{' '}
                        {progress.habits.length === 1 ? progress.habits[0].name : `${progress.habits.length} habits`}
                        , {progress.todayDone ? "today's set is locked in" : 'log them all today to keep your run alive'}
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
                      {habit.reminderTimes?.length ? (
                        <ThemedText style={{ color: colors.icon, fontSize: 14 }}>🔔</ThemedText>
                      ) : null}
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
