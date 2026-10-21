import type { SQLiteDatabase } from 'expo-sqlite';

import type { MemoryRow } from '@/db/types';

export async function upsertMemory(db: SQLiteDatabase, row: MemoryRow) {
  await db.runAsync(
    'INSERT INTO memories ' +
      '(id, novel_id, world_id, memory_type, content, source_message_id, source_chapter_id, source_type, source_id, state_version, confidence, stale, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET content = excluded.content, memory_type = excluded.memory_type, ' +
      'source_message_id = excluded.source_message_id, source_chapter_id = excluded.source_chapter_id, ' +
      'source_type = excluded.source_type, source_id = excluded.source_id, ' +
      'state_version = excluded.state_version, confidence = excluded.confidence, ' +
      'stale = excluded.stale, ' +
      'updated_at = excluded.updated_at',
    row.id,
    row.novelId,
    row.worldId ?? 'legacy',
    row.memoryType,
    row.content,
    row.sourceMessageId,
    row.sourceChapterId,
    row.sourceType ?? 'legacy',
    row.sourceId ?? row.sourceMessageId ?? row.sourceChapterId ?? null,
    row.stateVersion ?? 0,
    row.confidence ?? 1,
    row.stale,
    row.createdAt,
    row.updatedAt,
  );
}

export type ConversationMemoryState = {
  longTermMemory: string;
  midTermMemories: string[];
  shortTermMemories: string[];
};

export type ReplaceConversationMemoriesOptions = {
  sourceMessageId?: string | null;
  updatedAt?: string;
  stale?: boolean;
};

/**
 * Replace the aggregate memory projection for one novel/world pair.
 * The caller must invoke this inside its transaction; this function does not
 * open or commit a transaction itself.
 */
export async function replaceConversationMemories(
  db: SQLiteDatabase,
  novelId: string,
  worldId: string,
  state: ConversationMemoryState,
  options?: ReplaceConversationMemoriesOptions,
) {
  const existing = await db.getAllAsync<{ id: string; memoryType: string }>(
    'SELECT id, memory_type AS memoryType FROM memories WHERE novel_id = ? AND world_id = ?',
    novelId,
    worldId,
  );
  const aggregateIds = existing
    .filter(({ memoryType }) => /^(?:long_term|mid_term(?:_\d+)?|short_term(?:_\d+)?)$/.test(memoryType))
    .map(({ id }) => id);
  for (const id of aggregateIds) {
    await db.runAsync('DELETE FROM memories WHERE id = ?', id);
  }

  const updatedAt = options?.updatedAt ?? new Date().toISOString();
  const sourceMessageId = options?.sourceMessageId ?? null;
  const stale = options?.stale === true ? 1 : 0;
  const stateVersion = Date.now();
  const write = async (memoryType: string, content: string) => {
    if (!content.trim()) return;
    await upsertMemory(db, {
      id: `conversation-memory:${JSON.stringify([novelId, worldId, memoryType])}`,
      novelId,
      worldId,
      memoryType,
      content,
      sourceMessageId,
      sourceChapterId: null,
      sourceType: 'conversation-memory',
      sourceId: sourceMessageId,
      stateVersion,
      confidence: 0.8,
      stale,
      createdAt: updatedAt,
      updatedAt,
    });
  };

  await write('long_term', state.longTermMemory);
  for (const [index, content] of state.midTermMemories.entries()) {
    await write(`mid_term_${index}`, content);
  }
  for (const [index, content] of state.shortTermMemories.entries()) {
    await write(`short_term_${index}`, content);
  }
}

export async function listMemories(
  db: SQLiteDatabase,
  novelId: string,
  options?: { memoryType?: string; includeStale?: boolean; limit?: number; worldId?: string },
) {
  const limit = Math.max(1, Math.min(500, Math.round(options?.limit ?? 100)));
  const includeStale = options?.includeStale === true;
  const clauses = ['novel_id = ?'];
  const params: (string | number)[] = [novelId];
  if (options?.worldId) {
    clauses.push('world_id = ?');
    params.push(options.worldId);
  }
  if (!includeStale) clauses.push('stale = 0');
  if (options?.memoryType) {
    clauses.push('memory_type = ?');
    params.push(options.memoryType);
  }
  params.push(limit);
  return db.getAllAsync<MemoryRow>(
    'SELECT id, novel_id AS novelId, world_id AS worldId, memory_type AS memoryType, content, ' +
      'source_message_id AS sourceMessageId, source_chapter_id AS sourceChapterId, ' +
      'source_type AS sourceType, source_id AS sourceId, state_version AS stateVersion, ' +
      'confidence, stale, created_at AS createdAt, updated_at AS updatedAt FROM memories ' +
      `WHERE ${clauses.join(' AND ')} ORDER BY state_version DESC, updated_at DESC LIMIT ?`,
    ...params,
  );
}

export async function markMemoriesStaleByChapter(
  db: SQLiteDatabase,
  novelId: string,
  chapterId: string,
  updatedAt: string,
) {
  await db.runAsync(
    'UPDATE memories SET stale = 1, updated_at = ? WHERE novel_id = ? AND source_chapter_id = ?',
    updatedAt,
    novelId,
    chapterId,
  );
}


/** Editing a turn invalidates every aggregate derived from the prior conversation line. */
export async function markMemoriesStaleByWorld(
  db: SQLiteDatabase,
  novelId: string,
  worldId: string,
  updatedAt: string,
) {
  await db.runAsync(
    'UPDATE memories SET stale = 1, updated_at = ? WHERE novel_id = ? AND world_id = ? AND stale = 0',
    updatedAt,
    novelId,
    worldId,
  );
}
