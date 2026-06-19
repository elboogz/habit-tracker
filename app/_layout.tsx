import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { HabitStoreProvider, useHabitStore } from '@/lib/habit-store';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Show reminder notifications even while the app is open in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <HabitStoreProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </HabitStoreProvider>
  );
}

function RootNavigator() {
  const { state, hydrated } = useHabitStore();

  // Wait for AsyncStorage to hydrate before deciding on onboarding vs. tabs —
  // otherwise returning users would see a flash of the onboarding flow.
  if (!hydrated) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!state.hasOnboarded}>
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.hasOnboarded}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Screen
        name="habit-form"
        options={{ presentation: 'modal', headerShown: true, title: 'Habit', headerBackTitle: 'Cancel' }}
      />
      <Stack.Screen name="habit/[id]" options={{ headerShown: true }} />
    </Stack>
  );
}
