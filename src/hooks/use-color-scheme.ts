import { useColorScheme as useRNColorScheme } from 'react-native';

import { useTavernStore } from '@/store/tavern-store';

/** Resolved app color scheme after applying user preference. */
export function useColorScheme(): 'light' | 'dark' {
  const systemScheme = useRNColorScheme();
  const preference = useTavernStore((state) => state.appearanceSettings.colorScheme);

  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  return systemScheme === 'light' ? 'light' : 'dark';
}
