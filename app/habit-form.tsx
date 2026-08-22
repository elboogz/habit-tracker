import { HeaderBackButton } from '@react-navigation/elements';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReminderTimesEditor } from '@/components/reminder-times-editor';
import { ScheduleDaysEditor } from '@/components/schedule-days-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alertMessage, confirmAction } from '@/lib/confirm';
import { scheduleForDate } from '@/lib/domain/schedule';
import { dayKey, reducedTargetFor } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import { EMOJI_CHOICES, type Habit, type HabitType, type ScheduleDays } from '@/lib/habit-types';

const EMOJI_COLUMNS = 5;
const EMOJI_GAP = 8;

export default function HabitFormScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { state, addHabit, updateHabit, deleteHabit, addSchedulePeriod } = useHabitStore();

  const editingHabit = id ? state.habits.find((habit) => habit.id === id) : undefined;
  const isEditing = !!editingHabit;
  const hasActiveChallenge = state.challenges.some(
    (c) => c.status === 'active' && c.habitIds.includes(id ?? ''),
  );

  const currentSchedule = scheduleForDate(state.schedulePeriods, editingHabit?.id ?? '', dayKey());

  const [name, setName] = useState(editingHabit?.name ?? '');
  const [emoji, setEmoji] = useState(editingHabit?.emoji ?? EMOJI_CHOICES[0]);
  const [type, setType] = useState<HabitType>(editingHabit?.type ?? 'simple');
  const [targetCount, setTargetCount] = useState(editingHabit?.targetCount ?? 3);
  const [reducedTarget, setReducedTarget] = useState(
    editingHabit?.reducedTarget ??
      reducedTargetFor({ type: 'count', targetCount: editingHabit?.targetCount ?? 3 } as Habit) ??
      1,
  );
  const [reminderTimes, setReminderTimes] = useState<string[]>(editingHabit?.reminderTimes ?? []);
  const [selectedDays, setSelectedDays] = useState<number[]>(
    currentSchedule.days === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : currentSchedule.days,
  );
  const [paused, setPaused] = useState(currentSchedule.paused);
  const [emojiRowWidth, setEmojiRowWidth] = useState(0);

  function handleTargetCountChange(next: number) {
    const clamped = Math.max(2, Math.min(20, next));
    setTargetCount(clamped);
    // A "smaller version" must stay strictly below the full target (docs/phase-4-plan.md
    // section 10's edge case) -- clamp it down if the full target just shrank past it.
    setReducedTarget((current) => Math.min(current, clamped - 1));
  }

  const emojiSize =
    emojiRowWidth > 0 ? (emojiRowWidth - EMOJI_GAP * (EMOJI_COLUMNS - 1)) / EMOJI_COLUMNS : 44;

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      alertMessage('Give it a name', 'Habits need a short name so you recognize them later.');
      return;
    }

    if (editingHabit) {
      updateHabit({
        ...editingHabit,
        name: trimmed,
        emoji,
        type,
        targetCount: type === 'count' ? targetCount : undefined,
        reducedTarget: type === 'count' ? reducedTarget : undefined,
        reminderTimes: reminderTimes.length > 0 ? reminderTimes : undefined,
      });

      // Append-only: only write a new period if the selection actually differs from the one
      // currently in effect (docs/phase-4-plan.md section 6.3) -- avoids an empty history of
      // no-op periods every time the form is saved for an unrelated reason like renaming.
      const nextDays: ScheduleDays = selectedDays.length === 7 ? 'daily' : selectedDays;
      const daysChanged = JSON.stringify(currentSchedule.days) !== JSON.stringify(nextDays);
      if (daysChanged || paused !== currentSchedule.paused) {
        addSchedulePeriod(editingHabit.id, nextDays, paused);
      }
    } else {
      const newHabit = addHabit({ name: trimmed, emoji, type, targetCount, reducedTarget, reminderTimes });

      // Same append-only, only-if-different-from-default convention as the edit branch above --
      // a habit created with the default all-seven selection writes no period, preserving the
      // existing zero-periods-means-daily behaviour for the ordinary case.
      if (selectedDays.length !== 7) {
        addSchedulePeriod(newHabit.id, selectedDays, false);
      }
    }
    router.back();
  }

  function handleDelete() {
    if (!editingHabit) return;
    confirmAction(
      'Delete habit?',
      `"${editingHabit.name}" and all of its history will be removed.`,
      'Delete',
      () => {
        deleteHabit(editingHabit.id);
        router.back();
      },
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* A modal-presented screen is the root of its own presented stack, so native-stack never
          synthesizes an automatic back chevron for it (unlike a normal push) -- an explicit
          headerLeft is the only way to get a visible exit here, on any platform. */}
      <Stack.Screen
        options={{
          headerLeft: () => (
            <HeaderBackButton label="Cancel" tintColor={colors.tint} onPress={() => router.back()} />
          ),
        }}
      />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="title">{isEditing ? 'Edit habit' : 'New habit'}</ThemedText>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Name</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Drink Water"
              placeholderTextColor={colors.icon}
              style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
              returnKeyType="done"
            />
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Icon</ThemedText>
            <ThemedView style={styles.emojiRow} onLayout={(e) => setEmojiRowWidth(e.nativeEvent.layout.width)}>
              {EMOJI_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  onPress={() => setEmoji(choice)}
                  style={[
                    styles.emojiChip,
                    { width: emojiSize, height: emojiSize, borderColor: colors.icon },
                    choice === emoji && { borderColor: colors.tint, backgroundColor: colors.tint + '22' },
                  ]}>
                  <ThemedText style={{ fontSize: 22 }}>{choice}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Type</ThemedText>
            <ThemedView style={styles.segmented}>
              <Pressable
                onPress={() => setType('simple')}
                style={[
                  styles.segment,
                  { borderColor: colors.icon },
                  type === 'simple' && { backgroundColor: colors.tint, borderColor: colors.tint },
                ]}>
                <ThemedText style={{ color: type === 'simple' ? colors.background : colors.text }}>
                  Daily
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setType('count')}
                style={[
                  styles.segment,
                  { borderColor: colors.icon },
                  type === 'count' && { backgroundColor: colors.tint, borderColor: colors.tint },
                ]}>
                <ThemedText style={{ color: type === 'count' ? colors.background : colors.text }}>
                  Count-based
                </ThemedText>
              </Pressable>
            </ThemedView>
            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              {type === 'simple'
                ? 'Did you do it today: yes or no. Good for reading, meditating, journaling.'
                : 'Track repetitions toward a daily target. Good for water, push-ups, pages.'}
            </ThemedText>
          </ThemedView>

          {type === 'count' && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Daily target</ThemedText>
              <ThemedView style={styles.stepperRow}>
                <Pressable
                  onPress={() => handleTargetCountChange(targetCount - 1)}
                  style={[styles.stepperButton, { borderColor: colors.icon }]}>
                  <ThemedText style={{ fontSize: 20 }}>–</ThemedText>
                </Pressable>
                <ThemedText type="defaultSemiBold" style={styles.stepperValue}>
                  {targetCount}× per day
                </ThemedText>
                <Pressable
                  onPress={() => handleTargetCountChange(targetCount + 1)}
                  style={[styles.stepperButton, { borderColor: colors.icon }]}>
                  <ThemedText style={{ fontSize: 20 }}>+</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {type === 'count' && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Smaller version</ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                What the recovery card’s “Do a smaller version” logs on a tough day, a lighter target that still counts as done.
              </ThemedText>
              <ThemedView style={styles.stepperRow}>
                <Pressable
                  onPress={() => setReducedTarget((current) => Math.max(1, current - 1))}
                  style={[styles.stepperButton, { borderColor: colors.icon }]}>
                  <ThemedText style={{ fontSize: 20 }}>–</ThemedText>
                </Pressable>
                <ThemedText type="defaultSemiBold" style={styles.stepperValue}>
                  {reducedTarget}× per day
                </ThemedText>
                <Pressable
                  onPress={() => setReducedTarget((current) => Math.min(targetCount - 1, current + 1))}
                  style={[styles.stepperButton, { borderColor: colors.icon }]}>
                  <ThemedText style={{ fontSize: 20 }}>+</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Reminders</ThemedText>
            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              Get a nudge for just this habit at the times you pick. Requires reminders to be enabled in Settings.
            </ThemedText>
            <ReminderTimesEditor times={reminderTimes} onChange={setReminderTimes} />
          </ThemedView>

          <ScheduleDaysEditor
            selectedDays={selectedDays}
            onChangeSelectedDays={setSelectedDays}
            showPaused={isEditing}
            paused={paused}
            onChangePaused={setPaused}
            activeChallengeNotice={isEditing && hasActiveChallenge}
          />

          {isEditing && hasActiveChallenge && (
            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              This habit has an active challenge. Finish or let it run its course before editing its type.
            </ThemedText>
          )}

          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, { backgroundColor: colors.tint }, pressed && { opacity: 0.8 }]}>
            <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 16 }}>
              {isEditing ? 'Save changes' : 'Create habit'}
            </ThemedText>
          </Pressable>

          {isEditing && (
            <Pressable onPress={handleDelete} style={styles.deleteButton}>
              <IconSymbol name="trash.fill" size={16} color="#d9534f" />
              <ThemedText style={{ color: '#d9534f', fontWeight: '600' }}>Delete habit</ThemedText>
            </Pressable>
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
    padding: 24,
    gap: 22,
  },
  section: {
    gap: 8,
  },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emojiChip: {
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 110,
    textAlign: 'center',
  },
  saveButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
});
