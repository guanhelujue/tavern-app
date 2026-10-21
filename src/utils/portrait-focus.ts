import PortraitFocusModule, {
  type NativePortraitFocus,
} from 'expo-portrait-focus';

import { resolvePortraitDisplayUri } from '@/utils/character-card-portraits';
import {
  normalizePortraitFocus,
  type PortraitFocus,
} from '@/utils/portrait-focus.shared';

export * from '@/utils/portrait-focus.shared';

/**
 * Native baseline used by Android/iOS bundles. The Web implementation lives
 * in `portrait-focus.web.ts`, so Metro never resolves OpenCV for native apps.
 */
export async function detectPortraitFocus(
  portraitUri?: string | null,
  gender?: string | null,
): Promise<PortraitFocus | undefined> {
  const displayUri = resolvePortraitDisplayUri(portraitUri, gender);
  if (!displayUri) {
    return undefined;
  }
  try {
    return normalizePortraitFocus(
      (await PortraitFocusModule.detect(displayUri)) as NativePortraitFocus | null,
    );
  } catch {
    return undefined;
  }
}
