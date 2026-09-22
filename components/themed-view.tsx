import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  /** Product Polish Step 4: 'card' resolves `surface` (ordinary cards); 'accent' resolves
   * `tintSoft` (hero/coach/state surfaces); 'transparent' paints no fill at all -- for nested
   * layout wrappers that must let a parent card/accent surface show through instead of painting
   * their own `background` (see docs/implementation-roadmap.md's Product Polish card-hierarchy
   * ruling, and the Step 4 visual-correction pass that found nested default-variant ThemedViews
   * were covering most of each card with `background`). useThemeColor below is still called
   * unconditionally on every render -- only which colour name it resolves, and whether that
   * result is actually applied, varies by variant, so this never violates the Rules of Hooks. */
  variant?: 'default' | 'card' | 'accent' | 'transparent';
};

function colorNameForVariant(variant: NonNullable<ThemedViewProps['variant']>) {
  switch (variant) {
    case 'card':
      return 'surface';
    case 'accent':
      return 'tintSoft';
    case 'transparent':
    case 'default':
    default:
      return 'background';
  }
}

export function ThemedView({ style, lightColor, darkColor, variant = 'default', ...otherProps }: ThemedViewProps) {
  const resolvedColor = useThemeColor({ light: lightColor, dark: darkColor }, colorNameForVariant(variant));
  const backgroundColor = variant === 'transparent' ? 'transparent' : resolvedColor;

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
