import { AppOpeningMark, AppOpeningSequence } from '@/components/app-opening-sequence';

export function AnimatedSplashOverlay({ enabled = true }: { enabled?: boolean }) {
  return <AppOpeningSequence enabled={enabled} />;
}

export const AnimatedIcon = AppOpeningMark;
