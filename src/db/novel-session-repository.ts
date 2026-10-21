import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertMessage } from '@/db/repositories/messages';
import { replaceConversationMemories } from '@/db/repositories/memories';
import { normalizeNovelSlotBook } from '@/utils/novel-slots';
import type { Message, NovelConversation, NovelSlotBook } from '@/types/tavern';

/** Full history for backups/checkpoints; never use the reader's paginated cache. */
export async function readAllSessionMessages(db: SQLiteDatabase, novelId: string, worldId?: string): Promise<Message[]> {
  return db.getAllAsync<Message>(
    `SELECT id, novel_id AS characterId, world_id AS worldId, role, content,
      reasoning_content AS reasoningContent, status, created_at AS createdAt, updated_at AS updatedAt,
      prompt_tokens AS promptTokens, completion_tokens AS completionTokens, model_id AS modelId
     FROM messages WHERE novel_id = ?${worldId === undefined ? '' : ' AND world_id = ?'}
     ORDER BY world_id ASC, sequence_no ASC`,
    ...[novelId, ...(worldId === undefined ? [] : [worldId])],
  );
}

/** Caller owns the transaction. Other worlds and novels are never replaced. */
export async function replaceSessionMessages(db: SQLiteDatabase, novelId: string, worldId: string, messages: Message[]) {
  const ids = new Set<string>();
  for (const message of messages) {
    if (ids.has(message.id)) throw new Error('会话包含重复的消息标识。');
    ids.add(message.id);
    const owner = await db.getFirstAsync<{ novelId: string; worldId: string }>(
      'SELECT novel_id AS novelId, world_id AS worldId FROM messages WHERE id = ?', message.id,
    );
    if (owner && (owner.novelId !== novelId || owner.worldId !== worldId)) {
      throw new Error('消息标识与其他小说或世界冲突，未覆盖现有数据。');
    }
  }
  await db.runAsync('DELETE FROM messages WHERE novel_id = ? AND world_id = ?', novelId, worldId);
  for (const [sequenceNo, message] of messages.entries()) {
    await upsertMessage(db, {
      ...message, novelId, worldId, sequenceNo,
      reasoningContent: message.reasoningContent ?? '',
      promptTokens: message.promptTokens ?? null, completionTokens: message.completionTokens ?? null,
      modelId: message.modelId ?? null,
    });
  }
}

/** Store metadata and bodies separately to avoid large SQLite cursor rows. Caller owns transaction. */
export async function writeSlotBook(db: SQLiteDatabase, novelId: string, worldId: string, book: NovelSlotBook) {
  const metadata = {
    ...book,
    slots: book.slots.map((slot) => ({ ...slot, messages: [] })),
    previousSnapshot: book.previousSnapshot ? { ...book.previousSnapshot, messages: [] } : null,
  };
  await db.runAsync(
    'INSERT INTO novel_slot_books (novel_id, world_id, metadata_json) VALUES (?, ?, ?) ON CONFLICT(novel_id, world_id) DO UPDATE SET metadata_json = excluded.metadata_json',
    novelId, worldId, JSON.stringify(metadata),
  );
  await db.runAsync('DELETE FROM novel_slot_messages WHERE novel_id = ? AND world_id = ?', novelId, worldId);
  await db.runAsync('DELETE FROM novel_slot_snapshot_counts WHERE novel_id = ? AND world_id = ?', novelId, worldId);
  const snapshots = book.slots.map((slot) => ({ key: `slot:${slot.id}`, messages: slot.messages }));
  if (book.previousSnapshot) snapshots.push({ key: 'previous', messages: book.previousSnapshot.messages });
  for (const snapshot of snapshots) {
    await db.runAsync(
      'INSERT INTO novel_slot_snapshot_counts (novel_id, world_id, snapshot_key, message_count) VALUES (?, ?, ?, ?)',
      novelId, worldId, snapshot.key, snapshot.messages.length,
    );
    for (const [position, message] of snapshot.messages.entries()) {
      await db.runAsync(
        'INSERT INTO novel_slot_messages (novel_id, world_id, snapshot_key, position, message_json) VALUES (?, ?, ?, ?, ?)',
        novelId, worldId, snapshot.key, position, JSON.stringify(message),
      );
    }
  }
}

