/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Product Polish Step 2 (docs/implementation-roadmap.md's "Product Polish" section):
// tint and light background re-valued from the mockups' warm cream / muted sage palette;
// surface and tintSoft are new. Dark background stays the pre-existing near-black -- no
// mockup evidence covers dark mode, so it was left alone rather than guessed at.
const tintColorLight = '#587058';
const tintColorDark = '#8FBF95';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#FAF7F2',
    surface: '#FFFFFF',
    tint: tintColorLight,
    tintSoft: '#E9F0E6',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    surface: '#1E2120',
    tint: tintColorDark,
    tintSoft: '#26302A',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

// Product Polish Step 2: decorative habit-badge background accents, selected per-habit via a
// deterministic hash of habit.id (not index -- see docs/implementation-roadmap.md's Product
// Polish ruling). Sampled from the mockups' pastel badge circles; dark values are a fresh,
// desaturated/darkened adaptation since the mockups are light-theme only.
export const BADGE_ACCENTS = {
  light: ['#D8E0F0', '#F0D8C8', '#B0C0A8', '#F0E0B8'],
  dark: ['#2E3B4A', '#4A3B32', '#3A4536', '#4A4230'],
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
