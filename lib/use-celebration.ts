import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';

import type { Celebration } from '@/components/celebration-overlay';
import { useChime } from './use-chime';

let nextKey = 1;

/**
 * Fires the three-part core-loop reward together: haptic pulse, chime, and a
 * visual particle burst. `big` is reserved for challenge-completion moments so
 * they read as a clear step up from a routine daily check-in.
 */
export function useCelebration(soundEnabled = true) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const playChime = useChime();
  const playChimeRef = useRef(playChime);
  playChimeRef.current = playChime;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const fire = useCallback((emoji: string, message: string, big = false) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (big) {
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 180);
    }
    if (soundEnabledRef.current) playChimeRef.current();
    setCelebration({ key: nextKey++, emoji, message, big });
  }, []);

  const clear = useCallback(() => setCelebration(null), []);

  return { celebration, fire, clear };
}
