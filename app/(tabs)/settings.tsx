import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/celebration-overlay';
import { ReminderTimesEditor, Stepper } from '@/components/reminder-times-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInsight, type InsightKind, regenerateInsight } from '@/lib/ai-coach';
import { useAuth } from '@/lib/auth-store';
import { disableCoachPush, enableCoachPush, getCoachPushPrefs } from '@/lib/coach-push';
import { alertMessage, confirmAction } from '@/lib/confirm';
import { widenedForDevSimulation, type ScenarioKey } from '@/lib/domain/dev-simulation';
import { recentScheduledPatternDates } from '@/lib/domain/schedule';
import { addDays, challengeProgress, dayKey } from '@/lib/habit-stats';
import { useHabitStore } from '@/lib/habit-store';
import { ensureNotificationPermission, notificationsSupported } from '@/lib/notifications';
import { useCelebration } from '@/lib/use-celebration';

const STREAK_BACKFILL_DAYS = 6;

// Labels/copy for the developer scenario simulator -- the patterns themselves live in
// lib/domain/dev-simulation.ts (ScenarioKey/scenarioPattern), verified against the real domain
// functions in lib/domain/dev-simulation.test.ts. "open" scenarios leave today unlogged so the
// Recovery Card renders and a real tap on Today exercises the live celebration; "preview"
// scenarios fill in today too, for an instant Progress-screen readout.
const SCENARIO_META: { key: ScenarioKey; label: string; mode: 'open' | 'preview' }[] = [
  { key: 'missYesterday', label: 'Miss yesterday', mode: 'open' },
  { key: 'missTwoConsecutive', label: 'Miss 2 scheduled days', mode: 'open' },
  { key: 'recoverToday', label: 'Recover today', mode: 'preview' },
  { key: 'recoverAfterMultipleMisses', label: 'Recover after a lapse', mode: 'preview' },
  { key: 'quietStretch', label: 'Quiet stretch', mode: 'preview' },
  { key: 'rebuilding', label: 'Rebuilding', mode: 'preview' },
  { key: 'building', label: 'Building', mode: 'preview' },
  { key: 'thriving', label: 'Thriving', mode: 'preview' },
];

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    state,
    setNotifications,
    setSoundEnabled,
    debugBackfillLogs,
    debugAdvanceChallenge,
    debugCompleteChallenge,
    debugFillHistory,
    debugSimulateScenario,
    resetOnboarding,
    resetAllData,
  } = useHabitStore();
  const { celebration, fire, clear } = useCelebration(state.soundEnabled);
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [simulatedIds, setSimulatedIds] = useState<Set<string>>(new Set());
  const [appliedScenario, setAppliedScenario] = useState<{ habitId: string; scenario: ScenarioKey } | null>(null);
  const { enabled, times } = state.notifications;

  const [coachPushEnabled, setCoachPushEnabled] = useState(false);
  const [coachPushLoaded, setCoachPushLoaded] = useState(false);
  const [coachPushHour, setCoachPushHour] = useState(15);
  const [coachPushMinute, setCoachPushMinute] = useState(0);
  const [coachPushBusy, setCoachPushBusy] = useState(false);
  const [regeneratingKind, setRegeneratingKind] = useState<InsightKind | null>(null);
  const [fillingHistory, setFillingHistory] = useState<'full' | 'alternating' | null>(null);
  const [simulatingPush, setSimulatingPush] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getCoachPushPrefs(user.id).then((prefs) => {
      if (cancelled) return;
      if (prefs) {
        setCoachPushEnabled(prefs.enabled);
        if (prefs.time) {
          const [hour, minute] = prefs.time.split(':').map(Number);
          setCoachPushHour(hour);
          setCoachPushMinute(minute);
        }
      }
      setCoachPushLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function formatCoachPushTime(hour: number, minute: number) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  async function handleCoachPushToggle(next: boolean) {
    if (!user) return;
    setCoachPushBusy(true);
    const result = next
      ? await enableCoachPush(user.id, formatCoachPushTime(coachPushHour, coachPushMinute))
      : await disableCoachPush(user.id);
    setCoachPushBusy(false);

    if (result.error) {
      alertMessage("Couldn't update AI Coach notifications", result.error);
      return;
    }
    setCoachPushEnabled(next);
  }

  async function handleCoachPushTimeChange(hour: number, minute: number) {
    setCoachPushHour(hour);
    setCoachPushMinute(minute);
    if (!coachPushEnabled || !user) return;
    setCoachPushBusy(true);
    const result = await enableCoachPush(user.id, formatCoachPushTime(hour, minute));
    setCoachPushBusy(false);
    if (result.error) alertMessage("Couldn't update AI Coach time", result.error);
  }

  async function handleSimulatePush() {
    if (typeof Notification === 'undefined') {
      alertMessage('Not supported', 'Browser notifications are only available on web (Chrome / Safari).');
      return;
    }
    if (!window.isSecureContext) {
      alertMessage(
        'HTTPS required',
        'Chrome blocks notifications on plain HTTP pages. Open the app at localhost:8081 (not the IP address) in your browser, then try again.',
      );
      return;
    }
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      alertMessage('Permission denied', 'Enable notifications for this site in your browser settings, then try again.');
      return;
    }
    setSimulatingPush(true);
    const insight = await getInsight('nudge');
    setSimulatingPush(false);
    if (!insight) {
      alertMessage('No insight yet', 'Log some habits first (or use "Fill all" above), then try again.');
      return;
    }
    new Notification('🧠 AI Coach', { body: insight.content });
  }

  function handleFillHistory(mode: 'full' | 'alternating') {
    debugFillHistory(mode);
    setFillingHistory(mode);
    setTimeout(() => setFillingHistory(null), 2000);
  }

  async function handleRegenerateInsight(kind: InsightKind) {
    setRegeneratingKind(kind);
    const result = await regenerateInsight(kind);
    setRegeneratingKind(null);
    if (!result) {
      alertMessage("Couldn't generate", 'Make sure you have at least one logged habit, then try again.');
      return;
    }
    alertMessage(`New ${kind} insight`, result.content);
  }

  function handleSignOut() {
    confirmAction(
      'Sign out?',
      'You can sign back in anytime — your habits stay saved to your account.',
      'Sign out',
      signOut,
    );
  }

  async function handleToggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        if (notificationsSupported) {
          const granted = await ensureNotificationPermission();
          if (!granted) return;
        }
        const activeTimes = times.length > 0 ? times : ['09:00'];
        setNotifications(true, activeTimes);
      } else {
        setNotifications(false, times);
      }
    } finally {
      setBusy(false);
    }
  }

  function updateTimes(next: string[]) {
    if (next.length === 0) return;
    setNotifications(enabled, next);
  }

  function handleResetAllData() {
    confirmAction(
      'Reset all app data?',
      'This deletes every habit, log, and challenge, and takes you back through onboarding. This cannot be undone.',
      'Reset',
      () => {
        resetAllData();
        if (Platform.OS === 'web') window.location.reload();
      },
    );
  }

  function handleResetOnboarding() {
    confirmAction(
      'Reset onboarding?',
      'This restarts the first-run flow from the welcome screen. Your habits, logs, and challenges are kept.',
      'Reset',
      () => {
        resetOnboarding();
        if (Platform.OS === 'web') window.location.reload();
      },
    );
  }

  function handleCompleteChallenge(challengeId: string) {
    debugCompleteChallenge(challengeId);
    fire('🏆', 'Challenge complete! 🎉', true);
  }

  function handleSimulateStreak(habitId: string) {
    // The STREAK_BACKFILL_DAYS most recent Scheduled Opportunities ending yesterday (today is left
    // for the user to log for real) -- for a daily habit this is unchanged from the prior plain
    // addDays loop; for a non-daily habit it now spans however many calendar days that many actual
    // Scheduled Opportunities require, rather than backfilling calendar days the habit was never
    // asking for. Widened for generation only (never persisted as-is; debugBackfillLogs backdates
    // the real, minimal period from the resulting dates) so a schedule set only moments ago still
    // generates against its real weekday pattern instead of falling back to daily beforehand.
    const generationPeriods = widenedForDevSimulation(habitId, state.schedulePeriods, dayKey());
    const dates = recentScheduledPatternDates(habitId, generationPeriods, STREAK_BACKFILL_DAYS, addDays(dayKey(), -1));
    debugBackfillLogs(habitId, dates);
    setSimulatedIds((current) => new Set([...current, habitId]));
    setTimeout(() => {
      setSimulatedIds((current) => {
        const next = new Set(current);
        next.delete(habitId);
        return next;
      });
    }, 2000);
  }

  function handleSimulateScenario(habitId: string, scenario: ScenarioKey) {
    debugSimulateScenario(habitId, scenario);
    setAppliedScenario({ habitId, scenario });
    setTimeout(() => {
      setAppliedScenario((current) =>
        current?.habitId === habitId && current.scenario === scenario ? null : current,
      );
    }, 2000);
  }

  const activeChallenges = state.challenges.filter((c) => c.status === 'active');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.header}>
            <ThemedText type="title">Settings</ThemedText>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Account</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Signed in</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>{user?.email}</ThemedText>
              </ThemedView>
            </ThemedView>
            <Pressable onPress={handleSignOut} style={[styles.resetButton, { borderColor: colors.tint }]}>
              <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>Sign out</ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Daily check-ins</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Reminders</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  A friendly nudge to log your habits and keep your streaks alive.
                </ThemedText>
              </ThemedView>
              <Switch
                value={enabled}
                onValueChange={handleToggle}
                disabled={busy}
                trackColor={{ false: colors.icon, true: colors.tint }}
                thumbColor="#fff"
              />
            </ThemedView>

            {enabled && (
              <ThemedView style={{ gap: 8 }}>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Reminder times</ThemedText>
                <ReminderTimesEditor times={times} onChange={updateTimes} />
              </ThemedView>
            )}

            <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
              Want a nudge for one specific habit? Set per-habit reminder times from that habit&apos;s edit screen.
            </ThemedText>

            {!notificationsSupported && (
              <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                Reminders can&apos;t fire here — Expo Go and web browsers don&apos;t support local notification
                scheduling. Your preferences are saved and will take effect in a development or production build.
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">AI Coach</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Daily coaching nudge</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  A personalized push from your AI coach, based on your recent habits — sent even when the app
                  is closed.
                </ThemedText>
              </ThemedView>
              <Switch
                value={coachPushEnabled}
                onValueChange={handleCoachPushToggle}
                disabled={coachPushBusy || !coachPushLoaded || Platform.OS === 'web'}
                trackColor={{ false: colors.icon, true: colors.tint }}
                thumbColor="#fff"
              />
            </ThemedView>
            {Platform.OS === 'web' && (
              <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                Push notifications require the iOS or Android app — this setting is not available in the
                browser. Use &quot;Send test push&quot; in Developer tools to preview coaching content in
                Chrome or Safari instead.
              </ThemedText>
            )}

            {coachPushEnabled && (
              <ThemedView style={{ gap: 8 }}>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>Notification time</ThemedText>
                <ThemedView style={styles.pickerRow}>
                  <Stepper
                    value={coachPushHour}
                    onChange={(v) => handleCoachPushTimeChange(((v % 24) + 24) % 24, coachPushMinute)}
                    format={(v) => String(v).padStart(2, '0')}
                  />
                  <ThemedText type="defaultSemiBold" style={{ fontSize: 18 }}>
                    :
                  </ThemedText>
                  <Stepper
                    value={coachPushMinute}
                    onChange={(v) => handleCoachPushTimeChange(coachPushHour, ((v % 60) + 60) % 60)}
                    step={5}
                    format={(v) => String(v).padStart(2, '0')}
                  />
                </ThemedView>
              </ThemedView>
            )}

            <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
              Push notifications need a real device and an EAS-linked build. Android via Expo Go isn&apos;t
              supported (a platform restriction) — this works on iOS via Expo Go or any build for now.
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Sound effects</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedView style={{ flex: 1, gap: 2 }}>
                <ThemedText type="defaultSemiBold">Celebration chime</ThemedText>
                <ThemedText style={{ color: colors.icon, fontSize: 13 }}>
                  Plays a sound when you log a habit or complete a challenge.
                </ThemedText>
              </ThemedView>
              <Switch
                value={state.soundEnabled}
                onValueChange={setSoundEnabled}
                trackColor={{ false: colors.icon, true: colors.tint }}
                thumbColor="#fff"
              />
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">About</ThemedText>
            <ThemedView style={[styles.row, { borderColor: colors.icon }]}>
              <ThemedText style={{ color: colors.icon, fontSize: 13, flex: 1 }}>
                Appearance follows your system&apos;s light/dark setting automatically.
              </ThemedText>
            </ThemedView>
          </ThemedView>

          {__DEV__ && (
            <ThemedView style={styles.section}>
              <ThemedText type="defaultSemiBold">Developer tools</ThemedText>
              <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                Visible only in development builds. Use these to fast-forward state and verify the core loop and
                challenge-completion celebration without waiting days.
              </ThemedText>

              {activeChallenges.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Active challenges</ThemedText>
                  {activeChallenges.map((challenge) => {
                    const progress = challengeProgress(challenge, state.habits, state.logs, state.schedulePeriods);
                    if (progress.habits.length === 0) return null;
                    const atFinalDay = progress.daysElapsed >= progress.totalDays;
                    return (
                      <ThemedView key={challenge.id} style={[styles.devRow, { borderColor: colors.icon }]}>
                        <ThemedView style={{ flex: 1, gap: 2 }}>
                          <ThemedText>
                            {progress.habits.map((h) => h.emoji).join(' ')}{' '}
                            {progress.habits.map((h) => h.name).join(', ')}
                          </ThemedText>
                          <ThemedText style={{ color: colors.icon, fontSize: 12 }}>
                            Day {progress.daysElapsed} of {progress.totalDays}
                          </ThemedText>
                        </ThemedView>
                        <ThemedView style={{ gap: 8 }}>
                          <Pressable
                            disabled={atFinalDay}
                            onPress={() => debugAdvanceChallenge(challenge.id)}
                            style={[styles.devButton, { borderColor: colors.tint }, atFinalDay && { opacity: 0.4 }]}>
                            <ThemedText style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>
                              {atFinalDay ? 'On final day' : 'Jump to final day'}
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            onPress={() => handleCompleteChallenge(challenge.id)}
                            style={[styles.devButton, { borderColor: colors.tint, backgroundColor: colors.tint }]}>
                            <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 13 }}>
                              Complete now 🏆
                            </ThemedText>
                          </Pressable>
                        </ThemedView>
                      </ThemedView>
                    );
                  })}
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    &quot;Jump to final day&quot; backfills earlier days so you can log the habit yourself on the Today
                    tab and trigger the real completion celebration. &quot;Complete now&quot; instantly backfills every
                    day, marks the challenge completed, and fires the celebration here — check the Today and
                    Challenges tabs afterwards to see the post-completion state.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Simulate a streak</ThemedText>
                  {state.habits.map((habit) => {
                    const done = simulatedIds.has(habit.id);
                    return (
                      <ThemedView key={habit.id} style={[styles.devRow, { borderColor: colors.icon }]}>
                        <ThemedText style={{ flex: 1 }}>
                          {habit.emoji} {habit.name}
                        </ThemedText>
                        <Pressable
                          onPress={() => handleSimulateStreak(habit.id)}
                          disabled={done}
                          style={[
                            styles.devButton,
                            { borderColor: colors.tint },
                            done && { backgroundColor: colors.tint },
                          ]}>
                          <ThemedText style={{ color: done ? colors.background : colors.tint, fontWeight: '600', fontSize: 13 }}>
                            {done ? 'Done ✓' : `+${STREAK_BACKFILL_DAYS} scheduled days`}
                          </ThemedText>
                        </Pressable>
                      </ThemedView>
                    );
                  })}
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Backfills the last {STREAK_BACKFILL_DAYS} scheduled days as done (today is left for you to log),
                    so you can check the scheduled-days-in-a-row stat on Habit Detail and the weekly view.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Simulate a scenario</ThemedText>
                  {state.habits.map((habit) => (
                    <ThemedView
                      key={habit.id}
                      style={[styles.devRow, { borderColor: colors.icon, flexDirection: 'column', alignItems: 'stretch' }]}>
                      <ThemedText>
                        {habit.emoji} {habit.name}
                      </ThemedText>
                      <ThemedView style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {SCENARIO_META.map(({ key, label }) => {
                          const applied = appliedScenario?.habitId === habit.id && appliedScenario.scenario === key;
                          return (
                            <Pressable
                              key={key}
                              onPress={() => handleSimulateScenario(habit.id, key)}
                              style={[
                                styles.devButton,
                                { borderColor: colors.tint, paddingHorizontal: 10, paddingVertical: 6 },
                                applied && { backgroundColor: colors.tint },
                              ]}>
                              <ThemedText style={{ color: applied ? colors.background : colors.tint, fontWeight: '600', fontSize: 12 }}>
                                {applied ? 'Applied ✓' : label}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </ThemedView>
                    </ThemedView>
                  ))}
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Overwrites that habit&apos;s last 7-12 days with a real, valid history (backdating its creation
                    date the same way the tools above do, and, for a non-daily schedule, backdating the active
                    schedule period to cover the same window), so the Recovery Card, Momentum State, and Recovery
                    Rate all read it exactly as they would genuine usage; nothing is bypassed or faked. If the
                    habit had more than one schedule period before this ran, that earlier schedule history is
                    flattened into whichever period is active today, since this tool is for testing behaviour,
                    not for keeping an exact record. &quot;Miss yesterday&quot; and &quot;Miss 2 scheduled
                    days&quot; leave today open so you can log the habit on the Today tab and see the real
                    Recovery Card and celebration; the rest fill in today too, for an instant Progress-screen
                    preview of that Momentum State or recovery outcome.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Simulate 30-day history</ThemedText>
                  <ThemedView style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => handleFillHistory('full')}
                      disabled={fillingHistory !== null}
                      style={[
                        styles.devButton,
                        { borderColor: colors.tint, flex: 1, alignItems: 'center' },
                        fillingHistory === 'full' && { backgroundColor: colors.tint },
                      ]}>
                      <ThemedText
                        style={{
                          color: fillingHistory === 'full' ? colors.background : colors.tint,
                          fontWeight: '600',
                          fontSize: 13,
                        }}>
                        {fillingHistory === 'full' ? 'Done ✓' : 'Fill all (100%)'}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => handleFillHistory('alternating')}
                      disabled={fillingHistory !== null}
                      style={[
                        styles.devButton,
                        { borderColor: colors.tint, flex: 1, alignItems: 'center' },
                        fillingHistory === 'alternating' && { backgroundColor: colors.tint },
                      ]}>
                      <ThemedText
                        style={{
                          color: fillingHistory === 'alternating' ? colors.background : colors.tint,
                          fontWeight: '600',
                          fontSize: 13,
                        }}>
                        {fillingHistory === 'alternating' ? 'Done ✓' : 'Alternate (~50%)'}
                      </ThemedText>
                    </Pressable>
                  </ThemedView>
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Backfills the last 30 days across all habits. &quot;Fill all&quot; gives 100% completion on every
                    habit. &quot;Alternate&quot; fills every other habit (0% on odd ones) so the coach has a mix of
                    strengths and gaps to comment on. Then use &quot;Regenerate&quot; below to refresh the Coach
                    card with real AI output.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>AI Coach insights</ThemedText>
                  <ThemedView style={{ flexDirection: 'row', gap: 8 }}>
                    {(['nudge', 'weekly', 'monthly'] as const).map((kind) => (
                      <Pressable
                        key={kind}
                        onPress={() => handleRegenerateInsight(kind)}
                        disabled={regeneratingKind !== null}
                        style={[styles.devButton, { borderColor: colors.tint, flex: 1, alignItems: 'center' }]}>
                        <ThemedText style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>
                          {regeneratingKind === kind ? 'Generating…' : `Regenerate ${kind}`}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Fetches the current AI insight (uses freshness cache). To force a brand-new Claude call,
                    first delete the relevant row in the Supabase dashboard (Table Editor → ai_insights), then
                    tap Regenerate again.
                  </ThemedText>
                </ThemedView>
              )}

              {state.habits.length > 0 && (
                <ThemedView style={{ gap: 8 }}>
                  <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Simulate push notification</ThemedText>
                  <Pressable
                    onPress={handleSimulatePush}
                    disabled={simulatingPush}
                    style={[styles.devButton, { borderColor: colors.tint, alignItems: 'center' }]}>
                    <ThemedText style={{ color: colors.tint, fontWeight: '600', fontSize: 13 }}>
                      {simulatingPush ? 'Fetching nudge…' : '🔔 Send test push'}
                    </ThemedText>
                  </Pressable>
                  <ThemedText style={{ color: colors.icon, fontSize: 12, lineHeight: 17 }}>
                    Fires a real browser notification using today&apos;s AI nudge — same title and body as the
                    scheduled push. Works in Chrome and Safari on web; grant permission when prompted.
                  </ThemedText>
                </ThemedView>
              )}

              <Pressable onPress={handleResetOnboarding} style={[styles.resetButton, { borderColor: colors.tint }]}>
                <ThemedText style={{ color: colors.tint, fontWeight: '600' }}>Reset onboarding</ThemedText>
              </Pressable>

              <Pressable onPress={handleResetAllData} style={[styles.resetButton, { borderColor: '#d9534f' }]}>
                <ThemedText style={{ color: '#d9534f', fontWeight: '600' }}>Reset all app data</ThemedText>
              </Pressable>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
      <CelebrationOverlay celebration={celebration} onDone={clear} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 28,
  },
  header: {
    gap: 4,
  },
  section: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  devButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
});
