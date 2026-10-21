import { Platform } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_NAME, migrateDatabase } from '@/db/migrations';

let databasePromise: Promise<SQLiteDatabase> | null = null;

/** Opens and migrates the native database once per JS process. */
export function getAppDatabase() {
  if (Platform.OS === 'web') {
    return Promise.reject(
      new Error('SQLite 仅在 Android/iOS 启用；Web 继续使用兼容存储。'),
    );
  }

  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME)
      .then(async (db) => {
        await migrateDatabase(db);
        return db;
      })
      .catch((error) => {
        databasePromise = null;
        throw error;
      });
  }

  return databasePromise;
}

