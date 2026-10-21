/**
 * Semantic application theme for the AI fiction studio.
 * Expo SDK 57 color-scheme guidance:
 * https://docs.expo.dev/versions/v57.0.0/guides/color-schemes/
 */

import '@/global.css';

import { Platform, StyleSheet } from 'react-native';

export type ThemePalette = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  surfaceElevated: string;
  outline: string;
  outlineVariant: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  error: string;
  errorContainer: string;
  warning: string;
  warningContainer: string;
  success: string;
  successContainer: string;
  scrim: string;
  shadow: string;
  buttonPrimary: string;
  buttonPrimaryPressed: string;
  buttonDisabled: string;
  buttonText: string;
  buttonTextDisabled: string;
  // Compatibility aliases used by existing screens during the semantic migration.
  accent: string;
  accentMuted: string;
  backgroundElement: string;
  backgroundSelected: string;
  border: string;
};

type PaletteSeed = Omit<
  ThemePalette,
  | 'accent'
  | 'accentMuted'
  | 'backgroundElement'
  | 'backgroundSelected'
  | 'border'
  | 'buttonPrimary'
  | 'buttonText'
>;

function palette(seed: PaletteSeed): ThemePalette {
  return {
    ...seed,
    buttonPrimary: seed.primary,
    buttonText: seed.onPrimary,
    accent: seed.primary,
    accentMuted: seed.primaryContainer,
    backgroundElement: seed.surfaceVariant,
    backgroundSelected: seed.primaryContainer,
    border: seed.outlineVariant,
  };
}

export type ThemeModeColors = { light: ThemePalette; dark: ThemePalette };

export const Colors: ThemeModeColors = {
  light: palette({
    primary: '#79543A', onPrimary: '#FFFFFF', primaryContainer: '#F0E0D2', onPrimaryContainer: '#392315',
    secondary: '#5F625A', onSecondary: '#FFFFFF', secondaryContainer: '#E5E7DF',
    tertiary: '#8A6840', onTertiary: '#FFFFFF',
    background: '#F7F4EF', surface: '#FFFCF8', surfaceVariant: '#EFEAE3', surfaceElevated: '#FFFFFF',
    outline: '#8B8178', outlineVariant: '#D9D1C8',
    text: '#211C18', textSecondary: '#625B55', textMuted: '#827970', textDisabled: '#A9A19A',
    error: '#B3261E', errorContainer: '#F9DEDC', warning: '#8A5A00', warningContainer: '#F6E7C1',
    success: '#386A45', successContainer: '#D7EBDD',
    scrim: 'rgba(28, 22, 18, 0.46)', shadow: '#2B2018',
    buttonPrimaryPressed: '#62422D', buttonDisabled: '#E5E0DA', buttonTextDisabled: '#938C85',
  }),
  dark: palette({
    primary: '#D5AE8C', onPrimary: '#3F2717', primaryContainer: '#553924', onPrimaryContainer: '#F4DDCA',
    secondary: '#C5C8BD', onSecondary: '#2E312B', secondaryContainer: '#42463E',
    tertiary: '#E0BF8B', onTertiary: '#402D0A',
    background: '#12100F', surface: '#1A1816', surfaceVariant: '#24211E', surfaceElevated: '#2B2824',
    outline: '#A69B91', outlineVariant: '#4D4640',
    text: '#EEE9E4', textSecondary: '#C8C0B8', textMuted: '#9E958D', textDisabled: '#6E6862',
    error: '#FFB4AB', errorContainer: '#5F201D', warning: '#F2C66D', warningContainer: '#503C0D',
    success: '#A5D6AE', successContainer: '#1F4A2C',
    scrim: 'rgba(4, 3, 3, 0.68)', shadow: '#000000',
    buttonPrimaryPressed: '#E3BE9D', buttonDisabled: '#34312E', buttonTextDisabled: '#77716B',
  }),
};

export type ColorSchemePreference = 'system' | 'light' | 'dark';
export const COLOR_SCHEME_OPTIONS = [
  { value: 'system', label: '跟随系统', description: '与手机浅色 / 深色模式同步' },
  { value: 'light', label: '浅色', description: '始终使用浅色界面' },
  { value: 'dark', label: '深色', description: '始终使用深色界面' },
] satisfies { value: ColorSchemePreference; label: string; description: string }[];

export const DEFAULT_COLOR_SCHEME_PREFERENCE: ColorSchemePreference = 'system';

export type ThemeColor = keyof ThemePalette;
export const Fonts = Platform.select({
  ios: { sans: 'NotoSansSC', serif: 'NotoSerifSC', rounded: 'NotoSansSC', mono: 'ui-monospace' },
  android: { sans: 'NotoSansSC', serif: 'NotoSerifSC', rounded: 'NotoSansSC', mono: 'monospace' },
  default: { sans: 'NotoSansSC', serif: 'NotoSerifSC', rounded: 'NotoSansSC', mono: 'monospace' },
  web: { sans: 'var(--font-display)', serif: 'var(--font-serif)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
});

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const;
export const Radius = { small: 8, medium: 12, large: 18, xlarge: 26, full: 999 } as const;
export const Motion = { quick: 140, standard: 220, emphasized: 360 } as const;
export const Stroke = { hairline: StyleSheet.hairlineWidth, regular: 1, strong: 2 } as const;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const Layout = {
  pageGutter: Spacing.four,
  pageTop: Spacing.four,
  pageBottom: BottomTabInset + Spacing.six,
  readingWidth: 680,
  workspaceWidth: 1080,
} as const;

export const MaxContentWidth = 880;
