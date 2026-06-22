import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-store';
import { alertMessage } from '@/lib/confirm';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { session, verifyRecoveryCode, updatePassword, setPasswordRecoveryActive, signOut } = useAuth();
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleVerifyCode() {
    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !trimmedCode) {
      alertMessage('Missing info', 'Enter the email and the code from your reset email.');
      return;
    }

    setBusy(true);
    const { error } = await verifyRecoveryCode(trimmedEmail, trimmedCode);
    setBusy(false);

    if (error) {
      alertMessage("Couldn't verify code", error);
      return;
    }
    setVerified(true);
  }

  async function handleUpdatePassword() {
    if (password.length < 6) {
      alertMessage('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      alertMessage("Passwords don't match", 'Make sure both fields are the same.');
      return;
    }

    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);

    if (error) {
      alertMessage("Couldn't update password", error);
      return;
    }
    setPasswordRecoveryActive(false);
    setDone(true);
  }

  async function handleCancel() {
    setPasswordRecoveryActive(false);
    // Verifying the code already established a real session — discard it on cancel so we land
    // back on sign-in instead of into the app with the (unchanged) old password still active.
    // Check the actual session (not local `verified` state) — this screen can remount mid-flow
    // (verifying a recovery code changes the signed-in user, which restarts habit-store
    // hydration), which would reset `verified` to false while the session is still very real.
    if (session) await signOut();
    router.replace('/sign-in');
  }

  if (done) {
    return <Redirect href="/" />;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.content}>
          {!verified ? (
            <>
              <ThemedView style={{ gap: 6 }}>
                <ThemedText type="title">Enter your reset code</ThemedText>
                <ThemedText style={{ color: colors.icon }}>
                  We emailed a code to the address below. Enter it to continue.
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
                <ThemedText type="defaultSemiBold">Code</ThemedText>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="Code from your email"
                  placeholderTextColor={colors.icon}
                  style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleVerifyCode}
                />
              </ThemedView>

              <Pressable
                onPress={handleVerifyCode}
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
                    Verify code
                  </ThemedText>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <ThemedView style={{ gap: 6 }}>
                <ThemedText type="title">Set a new password</ThemedText>
                <ThemedText style={{ color: colors.icon }}>Choose a new password for your account.</ThemedText>
              </ThemedView>

              <ThemedView style={styles.section}>
                <ThemedText type="defaultSemiBold">New password</ThemedText>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.icon}
                  style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                  autoCapitalize="none"
                  secureTextEntry
                  returnKeyType="next"
                />
              </ThemedView>

              <ThemedView style={styles.section}>
                <ThemedText type="defaultSemiBold">Confirm password</ThemedText>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your new password"
                  placeholderTextColor={colors.icon}
                  style={[styles.input, { color: colors.text, borderColor: colors.icon }]}
                  autoCapitalize="none"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleUpdatePassword}
                />
              </ThemedView>

              <Pressable
                onPress={handleUpdatePassword}
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
                    Update password
                  </ThemedText>
                )}
              </Pressable>
            </>
          )}

          <Pressable onPress={handleCancel} disabled={busy} style={styles.cancelButton}>
            <ThemedText style={{ color: colors.icon }}>Cancel</ThemedText>
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
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});
