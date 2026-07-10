import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // AsyncStorage's web shim touches `window` with no guard, which crashes Expo
    // Router's server render pass (Node, no `window`). Web falls back to
    // supabase-js's own default storage (localStorage).
    //
    // Accepted risk: localStorage is readable by any JS on the page, making
    // session tokens XSS-accessible on web. This is acceptable because:
    //   1. The app has no HTML rendering (no dangerouslySetInnerHTML, no v-html),
    //      so there is no XSS attack surface to exploit it today.
    //   2. The web build is a secondary target; native (AsyncStorage, app-sandboxed)
    //      is the primary deployment.
    // If a future change introduces user-generated HTML rendering, switch to
    // cookie-based storage (supabase-js CookieStorage or an httpOnly proxy).
    ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE means the password-recovery email link carries a `code`, not a usable session
    // directly — completing it requires the code_verifier stored locally on this device.
    // That's what stops email-client link-prefetching (Gmail/Apple Mail scanning links for
    // safety) from silently consuming the one-time recovery link before the user taps it.
    flowType: 'pkce',
  },
});

// Supabase recommends pausing the auth token auto-refresh timer while the app
// is backgrounded, otherwise it keeps firing refresh calls for no one to see.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
