/**
 * Safe wrapper for the expo-foreground-service native module.
 * On platforms without the native module (iOS, web), all calls are no-ops.
 */

let startFn: (() => void) | null = null;
let stopFn: (() => void) | null = null;

try {
  // Dynamic require so bundler doesn't choke on missing native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-foreground-service') as {
    startForegroundService?: () => void;
    stopForegroundService?: () => void;
  };
  if (typeof mod.startForegroundService === 'function') {
    startFn = mod.startForegroundService;
  }
  if (typeof mod.stopForegroundService === 'function') {
    stopFn = mod.stopForegroundService;
  }
} catch {
  // Module not available — no-op.
}

/** Kick off an Android foreground service to prevent process kill during streaming. */
export function startStreamingForeground(): void {
  startFn?.();
}

/** Stop the foreground service (streaming complete or errored). */
export function stopStreamingForeground(): void {
  stopFn?.();
}
