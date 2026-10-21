import * as SplashScreen from 'expo-splash-screen';

import { AppOpeningMark, AppOpeningSequence } from '@/components/app-opening-sequence';

export function AnimatedSplashOverlay({ enabled = true }: { enabled?: boolean }) {
  return <AppOpeningSequence enabled={enabled} onReady={() => SplashScreen.hideAsync()} />;
}

export const AnimatedIcon = AppOpeningMark;
