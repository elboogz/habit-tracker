import { useAudioPlayer } from 'expo-audio';

const chimeSource = require('@/assets/sounds/chime.wav');

/**
 * Short reward chime for the core loop. Re-seeking to 0 before each play lets
 * rapid taps replay the sound instead of waiting for the previous one to finish.
 */
export function useChime() {
  const player = useAudioPlayer(chimeSource);

  return function playChime() {
    player.seekTo(0);
    player.play();
  };
}
