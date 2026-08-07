import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { reducedTargetFor } from '@/lib/habit-stats';
import type { Habit, LapseReasonKey } from '@/lib/habit-types';

// docs/phase-4-plan.md section 4.2 -- four fixed reasons plus "Something else", one tap, always
// skippable. Order and copy match the locked spec.
const LAPSE_REASON_OPTIONS: { key: LapseReasonKey; label: string }[] = [
  { key: 'too_busy', label: 'Too busy' },
  { key: 'forgot', label: 'Forgot' },
  { key: 'low_energy', label: 'Low energy' },
  { key: 'not_feeling_it', label: 'Did not feel like it' },
  { key: 'something_else', label: 'Something else' },
];

/**
 * Gentle, dismissible card offering the Phase 4 recovery flow's options for habits with a
 * currently open, actionable lapse (docs/phase-4-plan.md section 3). Never a blocking modal, never
 * a permanent banner -- the parent screen decides eligibility (openLapse + isScheduledOpportunity +
 * suppression) and passes down only the habits currently eligible to show here.
 */
export function RecoveryCard({
  eligibleHabits,
  onContinue,
  onSmallerVersion,
  onSkip,
  onPause,
  onAdjustSchedule,
  onReflectChoice,
  onReflectSkip,
  onDismissAll,
}: {
  eligibleHabits: Habit[];
  onContinue: (habit: Habit) => void;
  onSmallerVersion: (habit: Habit) => void;
  onSkip: (habit: Habit) => void;
  onPause: (habit: Habit) => void;
  onAdjustSchedule: (habit: Habit) => void;
  /** Reflect chose a reason (or "Something else" with an optional note). */
  onReflectChoice: (habit: Habit, reason: LapseReasonKey, note?: string) => void;
  /** Reflect's own internal Skip -- same shape as the card-level Skip, different missedOpportunityDate (docs/phase-4-plan.md section 4.1). */
  onReflectSkip: (habit: Habit) => void;
  onDismissAll: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [expanded, setExpanded] = useState(false);
  const [openHabitId, setOpenHabitId] = useState<string | null>(null);
  const [reflectHabitId, setReflectHabitId] = useState<string | null>(null);
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (eligibleHabits.length === 0) return null;

  function closeHabitPanel() {
    setOpenHabitId(null);
    setReflectHabitId(null);
    setShowNoteFor(null);
    setNoteDraft('');
  }

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
            closeHabitPanel();
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
                onPress={() => (openHabitId === habit.id ? closeHabitPanel() : setOpenHabitId(habit.id))}>
                <ThemedText type="defaultSemiBold">
                  {habit.emoji} {habit.name}
                </ThemedText>
              </Pressable>

              {openHabitId === habit.id && reflectHabitId !== habit.id && (
                <ThemedView style={styles.options}>
                  <Pressable
                    onPress={() => {
                      onContinue(habit);
                      closeHabitPanel();
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
                        closeHabitPanel();
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
                      closeHabitPanel();
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
                      closeHabitPanel();
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.icon },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText>Pause this habit</ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      onAdjustSchedule(habit);
                      closeHabitPanel();
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.icon },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText>Adjust the schedule</ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setReflectHabitId(habit.id);
                      setShowNoteFor(null);
                      setNoteDraft('');
                    }}
                    style={({ pressed }) => [
                      styles.optionButton,
                      { borderColor: colors.icon },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText>Reflect</ThemedText>
                  </Pressable>
                </ThemedView>
              )}

              {openHabitId === habit.id && reflectHabitId === habit.id && (
                <ThemedView style={styles.options}>
                  <ThemedText style={{ color: colors.icon, fontSize: 13 }}>What got in the way? Totally optional.</ThemedText>
                  <ThemedView style={styles.chipRow}>
                    {LAPSE_REASON_OPTIONS.map((option) => (
                      <Pressable
                        key={option.key}
                        onPress={() => {
                          if (option.key === 'something_else') {
                            setShowNoteFor(habit.id);
                            return;
                          }
                          onReflectChoice(habit, option.key);
                          closeHabitPanel();
                        }}
                        style={({ pressed }) => [styles.chip, { borderColor: colors.icon }, pressed && { opacity: 0.7 }]}>
                        <ThemedText style={{ fontSize: 13 }}>{option.label}</ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>

                  {showNoteFor === habit.id && (
                    <TextInput
                      value={noteDraft}
                      onChangeText={setNoteDraft}
                      placeholder="Add a note (optional)"
                      placeholderTextColor={colors.icon}
                      style={[styles.noteInput, { borderColor: colors.icon, color: colors.text }]}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        onReflectChoice(habit, 'something_else', noteDraft.trim() || undefined);
                        closeHabitPanel();
                      }}
                    />
                  )}

                  <Pressable
                    onPress={() => {
                      onReflectSkip(habit);
                      closeHabitPanel();
                    }}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Skip</ThemedText>
                  </Pressable>
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  noteInput: {
    fontSize: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
