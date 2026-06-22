import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';

const chimeSource = require('@/assets/sounds/chime.wav');

/**
 * Short reward chime for the core loop. Re-seeking to 0 before each play lets
 * rapid taps replay the sound instead of waiting for the previous one to finish.
 */
export function useChime() {
  const player = useAudioPlayer(chimeSource);

  useEffect(() => {
    // Without this, iOS silences the chime whenever the hardware mute switch is on —
    // surprising for a sound the user explicitly opted into via the Settings toggle.
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  }, []);

  return function playChime() {
    player.seekTo(0);
    player.play();
  };
}
