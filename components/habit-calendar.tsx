import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { addDays, dayKey, type DayStatus } from '@/lib/habit-stats';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Calendar-grid view of recent history — weeks as rows, days aligned under weekday columns.
 * `onDayPress` (Phase 4 retroactive entry, docs/phase-4-plan.md section 7.1-7.2) makes the 6 days
 * before today pressable -- today itself is excluded since Today's own checkbox/stepper is
 * already a first-class, always-visible editor and duplicating it here would be redundant.
 * Progress's existing usage passes nothing, so it stays visually and behaviorally unchanged.
 */
export function HabitCalendar({
  history,
  fillColor,
  emptyColor,
  textColor,
  onDayPress,
}: {
  history: DayStatus[];
  fillColor: string;
  emptyColor: string;
  textColor: string;
  onDayPress?: (date: string) => void;
}) {
  if (history.length === 0) return null;

  const leadingBlanks = parseDayKey(history[0].date).getDay();
  const cells: (DayStatus | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...history];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (DayStatus | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const today = dayKey();
  const editableFrom = addDays(today, -6);

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
            const isEditable = !!onDayPress && day.date >= editableFrom && day.date < today;
            const cellStyle = [
              styles.cell,
              styles.dayCell,
              { borderColor: isToday ? fillColor : emptyColor + '33' },
              day.done && { backgroundColor: fillColor, borderColor: fillColor },
              isEditable && { borderStyle: 'dashed' as const },
            ];
            const dayNumber = (
              <ThemedText style={{ fontSize: 12, color: day.done ? '#fff' : textColor }}>
                {parseDayKey(day.date).getDate()}
              </ThemedText>
            );
            if (!isEditable) {
              return (
                <ThemedView key={dayIndex} style={cellStyle}>
                  {dayNumber}
                </ThemedView>
              );
            }
            return (
              <Pressable key={dayIndex} onPress={() => onDayPress?.(day.date)} style={cellStyle}>
                {dayNumber}
              </Pressable>
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
