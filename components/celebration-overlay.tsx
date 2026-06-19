import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';

export type Celebration = {
  /** Bumped on every fire so repeat celebrations always restart the animation. */
  key: number;
  emoji: string;
  message: string;
  /** Bigger, longer burst — reserved for challenge completions. */
  big?: boolean;
};

const PARTICLE_ANGLES = [-100, -65, -35, -12, 12, 35, 65, 100, -80, 80];

function Particle({ progress, angle, emoji, big }: { progress: SharedValue<number>; angle: number; emoji: string; big?: boolean }) {
  const distance = big ? 160 : 100;
  const style = useAnimatedStyle(() => {
    const radians = (angle * Math.PI) / 180;
    const travel = interpolate(progress.value, [0, 1], [0, distance]);
    return {
      opacity: interpolate(progress.value, [0, 0.15, 0.7, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: Math.sin(radians) * travel },
        { translateY: -Math.cos(radians) * travel },
        { scale: interpolate(progress.value, [0, 0.2, 1], [0.3, big ? 1.3 : 1, 0.8]) },
      ],
    };
  });

  return (
    <Animated.Text style={[styles.particle, style]} pointerEvents="none">
      {emoji}
    </Animated.Text>
  );
}

/**
 * Full-bleed reward burst for the core loop: emoji particles fan out from the
 * center while a message pops in and settles, then everything fades away.
 */
export function CelebrationOverlay({
  celebration,
  onDone,
}: {
  celebration: Celebration | null;
  onDone: () => void;
}) {
  const progress = useSharedValue(0);
  const messageScale = useSharedValue(0);

  useEffect(() => {
    if (!celebration) return;

    const duration = celebration.big ? 1500 : 1000;
    progress.value = 0;
    messageScale.value = 0;
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });
    messageScale.value = withTiming(
      1,
      { duration: 260, easing: Easing.out(Easing.back(1.8)) },
      (finished) => {
        if (!finished) return;
        messageScale.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(onDone)();
        });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.key]);

  const messageStyle = useAnimatedStyle(() => ({
    opacity: messageScale.value,
    transform: [{ scale: interpolate(messageScale.value, [0, 1], [0.6, 1]) }],
  }));

  if (!celebration) return null;

  const particleCount = celebration.big ? PARTICLE_ANGLES.length : Math.ceil(PARTICLE_ANGLES.length / 2);

  return (
    <Animated.View style={styles.overlay} pointerEvents="none">
      <Animated.View style={styles.center}>
        {PARTICLE_ANGLES.slice(0, particleCount).map((angle, index) => (
          <Particle key={index} progress={progress} angle={angle} emoji={celebration.emoji} big={celebration.big} />
        ))}
        <Animated.View style={[styles.messageBubble, messageStyle]}>
          <ThemedText type="defaultSemiBold" style={styles.messageText}>
            {celebration.message}
          </ThemedText>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    fontSize: 32,
  },
  messageBubble: {
    backgroundColor: 'rgba(10, 126, 164, 0.92)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});
