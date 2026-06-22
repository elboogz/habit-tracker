import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alertMessage } from '@/lib/confirm';
import { useAuth } from '@/lib/auth-store';

export default function SignInScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signIn, signUp, forgotPassword, setPasswordRecoveryActive } = useAuth();

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'signUp';

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      alertMessage('Enter your email', 'Type your email address above first, then tap "Forgot password?" again.');
      return;
    }

    setBusy(true);
    const { error } = await forgotPassword(trimmedEmail);
    setBusy(false);

    if (error) {
      alertMessage("Couldn't send reset email", error);
      return;
    }
    setPasswordRecoveryActive(true);
    router.push({ pathname: '/reset-password', params: { email: trimmedEmail } });
  }

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      alertMessage('Missing info', 'Enter both an email and a password.');
      return;
    }

    setBusy(true);
    const result = isSignUp ? await signUp(trimmedEmail, password) : await signIn(trimmedEmail, password);
    setBusy(false);

    if (result.error) {
      alertMessage(isSignUp ? "Couldn't sign up" : "Couldn't sign in", result.error);
      return;
    }

    // If the project doesn't require email confirmation, signUp already returns a live
    // session — the root navigator picks that up and moves on, nothing to do here.
    if (isSignUp && 'needsEmailConfirmation' in result && result.needsEmailConfirmation) {
      alertMessage('Check your email', 'Confirm your address using the link we sent, then sign in.');
      setMode('signIn');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          <ThemedView style={{ gap: 6 }}>
            <ThemedText type="title">{isSignUp ? 'Create an account' : 'Welcome back'}</ThemedText>
            <ThemedText style={{ color: colors.icon }}>
              {isSignUp
                ? 'Your habits sync to this account and stay backed up across devices.'
                : 'Sign in to pick up your habits where you left off.'}
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Email</ThemedText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.icon}
              style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
            />
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="defaultSemiBold">Password</ThemedText>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
              placeholderTextColor={colors.icon}
              style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
              autoCapitalize="none"
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </ThemedView>

          {!isSignUp && (
            <Pressable onPress={handleForgotPassword} disabled={busy} style={styles.forgotPasswordButton}>
              <ThemedText style={{ color: colors.tint, fontSize: 13 }}>Forgot password?</ThemedText>
            </Pressable>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: colors.tint },
              (pressed || busy) && { opacity: 0.6 },
            ]}>
            {busy ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <ThemedText style={{ color: colors.background, fontWeight: '600', fontSize: 16 }}>
                {isSignUp ? 'Sign up' : 'Sign in'}
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={() => setMode(isSignUp ? 'signIn' : 'signUp')}
            disabled={busy}
            style={styles.switchModeButton}>
            <ThemedText style={{ color: colors.icon }}>
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: 24 },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
  },
  section: {
    gap: 8,
  },
  input: {
    fontSize: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  switchModeButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  forgotPasswordButton: {
    alignItems: 'flex-end',
  },
});
