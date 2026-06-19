# Habit Tracker

A mobile habit-tracking app built with Expo (React Native), targeting iOS and Android.

## Features

- **Today screen** — check off habits daily with haptic + sound + particle-burst feedback
- **Progress screen** — streaks, consistency heatmaps, last 7 or 14 days
- **Challenges** — start a multi-habit challenge (e.g. 3-day or 7-day), track completion, view history
- **Reminders** — local daily notifications, global or per-habit reminder times
- **Onboarding** — first-run flow that frames your first habit as a 3-day challenge

## Tech stack

- [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/) + Expo Router (file-based routing)
- React Native + TypeScript
- AsyncStorage for persistence (no backend)
- expo-notifications for local reminders
- expo-haptics + expo-audio for reward feedback

## Getting started

```bash
npm install
npx expo start
```

Scan the QR code with the [Expo Go](https://expo.dev/go) app on your phone, or press `i` / `a` to open in an iOS simulator or Android emulator.

## Project structure

```
app/
  (tabs)/         # Bottom nav: Today, Progress, Challenges, Settings
  habit-form.tsx  # Create / edit habit modal
  habit/[id].tsx  # Habit detail & history
  onboarding.tsx  # First-run flow
lib/
  habit-store.tsx # Global state (Context + useReducer + AsyncStorage)
  habit-stats.ts  # Pure derived-state helpers (streaks, consistency, challenge progress)
  habit-types.ts  # TypeScript types
  notifications.ts# Local notification scheduling
components/       # Shared UI components
constants/        # Theme colors and fonts
```

## Commands

| Command | Description |
|---|---|
| `npx expo start` | Start the Metro dev server |
| `npm run ios` | Open in iOS simulator |
| `npm run android` | Open in Android emulator |
| `npm run lint` | Run ESLint |
