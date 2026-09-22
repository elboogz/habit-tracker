import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  /** Product Polish Step 4: 'card' resolves the `surface` token instead of `background` -- the
   * shared card/surface treatment. Border colour/width are left to the caller, as before; this
   * only supplies the tonal fill (see docs/implementation-roadmap.md's Product Polish
   * card-hierarchy ruling -- border stays the structural separator, surface is a secondary cue). */
  variant?: 'default' | 'card';
};

export function ThemedView({ style, lightColor, darkColor, variant = 'default', ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    variant === 'card' ? 'surface' : 'background',
  );

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
