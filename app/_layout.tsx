import '@/lib/crypto-polyfill';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth-store';
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
    <AuthProvider>
      <HabitStoreProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootNavigator />
          <StatusBar style="auto" />
        </ThemeProvider>
      </HabitStoreProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, initializing, passwordRecoveryActive } = useAuth();
  const { state, hydrated } = useHabitStore();

  // Wait for the session check and the local cache to hydrate before deciding which screen to
  // land on — otherwise users see a flash of the wrong screen. Skip that wait while a password
  // recovery is in progress: reset-password doesn't depend on habit-store data, and verifying a
  // recovery code changes the signed-in user, which restarts hydration (and so makes `hydrated`
  // false again) for a moment — blanking the screen here would unmount reset-password and wipe
  // its in-progress state (the entered code, whether it's been verified yet).
  if (!passwordRecoveryActive && (initializing || !hydrated)) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Takes priority over every other guard below — verifying a recovery code establishes a
          real session partway through this flow, which would otherwise make the guards below
          route the user straight into the app before they've set a new password. */}
      <Stack.Protected guard={passwordRecoveryActive}>
        <Stack.Screen name="reset-password" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session && !passwordRecoveryActive}>
        <Stack.Screen name="sign-in" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !state.hasOnboarded && !passwordRecoveryActive}>
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session && state.hasOnboarded && !passwordRecoveryActive}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="habit-form"
          options={{ presentation: 'modal', headerShown: true, title: 'Habit', headerBackTitle: 'Cancel' }}
        />
        <Stack.Screen name="habit/[id]" options={{ headerShown: true }} />
      </Stack.Protected>
    </Stack>
  );
}
