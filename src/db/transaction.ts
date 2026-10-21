import type { SQLiteDatabase } from 'expo-sqlite';

/** Always use the transaction handle so unrelated async writes cannot join it. */
export async function inDatabaseTransaction<T>(
  db: SQLiteDatabase,
  task: (transaction: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  let result!: T;
  if (typeof db.withExclusiveTransactionAsync === 'function') {
    await db.withExclusiveTransactionAsync(async (transaction) => { result = await task(transaction); });
  } else {
    await db.withTransactionAsync(async () => { result = await task(db); });
  }
  return result;
}
