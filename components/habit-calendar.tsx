import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { addDays, dayKey, type DayStatus } from '@/lib/habit-stats';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A history day plus whether it was a Scheduled Opportunity -- see HabitCalendar's own doc comment. */
type ScheduledDayStatus = DayStatus & { scheduled: boolean };

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Calendar-grid view of recent history — weeks as rows, days aligned under weekday columns.
 * `onDayPress` (Phase 4 retroactive entry, docs/phase-4-plan.md section 7.1-7.2) makes days
 * pressable -- today itself is always excluded since Today's own checkbox/stepper is already a
 * first-class, always-visible editor and duplicating it here would be redundant. `minEditableDate`
 * is the caller-supplied floor (see lib/domain/schedule.ts's `retroactiveEntryWindowStart`, which
 * already intersects the fixed retroactive-entry window with the habit's own creation date -- this
 * component has no notion of a Habit and just renders whatever floor it's given); it defaults to
 * the raw 6-day-back window for backward compatibility if a caller doesn't supply one. Progress's
 * existing usage passes neither `onDayPress` nor `minEditableDate`, so it stays visually and
 * behaviorally unchanged.
 *
 * Each `history` entry's `scheduled` flag (see lib/domain/schedule.ts's `scheduledOpportunityFlags`)
 * drives a third, receded cell treatment for dates that were not a Scheduled Opportunity -- paused
 * dates and ordinary off-schedule dates render identically, since neither the domain layer nor this
 * component distinguishes them (product decision). `scheduled` deliberately does not affect
 * `isEditable`: extra completions on non-scheduled days remain a permitted, deliberate product
 * decision on both the live (Today) and retroactive (here) paths, so every day in the existing
 * editable window stays pressable regardless of `scheduled`.
 */
export function HabitCalendar({
  history,
  fillColor,
  emptyColor,
  textColor,
  onDayPress,
  minEditableDate,
}: {
  history: ScheduledDayStatus[];
  fillColor: string;
  emptyColor: string;
  textColor: string;
  onDayPress?: (date: string) => void;
  minEditableDate?: string;
}) {
  if (history.length === 0) return null;

  const leadingBlanks = parseDayKey(history[0].date).getDay();
  const cells: (ScheduledDayStatus | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...history];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (ScheduledDayStatus | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const today = dayKey();
  const editableFrom = minEditableDate ?? addDays(today, -6);

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
            // Recedes rather than competing with the done/missed states: same border mechanism
            // already used for a missed day (emptyColor at reduced alpha), just fainter, plus a
            // dimmed day-number reusing the same muted tone the weekday header labels already use
            // above -- no new colour token. Only applies when not done, so a completion logged on
            // a non-scheduled day (a permitted bonus completion) still renders exactly as done.
            const isReceded = !day.scheduled && !day.done;
            const cellStyle = [
              styles.cell,
              styles.dayCell,
              { borderColor: isToday ? fillColor : isReceded ? emptyColor + '20' : emptyColor + '33' },
              day.done && { backgroundColor: fillColor, borderColor: fillColor },
              isEditable && { borderStyle: 'dashed' as const },
            ];
            const dayNumber = (
              <ThemedText style={{ fontSize: 12, color: day.done ? '#fff' : isReceded ? emptyColor : textColor }}>
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
