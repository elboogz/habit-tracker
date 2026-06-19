# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npx expo start` — start the Metro dev server (scan the QR with Expo Go, or press `i`/`a`/`w` for simulator/emulator/web)
- `npm run ios` / `npm run android` / `npm run web` — start the dev server targeting a specific platform
- `npm run lint` — run ESLint via `expo lint` (flat config in [eslint.config.js](eslint.config.js), extends `eslint-config-expo`)
- `npm run reset-project` — moves the current `app/`, `components/`, `hooks/`, `constants/`, `scripts/` to `app-example/` and scaffolds a blank `app/` (one-way; only run if explicitly asked to wipe the starter code)

There is no test runner configured in this project.

## Architecture

This is a **habit-tracking app** built around a deliberate app-design framework: a core function (create/track habits), a core loop (log → instant reward), a 3-day starter challenge, accessory features (history, consistency charts, multiple habit types), a hard cap on screen count, and a retention hook (ongoing challenges + daily local reminders). It uses **file-based routing via Expo Router** (`expo-router/entry` is the app entry point in [package.json](package.json)). Routes are defined by the file structure under `app/`:

- [app/_layout.tsx](app/_layout.tsx) — root layout; wraps everything in `HabitStoreProvider` and React Navigation's `ThemeProvider` (light/dark), registers the global notification handler, and defines the top-level `Stack`. Uses `<Stack.Protected guard={...}>` to route first-time users to `onboarding` and everyone else to `(tabs)`, gated on `hydrated` so returning users never see an onboarding flash. `unstable_settings.anchor` points to `(tabs)`.
- `app/(tabs)/` — bottom `Tabs` navigator ([app/(tabs)/_layout.tsx](app/(tabs)/_layout.tsx)) with exactly **4 tabs**: `index` (Today — the core loop, shows today's date and lets you check/uncheck habits), `progress` (streaks + consistency heatmaps, toggle between "Last 14 days" and "Last 7 days"), `challenges` (the single active challenge across a chosen set of habits, past challenges, and the start-a-new-challenge flow), `settings` (reminder scheduling + a `__DEV__`-only developer tools section).
- [app/habit-form.tsx](app/habit-form.tsx) — modal route for creating/editing a habit (name, 3×5 emoji grid, type — "Daily" or "Count-based" — target, per-habit reminder times, and a "Delete habit" action when editing). Pass `?id=<habitId>` to edit.
- [app/habit/[id].tsx](app/habit/[id].tsx) — stack-pushed "Habit History" screen (current + best streak, consistency, total logs — each with an emoji above the number — a calendar-grid view of the last 28 days via [components/habit-calendar.tsx](components/habit-calendar.tsx), and recent log entries with an emoji per row).
- [app/onboarding.tsx](app/onboarding.tsx) — first-run flow gated by `state.hasOnboarded`: welcome → "how it works" explainer (create/track, milestones & kickstarts, progress, reminders) → pick a habit → frame it as a 3-day challenge (started via `startChallenge([habit.id], 3)`) → opt into reminders. Re-triggerable from Settings dev tools via `resetOnboarding`.

Together that's **7 screens** — 4 tabs carry daily navigation, the other 3 (habit form, habit detail, onboarding) are infrequent modal/drill-in/once-only flows, keeping the *felt* surface area within the 5-7 screen design constraint.

### Data layer & the core loop

- [lib/habit-types.ts](lib/habit-types.ts) — `Habit`, `HabitLog`, `Challenge`, `HabitState` types. Habits are `'simple'` (yes/no) or `'count'` (target reps per day, e.g. "drink water ×8"); completion is always derived from `HabitLog` entries, never stored as a flag. `Habit.reminderTimes?: string[]` holds optional per-habit `'HH:mm'` reminder times. `Challenge.habitIds: string[]` — a challenge covers a *set* of habits, not a single one. `HabitState.soundEnabled: boolean` gates the chime in `useCelebration`. `EMOJI_CHOICES` has 15 entries (a 3×5 grid in the habit form).
- [lib/habit-store.tsx](lib/habit-store.tsx) — `HabitStoreProvider` / `useHabitStore()`: a Context + `useReducer` store persisted to `AsyncStorage` (hydrates on mount, exposes `hydrated` so consumers can wait for it). All mutations (`addHabit`, `updateHabit`, `deleteHabit`, `logHabit`, `unlogHabit`, `startChallenge`, `setNotifications`, `setSoundEnabled`, `setChallengeStatus`, etc.) go through this. `unlogHabit(habitId)` removes the most-recently-logged entry for that habit today (LIFO), powering the "uncheck" interaction on Today. `startChallenge(habitIds, durationDays)` no-ops if `habitIds` is empty or another challenge is already `'active'` — **only one challenge can be active at a time**. `resetOnboarding()` clears `hasOnboarded` without touching habits/logs/challenges (Settings dev tools). After hydration, an effect calls `scheduleAllReminders` whenever `notifications` or `habits` change, so reminder scheduling always reflects the latest preferences. Also exposes `debugBackfillLogs`, `debugAdvanceChallenge`, `debugCompleteChallenge`, and `resetAllData` — used only by the Settings developer tools section. `debugAdvanceChallenge` backfills all but the final day so the user can log the last day for real; `debugCompleteChallenge` backfills every day (including today) and sets the challenge straight to `'completed'`, for instantly previewing the post-completion state.
- [lib/habit-stats.ts](lib/habit-stats.ts) — pure derived-state helpers (`streakForHabit`, `longestStreak`, `isDoneToday`, `recentHistory`, `consistency`, `challengeProgress`). `challengeProgress` returns `{ habits: Habit[], ... }` (all habits in the challenge) and counts a day as complete only if **every** included habit was done that day (`allDoneOnDay`). Keep these pure; Progress and Challenges screens depend on them producing identical answers from the same `(habits, logs, challenges)` triple.
- [lib/confirm.ts](lib/confirm.ts) — `confirmAction`/`alertMessage` wrap `Alert.alert`, falling back to `window.confirm`/`window.alert` on web (`react-native-web`'s `Alert.alert` is a no-op). Use these instead of `Alert.alert` directly for any destructive action or validation message, so it works in the web preview too.
- **The core loop** (in [app/(tabs)/index.tsx](app/(tabs)/index.tsx)'s `handleLog`): logging a habit fires `useCelebration()` ([lib/use-celebration.ts](lib/use-celebration.ts)), which triggers all three reward channels together — `expo-haptics` pulse, a synthesized chime via `useChime()` ([lib/use-chime.ts](lib/use-chime.ts), asset generated by [scripts/generate-chime.js](scripts/generate-chime.js)), and a particle-burst `<CelebrationOverlay>` ([components/celebration-overlay.tsx](components/celebration-overlay.tsx)). Challenge-completion moments reuse the same primitives with `big: true` for an amplified version — keep new reward triggers going through `useCelebration` rather than rolling bespoke animations.

### Notifications (retention hook)

[lib/notifications.ts](lib/notifications.ts) wraps `expo-notifications` to schedule **locally-scheduled daily reminders** (`SchedulableTriggerInputTypes.DAILY`) — there is no backend, so this is not remote push. `scheduleAllReminders(notifications, habits)` cancels everything and reschedules: one reminder per global check-in time in `notifications.times`, plus one per `habit.reminderTimes` entry (with habit-specific copy). It's called automatically from `lib/habit-store.tsx`'s post-hydration effect, not from screens directly. `notificationsSupported` is `false` on web (expo-notifications has no scheduling backend there) — `scheduleAllReminders` and `ensureNotificationPermission` no-op/return safely on web rather than throwing, so preferences still save and the Settings toggle stays usable; reminders only actually fire on an iOS/Android dev or production build. Remote push notifications are not supported in Expo Go on Android (post-SDK-53), and local notification delivery in Expo Go can be unreliable.

### Theming

Colors are centralized in [constants/theme.ts](constants/theme.ts) as a `Colors.light` / `Colors.dark` map (keys: `text`, `background`, `tint`, `icon`, `tabIconDefault`, `tabIconSelected`), plus a `Fonts` map keyed per-platform (`ios` / `default` / `web`).

Don't read `useColorScheme()` and index into `Colors` directly in screens — use the themed primitives, which already resolve the right color and support `lightColor`/`darkColor` overrides:
- [components/themed-text.tsx](components/themed-text.tsx) / [components/themed-view.tsx](components/themed-view.tsx) — themed `Text`/`View` wrappers
- [hooks/use-theme-color.ts](hooks/use-theme-color.ts) — resolves a color name through `Colors[scheme]`, with optional per-call overrides
- [hooks/use-color-scheme.ts](hooks/use-color-scheme.ts) / `.web.ts` — platform-specific color scheme hooks (the web variant defers to client hydration to support static rendering)

### Path aliases

`@/*` maps to the project root (see [tsconfig.json](tsconfig.json)), e.g. `@/components/themed-text`, `@/constants/theme`.

### Notable components

- [components/parallax-scroll-view.tsx](components/parallax-scroll-view.tsx) — scroll view with a parallaxing header image, used by the home tab
- [components/haptic-tab.tsx](components/haptic-tab.tsx) — wraps tab bar buttons with haptic feedback on press
- [components/ui/icon-symbol.tsx](components/ui/icon-symbol.tsx) / `.ios.tsx` — cross-platform icon abstraction (SF Symbols on iOS, fallback elsewhere)
- [components/habit-heatmap.tsx](components/habit-heatmap.tsx) — row of small squares (filled = done, outlined = miss) from a `DayStatus[]`; shared by Progress and Habit Detail screens
- [components/reminder-times-editor.tsx](components/reminder-times-editor.tsx) — inline add/remove/pick reminder times UI; used in Settings (global times) and `habit-form.tsx` (per-habit times)

## Compatibility note

The app is pinned to **Expo SDK 54** specifically because the locally installed Expo Go client only supports SDK 54 — the public Expo Go release lags behind the npm `latest` tag (currently SDK 56). If you bump the `expo` package, the project must be regenerated from the matching `expo-template-default@sdk-XX` template rather than patched in place — `npx expo install --fix` on a manually-bumped `expo` version produces unresolvable peer-dependency conflicts (e.g. `expo-router` pinned to a different SDK line than `expo`). Check the Expo Go client version on the test device before changing SDKs.