export async function readSlotBook(db: SQLiteDatabase, novelId: string, worldId: string): Promise<NovelSlotBook | null> {
  const row = await db.getFirstAsync<{ metadata: string }>(
    'SELECT metadata_json AS metadata FROM novel_slot_books WHERE novel_id = ? AND world_id = ?', novelId, worldId,
  );
  if (!row) return null;
  const book = normalizeNovelSlotBook(JSON.parse(row.metadata));
  if (!book) throw new Error('记忆点元数据损坏，请从备份恢复。');
  const rows = await db.getAllAsync<{ key: string; position: number; message: string }>(
    'SELECT snapshot_key AS key, position, message_json AS message FROM novel_slot_messages WHERE novel_id = ? AND world_id = ? ORDER BY snapshot_key ASC, position ASC', novelId, worldId,
  );
  const counts = await db.getAllAsync<{ key: string; count: number }>(
    'SELECT snapshot_key AS key, message_count AS count FROM novel_slot_snapshot_counts WHERE novel_id = ? AND world_id = ?', novelId, worldId,
  );
  const expectedCounts = new Map(counts.map((item) => [item.key, Number(item.count)]));
  const expectedKeys = book.slots.map((slot) => `slot:${slot.id}`);
  if (book.previousSnapshot) expectedKeys.push('previous');
  for (const key of expectedKeys) {
    if (!expectedCounts.has(key)) throw new Error('记忆点消息计数缺失，请从备份恢复。');
  }
  const messages = new Map<string, Message[]>();
  for (const item of rows) {
    if (!expectedKeys.includes(item.key)) throw new Error('记忆点消息快照未知，请从备份恢复。');
    const list = messages.get(item.key) ?? [];
    if (item.position !== list.length) throw new Error('记忆点消息位置损坏，请从备份恢复。');
    list.push(JSON.parse(item.message) as Message);
    messages.set(item.key, list);
  }
  for (const [key, count] of expectedCounts) {
    if (!expectedKeys.includes(key)) throw new Error('记忆点消息快照未知，请从备份恢复。');
    if ((messages.get(key)?.length ?? 0) !== count) throw new Error('记忆点消息快照不完整，请从备份恢复。');
  }
  return {
    ...book,
    slots: book.slots.map((slot) => ({ ...slot, messages: messages.get(`slot:${slot.id}`) ?? [] })),
    previousSnapshot: book.previousSnapshot
      ? { ...book.previousSnapshot, messages: messages.get('previous') ?? [] } : null,
  };
}

export async function writeConversationState(db: SQLiteDatabase, novelId: string, worldId: string, meta: NovelConversation) {
  const { activeRequestId: _request, requestStatus: _status, agentStage: _stage, ...durable } = meta;
  await db.runAsync(
    'INSERT INTO novel_conversation_state (novel_id, world_id, metadata_json, updated_at, state_revision) VALUES (?, ?, ?, ?, 1) ON CONFLICT(novel_id, world_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at, state_revision = novel_conversation_state.state_revision + 1',
    novelId, worldId, JSON.stringify(durable), meta.updatedAt,
  );
  await replaceConversationMemories(db, novelId, worldId, meta, { updatedAt: meta.updatedAt, stale: meta.memoryStale });
}

export async function readConversationState(db: SQLiteDatabase, novelId: string, worldId: string): Promise<NovelConversation | null> {
  const row = await db.getFirstAsync<{ metadata: string }>(
    'SELECT metadata_json AS metadata FROM novel_conversation_state WHERE novel_id = ? AND world_id = ?', novelId, worldId,
  );
  return row ? JSON.parse(row.metadata) as NovelConversation : null;
}
