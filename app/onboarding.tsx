import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHabitStore } from '@/lib/habit-store';
import { ensureNotificationPermission } from '@/lib/notifications';

type Suggestion = { name: string; emoji: string; type: 'simple' | 'count'; targetCount?: number };

const SUGGESTIONS: Suggestion[] = [
  { name: 'Drink Water', emoji: '💧', type: 'count', targetCount: 8 },
  { name: 'Read', emoji: '📚', type: 'simple' },
  { name: 'Move my body', emoji: '🏃', type: 'simple' },
  { name: 'Meditate', emoji: '🧘', type: 'simple' },
];

const CUSTOM: Suggestion = { name: '', emoji: '🌱', type: 'simple' };

export default function OnboardingScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { addHabit, startChallenge, completeOnboarding, setNotifications } = useHabitStore();

  const hasFinished = useRef(false);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Suggestion[]>([SUGGESTIONS[0]]);
  const [customName, setCustomName] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmedCustomName = customName.trim();
  const habitsToCreate: Suggestion[] = [
    ...selected,
    ...(trimmedCustomName ? [{ name: trimmedCustomName, emoji: CUSTOM.emoji, type: 'simple' as const }] : []),
  ];
  const canContinueFromPicker = habitsToCreate.length > 0;
  const challengeLabel = habitsToCreate.map((habit) => `${habit.emoji} ${habit.name}`).join(', ');
  const challengeBody =
    habitsToCreate.length > 1
      ? `Three days in a row of all of: ${challengeLabel} — that's the challenge. Complete every one of them each day and you'll get a celebration worth showing off.`
      : `Three days in a row of "${challengeLabel}" — that's the challenge. Finish it and you'll get a celebration worth showing off.`;

  function toggleSuggestion(suggestion: Suggestion) {
    setSelected((current) =>
      current.includes(suggestion) ? current.filter((existing) => existing !== suggestion) : [...current, suggestion],
    );
  }

  function finish(enableReminders: boolean) {
    if (hasFinished.current) return;
    hasFinished.current = true;
    const createdHabits = habitsToCreate.map((suggestion) =>
      addHabit({
        name: suggestion.name,
        emoji: suggestion.emoji,
        type: suggestion.type,
        targetCount: suggestion.targetCount,
      }),
    );
    startChallenge(createdHabits.map((habit) => habit.id), 3);
    setNotifications(enableReminders, ['09:00']);
    completeOnboarding();
    router.replace('/(tabs)');
  }

  async function handleEnableReminders() {
    setBusy(true);
    const granted = await ensureNotificationPermission();
    setBusy(false);
    finish(granted);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {step === 0 && (
          <Step
            emoji="🌱"
            title="Build habits that stick"
            body="Create a habit, track it daily, and get an instant reward — a burst of celebration, a buzz, and a chime — every single time."
            primary="Let's go"
            onPrimary={() => setStep(1)}
            colors={colors}
          />
        )}

        {step === 1 && (
          <ThemedView style={styles.stepBody}>
            <ThemedView style={{ flex: 1, justifyContent: 'center', gap: 22 }}>
              <ThemedText type="title">How it works</ThemedText>
              <ThemedView style={{ gap: 18 }}>
                <FeatureRow
                  emoji="✅"
                  title="Create & track"
                  body="Add a habit — yes/no or a daily count — and log it with one tap."
                  colors={colors}
                />
                <FeatureRow
                  emoji="🚩"
                  title="Hit milestones & kickstarts"
                  body="Short challenges, like your first 3-day kickstart, earn an extra-big celebration when you finish."
                  colors={colors}
                />
                <FeatureRow
                  emoji="📊"
                  title="Track your progress"
                  body="See how you're really doing over time — not just whether you kept a streak, but how you come back after a day off."
                  colors={colors}
                />
                <FeatureRow
                  emoji="🔔"
                  title="Stay reminded"
                  body="Turn on daily nudges — at the times you choose, even per habit — so you never forget to check in."
                  colors={colors}
                />
              </ThemedView>
            </ThemedView>
            <PrimaryButton label="Got it" onPress={() => setStep(2)} colors={colors} />
          </ThemedView>
        )}

        {step === 2 && (
          <ThemedView style={styles.stepBody}>
            <ThemedView style={{ gap: 6 }}>
              <ThemedText type="title">Pick your habits</ThemedText>
              <ThemedText style={{ color: colors.icon }}>
                Choose one or more to start with — you can always add more later.
              </ThemedText>
            </ThemedView>
            <ThemedView style={styles.choices}>
              {SUGGESTIONS.map((suggestion) => {
                const isSelected = selected.includes(suggestion);
                return (
                  <Pressable
                    key={suggestion.name}
                    onPress={() => toggleSuggestion(suggestion)}
                    style={[
                      styles.choiceRow,
                      { borderColor: colors.icon },
                      isSelected && { borderColor: colors.tint, backgroundColor: colors.tint + '1a' },
                    ]}>
                    <ThemedText style={{ fontSize: 20 }}>{suggestion.emoji}</ThemedText>
                    <ThemedText type="defaultSemiBold" style={{ flex: 1 }}>
                      {suggestion.name}
                    </ThemedText>
                    <ThemedView
                      style={[
                        styles.checkbox,
                        { borderColor: colors.tint },
                        isSelected && { backgroundColor: colors.tint },
                      ]}>
                      {isSelected && <ThemedText style={{ color: colors.background, fontSize: 14 }}>✓</ThemedText>}
                    </ThemedView>
                  </Pressable>
                );
              })}
              <ThemedView
                style={[
                  styles.choiceRow,
                  { borderColor: colors.icon },
                  !!trimmedCustomName && { borderColor: colors.tint, backgroundColor: colors.tint + '1a' },
                ]}>
                <ThemedText style={{ fontSize: 20 }}>{CUSTOM.emoji}</ThemedText>
                <TextInput
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder="Add a habit of your own…"
                  placeholderTextColor={colors.icon}
                  style={[styles.customInput, { color: colors.text }]}
                />
                <ThemedView
                  style={[
                    styles.checkbox,
                    { borderColor: colors.tint },
                    !!trimmedCustomName && { backgroundColor: colors.tint },
                  ]}>
                  {!!trimmedCustomName && <ThemedText style={{ color: colors.background, fontSize: 14 }}>✓</ThemedText>}
                </ThemedView>
              </ThemedView>
            </ThemedView>
            <PrimaryButton
              label="Continue"
              disabled={!canContinueFromPicker}
              onPress={() => setStep(3)}
              colors={colors}
            />
          </ThemedView>
        )}

        {step === 3 && (
          <Step
            emoji="🚩"
            title="Let's make it a challenge"
            body={challengeBody}
            primary="Start my 3-day challenge"
            onPrimary={() => setStep(4)}
            colors={colors}
          />
        )}

        {step === 4 && (
          <ThemedView style={styles.stepBody}>
            <ThemedView style={{ gap: 6 }}>
              <ThemedText type="title">Stay on track</ThemedText>
              <ThemedText style={{ color: colors.icon }}>
                A daily nudge around 9:00 AM helps the habit stick — especially for the next three days. You can
                change this anytime in Settings.
              </ThemedText>
            </ThemedView>
            <ThemedView style={{ marginTop: 'auto', gap: 12 }}>
              <PrimaryButton label="Enable daily reminders" onPress={handleEnableReminders} colors={colors} disabled={busy} />
              <Pressable
                onPress={() => finish(false)}
                disabled={busy}
                style={[styles.skipButton, busy && { opacity: 0.4 }]}>
                <ThemedText style={{ color: colors.icon }}>Maybe later</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function FeatureRow({
  emoji,
  title,
  body,
  colors,
}: {
  emoji: string;
  title: string;
  body: string;
  colors: (typeof Colors)['light'];
}) {
  return (
    <ThemedView style={styles.featureRow}>
      <ThemedText style={{ fontSize: 28, lineHeight: 40 }}>{emoji}</ThemedText>
      <ThemedView style={{ flex: 1, gap: 2 }}>
        <ThemedText type="defaultSemiBold">{title}</ThemedText>
        <ThemedText style={{ color: colors.icon, fontSize: 14, lineHeight: 19 }}>{body}</ThemedText>
      </ThemedView>
    </ThemedView>
  );
}

function Step({
  emoji,
  title,
  body,
  primary,
  onPrimary,
  colors,
}: {
  emoji: string;
  title: string;
  body: string;
  primary: string;
  onPrimary: () => void;
  colors: (typeof Colors)['light'];
}) {
  return (
    <ThemedView style={styles.stepBody}>
      <ThemedView style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <ThemedText style={{ fontSize: 56, lineHeight: 80 }}>{emoji}</ThemedText>
        <ThemedText type="title">{title}</ThemedText>
        <ThemedText style={{ color: colors.icon, fontSize: 16, lineHeight: 22 }}>{body}</ThemedText>
      </ThemedView>
      <PrimaryButton label={primary} onPress={onPrimary} colors={colors} />
    </ThemedView>
  );
}

function PrimaryButton({
  label,
  onPress,
  colors,
  disabled,
}: {
  label: string;
  onPress: () => void;
  colors: (typeof Colors)['light'];
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.tint },
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 16 }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: 24 },
  stepBody: {
    flex: 1,
    gap: 20,
  },
  choices: {
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});
