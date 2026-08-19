import { Pressable, StyleSheet, Switch } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Weekday selection (and, only when editing, the Paused switch) for a habit's schedule. Used by
 * habit-form.tsx in two contexts with different affordances -- weekdays only at creation, weekdays
 * plus Paused when editing an existing habit -- so `showPaused` is a prop rather than something
 * this component infers, matching the ReminderTimesEditor precedent of a focused, reusable widget
 * that resolves its own theme colors.
 */
export function ScheduleDaysEditor({
  selectedDays,
  onChangeSelectedDays,
  showPaused,
  paused = false,
  onChangePaused,
  activeChallengeNotice = false,
}: {
  selectedDays: number[];
  onChangeSelectedDays: (days: number[]) => void;
  showPaused: boolean;
  paused?: boolean;
  onChangePaused?: (paused: boolean) => void;
  activeChallengeNotice?: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  function toggleDay(weekday: number) {
    if (selectedDays.includes(weekday)) {
      // Keep at least one day selected -- a habit with none would never have a Scheduled
      // Opportunity again, an unrecoverable dead end this UI shouldn't allow reaching.
      if (selectedDays.length === 1) return;
      onChangeSelectedDays(selectedDays.filter((day) => day !== weekday));
      return;
    }
    onChangeSelectedDays([...selectedDays, weekday].sort((a, b) => a - b));
  }

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="defaultSemiBold">Schedule</ThemedText>
      <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
        Which days count as a Scheduled Opportunity for this habit{showPaused ? ', and whether it’s paused.' : '.'}
      </ThemedText>
      <ThemedView style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, index) => {
          const selected = selectedDays.includes(index);
          return (
            <Pressable
              key={index}
              onPress={() => toggleDay(index)}
              style={[
                styles.weekdayChip,
                { borderColor: colors.icon },
                selected && { backgroundColor: colors.tint, borderColor: colors.tint },
              ]}>
              <ThemedText style={{ color: selected ? colors.background : colors.text, fontWeight: '600', fontSize: 13 }}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ThemedView>
      {showPaused && (
        <ThemedView style={styles.pauseRow}>
          <ThemedText>Paused</ThemedText>
          <Switch
            value={paused}
            onValueChange={onChangePaused}
            trackColor={{ false: colors.icon, true: colors.tint }}
            thumbColor="#fff"
          />
        </ThemedView>
      )}
      {activeChallengeNotice && (
        <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
          This habit has an active challenge. Schedule changes apply from today onward and never rewrite past days.
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: 8,
  },
  weekdayChip: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
