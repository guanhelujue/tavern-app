/**
 * V1 deliberately keeps Web on AsyncStorage. Keeping this platform entry free
 * of an expo-sqlite import prevents Metro from resolving wa-sqlite.wasm.
 */
export type WebDatabase = never;

export function getAppDatabase(): Promise<never> {
  return Promise.reject(
    new Error('SQLite 仅在 Android/iOS 启用；Web 继续使用兼容存储。'),
  );
}

