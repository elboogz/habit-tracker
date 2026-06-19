import { StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import type { DayStatus } from '@/lib/habit-stats';

/** Row of small squares — filled for completed days, outlined for misses. Shared by Progress and Habit Detail. */
export function HabitHeatmap({
  history,
  fillColor,
  emptyColor,
  size = 16,
}: {
  history: DayStatus[];
  fillColor: string;
  emptyColor: string;
  size?: number;
}) {
  return (
    <ThemedView style={styles.row}>
      {history.map((entry) => (
        <ThemedView
          key={entry.date}
          style={[
            styles.cell,
            { width: size, height: size, borderRadius: size / 4, borderColor: emptyColor },
            entry.done && { backgroundColor: fillColor, borderColor: fillColor },
          ]}
        />
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  cell: {
    borderWidth: 1.5,
  },
});
