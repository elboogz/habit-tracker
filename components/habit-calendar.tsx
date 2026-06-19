import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { dayKey, type DayStatus } from '@/lib/habit-stats';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Calendar-grid view of recent history — weeks as rows, days aligned under weekday columns. */
export function HabitCalendar({
  history,
  fillColor,
  emptyColor,
  textColor,
}: {
  history: DayStatus[];
  fillColor: string;
  emptyColor: string;
  textColor: string;
}) {
  if (history.length === 0) return null;

  const leadingBlanks = parseDayKey(history[0].date).getDay();
  const cells: (DayStatus | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...history];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DayStatus | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const today = dayKey();

  return (
    <ThemedView style={{ gap: 6 }}>
      <ThemedView style={styles.row}>
        {WEEKDAY_LABELS.map((label, index) => (
          <ThemedView key={index} style={styles.cell}>
            <ThemedText style={{ fontSize: 11, color: emptyColor }}>{label}</ThemedText>
          </ThemedView>
        ))}
      </ThemedView>
      {weeks.map((week, weekIndex) => (
        <ThemedView key={weekIndex} style={styles.row}>
          {week.map((day, dayIndex) => {
            if (!day) return <ThemedView key={dayIndex} style={styles.cell} />;
            const isToday = day.date === today;
            return (
              <ThemedView
                key={dayIndex}
                style={[
                  styles.cell,
                  styles.dayCell,
                  { borderColor: isToday ? fillColor : emptyColor + '33' },
                  day.done && { backgroundColor: fillColor, borderColor: fillColor },
                ]}>
                <ThemedText style={{ fontSize: 12, color: day.done ? '#fff' : textColor }}>
                  {parseDayKey(day.date).getDate()}
                </ThemedText>
              </ThemedView>
            );
          })}
        </ThemedView>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCell: {
    borderRadius: 8,
    borderWidth: 1.5,
  },
});
