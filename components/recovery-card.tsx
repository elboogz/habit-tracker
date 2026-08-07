import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reducedTargetFor } from '@/lib/habit-stats';
import type { Habit } from '@/lib/habit-types';

/**
 * Gentle, dismissible card offering the Phase 4 recovery flow's options for habits with a
 * currently open, actionable lapse (docs/phase-4-plan.md section 3). Never a blocking modal, never
 * a permanent banner -- the parent screen decides eligibility (openLapse + isScheduledOpportunity +
 * suppression) and passes down only the habits currently eligible to show here.
 *
 * "Adjust the schedule", "Pause this habit", and "Reflect" render as visible-but-disabled rows and
 * come alive in the three commits that follow, per the approved commit sequence.
 */
export function RecoveryCard({
  eligibleHabits,
  onContinue,
  onSmallerVersion,
  onSkip,
  onPause,
  onDismissAll,
}: {
  eligibleHabits: Habit[];
  onContinue: (habit: Habit) => void;
  onSmallerVersion: (habit: Habit) => void;
  onSkip: (habit: Habit) => void;
  onPause: (habit: Habit) => void;
  onDismissAll: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [expanded, setExpanded] = useState(false);
  const [openHabitId, setOpenHabitId] = useState<string | null>(null);

  if (eligibleHabits.length === 0) return null;

  const summary =
    eligibleHabits.length === 1
      ? `${eligibleHabits[0].name} is ready for a fresh start`
      : `${eligibleHabits.length} habits are ready for a fresh start`;

  return (
    <ThemedView style={[styles.card, { borderColor: colors.tint }]}>
      <Pressable style={styles.header} onPress={() => setExpanded((current) => !current)}>
        <ThemedView style={styles.headerText}>
          <ThemedText type="defaultSemiBold">🔁 {summary}</ThemedText>
          {!expanded && (
            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Tap to see your options</ThemedText>
          )}
        </ThemedView>
        <Pressable
          hitSlop={10}
          onPress={() => {
            setExpanded(false);
            setOpenHabitId(null);
            onDismissAll();
          }}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}>
          <ThemedText style={{ color: colors.icon, fontSize: 16 }}>✕</ThemedText>
        </Pressable>
      </Pressable>

      {expanded && (
        <ThemedView style={styles.list}>
          {eligibleHabits.map((habit) => (
            <ThemedView key={habit.id} style={[styles.habitBlock, { borderColor: colors.icon + '33' }]}>
              <Pressable
                style={styles.habitRow}
                onPress={() => setOpenHabitId((current) => (current === habit.id ? null : habit.id))}>
                <ThemedText type="defaultSemiBold">
                  {habit.emoji} {habit.name}
                </ThemedText>
              </Pressable>

              {openHabitId === habit.id && (
                <ThemedView style={styles.options}>
                  <Pressable
                    onPress={() => {
                      onContinue(habit);
                      setOpenHabitId(null);
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.tint, backgroundColor: colors.tint },
                      pressed && { opacity: 0.8 },
                    ]}>
                    <ThemedText style={{ color: colors.background, fontWeight: '600' }}>Continue today</ThemedText>
                  </Pressable>

                  {reducedTargetFor(habit) !== null && (
                    <Pressable
                      onPress={() => {
                        onSmallerVersion(habit);
                        setOpenHabitId(null);
                      }}
                      style={({ pressed }) => [
                        styles.optionButton,
                        { borderColor: colors.icon },
                        pressed && { opacity: 0.7 },
                      ]}>
                      <ThemedText>Do a smaller version</ThemedText>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={() => {
                      onSkip(habit);
                      setOpenHabitId(null);
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.icon },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText>Skip for today</ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      onPause(habit);
                      setOpenHabitId(null);
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.icon },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText>Pause this habit</ThemedText>
                  </Pressable>

                  <ThemedView style={[styles.optionButton, styles.stubButton, { borderColor: colors.icon + '55' }]}>
                    <ThemedText style={{ color: colors.icon }}>Adjust the schedule (coming soon)</ThemedText>
                  </ThemedView>

                  <ThemedView style={[styles.optionButton, styles.stubButton, { borderColor: colors.icon + '55' }]}>
                    <ThemedText style={{ color: colors.icon }}>Reflect (coming soon)</ThemedText>
                  </ThemedView>
                </ThemedView>
              )}
            </ThemedView>
          ))}
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  habitBlock: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 10,
  },
  habitRow: {
    paddingVertical: 4,
  },
  options: {
    gap: 8,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  stubButton: {
    opacity: 0.5,
  },
});
