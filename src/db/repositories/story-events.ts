import type { SQLiteDatabase } from 'expo-sqlite';

import type { StoryEventRow } from '@/db/types';

export type AppendStoryEventInput = Omit<StoryEventRow, 'sequence'>;

async function inTransaction<T>(db: SQLiteDatabase, task: (transaction: SQLiteDatabase) => Promise<T>) {
  const exclusive = db as SQLiteDatabase & {
    withExclusiveTransactionAsync?: (callback: (transaction: SQLiteDatabase) => Promise<void>) => Promise<void>;
  };
  if (typeof exclusive.withExclusiveTransactionAsync === 'function') {
    let result!: T;
    await exclusive.withExclusiveTransactionAsync(async (transaction) => {
      result = await task(transaction);
    });
    return result;
  }
  if (typeof db.withTransactionAsync === 'function') {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  }
  return task(db);
}

/**
 * Append using an already-owned transaction. Callers composing a larger atomic
 * command must use this entry point so no nested transaction can escape the
 * command boundary.
 */
export async function appendStoryEventInTransaction(
  transaction: SQLiteDatabase,
  row: AppendStoryEventInput,
) {
    const existing = await transaction.getFirstAsync<{ sequence: number }>(
      'SELECT sequence FROM story_events WHERE id = ?',
      row.id,
    );
    if (existing) return Number(existing.sequence);

    const next = await transaction.getFirstAsync<{ sequence: number }>(
      'SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM story_events WHERE novel_id = ?',
      row.novelId,
    );
    const sequence = Number(next?.sequence ?? 0);
    await transaction.runAsync(
      'INSERT INTO story_events ' +
        '(id, novel_id, chapter_id, sequence, event_type, payload_json, source_message_id, created_at, ' +
        'canon_revision, chapter_revision_id, causation_id, correlation_id, supersedes_event_id) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id,
      row.novelId,
      row.chapterId,
      sequence,
      row.eventType,
      row.payloadJson,
      row.sourceMessageId,
      row.createdAt,
      row.canonRevision ?? 0,
      row.chapterRevisionId ?? null,
      row.causationId ?? null,
      row.correlationId ?? null,
      row.supersedesEventId ?? null,
    );
    return sequence;
}

/** Append an event once; the sequence is allocated by SQLite inside a transaction. */
export async function appendStoryEvent(db: SQLiteDatabase, row: AppendStoryEventInput) {
  return inTransaction(db, (transaction) => appendStoryEventInTransaction(transaction, row));
}

const EVENT_COLUMNS =
  'id, novel_id AS novelId, chapter_id AS chapterId, sequence, event_type AS eventType, ' +
  'payload_json AS payloadJson, source_message_id AS sourceMessageId, created_at AS createdAt, ' +
  'canon_revision AS canonRevision, chapter_revision_id AS chapterRevisionId, ' +
  'causation_id AS causationId, correlation_id AS correlationId, supersedes_event_id AS supersedesEventId';


export async function listStoryEvents(
  db: SQLiteDatabase,
  novelId: string,
  options?: { limit?: number; afterSequence?: number; beforeSequence?: number },
) {
  const limit = Math.max(1, Math.min(500, Math.round(options?.limit ?? 100)));
  if (typeof options?.afterSequence === 'number' && typeof options?.beforeSequence === 'number') {
    throw new Error('afterSequence and beforeSequence are mutually exclusive');
  }
  if (typeof options?.afterSequence === 'number') {
    return db.getAllAsync<StoryEventRow>(
      `SELECT ${EVENT_COLUMNS} FROM story_events WHERE novel_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
      novelId,
      Math.floor(options.afterSequence),
      limit,
    );
  }
  if (typeof options?.beforeSequence === 'number') {
    return db.getAllAsync<StoryEventRow>(
      `SELECT ${EVENT_COLUMNS} FROM story_events WHERE novel_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?`,
      novelId,
      Math.floor(options.beforeSequence),
      limit,
    );
  }
  return db.getAllAsync<StoryEventRow>(
    `SELECT ${EVENT_COLUMNS} FROM story_events WHERE novel_id = ? ORDER BY sequence ASC LIMIT ?`,
    novelId,
    limit,
  );
}
