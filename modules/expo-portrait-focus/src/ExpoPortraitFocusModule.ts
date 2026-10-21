import { requireNativeModule } from 'expo-modules-core';

export type NativePortraitFocus = {
  eyeX: number;
  eyeY: number;
  confidence: number;
  detector: 'mlkit' | 'opencv';
};

type ExpoPortraitFocusModuleInterface = {
  detect: (uri: string) => Promise<NativePortraitFocus | null>;
};

/** Android-only detector with a no-op fallback for web and iOS builds. */
let nativeModule: ExpoPortraitFocusModuleInterface;

try {
  nativeModule = requireNativeModule<ExpoPortraitFocusModuleInterface>('ExpoPortraitFocus');
} catch {
  nativeModule = {
    async detect() {
      return null;
    },
  };
}

export default nativeModule;
