import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

type AuthStore = {
  session: Session | null;
  user: User | null;
  /** True until the initial session has been read from storage. */
  initializing: boolean;
  /** `needsEmailConfirmation` is true when the project requires confirming the address before a session is issued. */
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /**
   * Emails a 6-digit recovery code (no link — link-based recovery is unreliable because email
   * clients like Gmail/Apple Mail auto-visit links for safety scanning, which silently consumes
   * the one-time link before the user ever taps it; a code typed by hand sidesteps that entirely).
   */
  forgotPassword: (email: string) => Promise<{ error: string | null }>;
  /** Verifies the emailed recovery code, establishing a real (temporary) session. */
  verifyRecoveryCode: (email: string, code: string) => Promise<{ error: string | null }>;
  /** Requires an active session — call after `verifyRecoveryCode` succeeds. */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  /**
   * True from the moment "Forgot password?" is tapped until a new password is set. Verifying the
   * recovery code establishes a real session, which would otherwise make the root navigator's
   * guards immediately route the user into the app — skipping the "set a new password" step
   * entirely. While this is true, the root navigator keeps the user on the reset-password screen
   * regardless of session state.
   */
  passwordRecoveryActive: boolean;
  setPasswordRecoveryActive: (active: boolean) => void;
};

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);

  useEffect(() => {
    // Fast path: read the cached session from AsyncStorage so the UI isn't blank
    // while we wait for the network. setInitializing(false) happens here so that
    // the root navigator can render immediately.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);

      // Background validation: verify the JWT server-side. If the token is
      // invalid or has been revoked (not just expired — the client auto-refreshes
      // those), clear the local session so the user is routed back to sign-in.
      // We skip this when there is no local session at all to avoid an
      // unnecessary network round-trip on a fresh install.
      if (data.session) {
        supabase.auth.getUser().then(({ error }) => {
          if (error) setSession(null);
        });
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const store = useMemo<AuthStore>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        return { error: error?.message ?? null, needsEmailConfirmation: !error && !data.session };
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      forgotPassword: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        return { error: error?.message ?? null };
      },
      verifyRecoveryCode: async (email, code) => {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
        return { error: error?.message ?? null };
      },
      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });
        return { error: error?.message ?? null };
      },
      passwordRecoveryActive,
      setPasswordRecoveryActive,
    }),
    [session, initializing, passwordRecoveryActive],
  );

  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthStore {
  const store = useContext(AuthContext);
  if (!store) throw new Error('useAuth must be used within an AuthProvider');
  return store;
}
