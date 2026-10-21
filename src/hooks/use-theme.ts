/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/versions/v57.0.0/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  return Colors[scheme];
}
