import ExpoForegroundServiceModule from './ExpoForegroundServiceModule';

/**
 * Start an Android foreground service to keep the app alive during
 * long-running streaming requests.
 *
 * Shows a persistent notification "AI 正在生成..." while the service runs.
 * Call `stopForegroundService()` when streaming completes.
 *
 * Safe to call on iOS -- returns immediately without effect.
 */
export function startForegroundService(): void {
  ExpoForegroundServiceModule.startForegroundService();
}

/**
 * Stop the Android foreground service and dismiss the notification.
 * Safe to call even if the service wasn't started.
 */
export function stopForegroundService(): void {
  ExpoForegroundServiceModule.stopForegroundService();
}
