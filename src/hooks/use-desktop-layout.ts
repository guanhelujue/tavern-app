import { Platform } from 'react-native';

/** Web uses the workspace at every width; native apps keep their mobile UI. */
export function useDesktopLayout() {
  return Platform.OS === 'web';
}
