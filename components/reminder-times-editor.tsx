import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatTimeLabel(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * Add/remove a list of 'HH:mm' reminder times using +/- steppers (no native
 * date picker dependency, matches the stepper style used in habit-form).
 * Shared by Settings (global check-in times) and the habit form (per-habit times).
 */
export function ReminderTimesEditor({ times, onChange }: { times: string[]; onChange: (times: string[]) => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  function addTime() {
    const time = formatTime(hour, minute);
    if (times.includes(time)) return;
    onChange([...times, time].sort());
  }

  function removeTime(time: string) {
    onChange(times.filter((t) => t !== time));
  }

  return (
    <ThemedView style={{ gap: 10 }}>
      {times.length > 0 && (
        <ThemedView style={styles.chipRow}>
          {times.map((time) => (
            <ThemedView key={time} style={[styles.chip, { borderColor: colors.tint, backgroundColor: colors.tint + '1a' }]}>
              <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>{formatTimeLabel(time)}</ThemedText>
              <Pressable onPress={() => removeTime(time)} hitSlop={8}>
                <ThemedText style={{ color: colors.tint, fontWeight: '700', fontSize: 16 }}> ×</ThemedText>
              </Pressable>
            </ThemedView>
          ))}
        </ThemedView>
      )}

      <ThemedView style={styles.pickerRow}>
        <Stepper value={hour} onChange={(v) => setHour(((v % 24) + 24) % 24)} format={(v) => String(v).padStart(2, '0')} />
        <ThemedText type="defaultSemiBold" style={{ fontSize: 18 }}>
          :
        </ThemedText>
        <Stepper value={minute} onChange={(v) => setMinute(((v % 60) + 60) % 60)} step={5} format={(v) => String(v).padStart(2, '0')} />
        <Pressable onPress={addTime} style={[styles.addButton, { backgroundColor: colors.tint }]}>
          <ThemedText style={{ color: colors.background, fontWeight: '600' }}>Add time</ThemedText>
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

function Stepper({
  value,
  onChange,
  format,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  step?: number;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <ThemedView style={styles.stepper}>
      <Pressable onPress={() => onChange(value - step)} style={[styles.stepperButton, { borderColor: colors.icon }]}>
        <ThemedText style={{ fontSize: 16 }}>–</ThemedText>
      </Pressable>
      <ThemedText type="defaultSemiBold" style={styles.stepperValue}>
        {format(value)}
      </ThemedText>
      <Pressable onPress={() => onChange(value + step)} style={[styles.stepperButton, { borderColor: colors.icon }]}>
        <ThemedText style={{ fontSize: 16 }}>+</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 28,
    textAlign: 'center',
  },
  addButton: {
    marginLeft: 'auto',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
});
