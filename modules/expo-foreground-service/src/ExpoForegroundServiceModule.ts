import { requireNativeModule } from 'expo-modules-core';

/**
 * Native interface exposed by the Android foreground service module.
 * On iOS this module is not registered and calls are no-ops.
 */
interface ExpoForegroundServiceModuleInterface {
  startForegroundService(): void;
  stopForegroundService(): void;
  updateNotification(title: string, text: string): void;
}

// On iOS the native module won't exist, so provide a fallback.
let nativeModule: ExpoForegroundServiceModuleInterface;

try {
  nativeModule = requireNativeModule<ExpoForegroundServiceModuleInterface>(
    'ExpoForegroundService',
  );
} catch {
  nativeModule = {
    startForegroundService() {},
    stopForegroundService() {},
    updateNotification() {},
  };
}

export default nativeModule;
