import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '@/db/migrations';
import {
  replaceConversationMemories,
  type ConversationMemoryState,
} from './memories';

type AsyncDb = Parameters<typeof replaceConversationMemories>[0];

const databases: DatabaseSync[] = [];

function createDb() {
  const raw = new DatabaseSync(':memory:');
  databases.push(raw);
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) =>
      raw.prepare(sql).get(...params) as T | null,
    getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) =>
      raw.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (task: () => Promise<void>) => task(),
  } as unknown as AsyncDb;
  return db;
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

async function seedNovel(db: AsyncDb, id: string) {
  await db.runAsync(
    "INSERT INTO novels (id, name, world_name, world_era, world_conflict, world_tone, writing_style, created_at, updated_at, json_extra) VALUES (?, '', '', '', '', '', '', ?, ?, '{}')",
    id,
    'now',
    'now',
  );
}

async function aggregateRows(db: AsyncDb, novelId: string, worldId: string) {
  return db.getAllAsync<{ memoryType: string; content: string; sourceMessageId: string | null }>(
    'SELECT memory_type AS memoryType, content, source_message_id AS sourceMessageId FROM memories WHERE novel_id = ? AND world_id = ? ORDER BY memory_type',
    novelId,
    worldId,
  );
}

describe('replaceConversationMemories', () => {
  it('replaces aggregate slots without reviving stale entries or touching other scopes', async () => {
    const db = createDb();
    await migrateDatabase(db);
    await seedNovel(db, 'novel-a');
    await seedNovel(db, 'novel-b');
    await db.runAsync(
      "INSERT INTO memories (id, novel_id, world_id, memory_type, content, source_message_id, source_chapter_id, source_type, source_id, state_version, confidence, stale, created_at, updated_at) VALUES ('other', 'novel-a', 'world-b', 'memory', 'keep', NULL, NULL, 'legacy', NULL, 0, 1, 0, 'now', 'now'), ('other-novel', 'novel-b', 'world-a', 'short_term_0', 'keep', NULL, NULL, 'legacy', NULL, 0, 1, 0, 'now', 'now')",
    );

    const state = (shortTermMemories: string[], midTermMemories: string[] = [], longTermMemory = ''): ConversationMemoryState => ({
      longTermMemory,
      midTermMemories,
      shortTermMemories,
    });

    await replaceConversationMemories(db, 'novel-a', 'world-a', state(Array.from({ length: 7 }, (_, i) => `short-${i}`)), {
      sourceMessageId: 'assistant-1',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect((await aggregateRows(db, 'novel-a', 'world-a')).map((row) => row.memoryType)).toEqual([
      'short_term_0', 'short_term_1', 'short_term_2', 'short_term_3', 'short_term_4', 'short_term_5', 'short_term_6',
    ]);

    await replaceConversationMemories(db, 'novel-a', 'world-a', state([], ['mid-1', 'mid-2', 'mid-3', 'mid-4', 'mid-5']));
    expect((await aggregateRows(db, 'novel-a', 'world-a')).map((row) => row.memoryType)).toEqual([
      'mid_term_0', 'mid_term_1', 'mid_term_2', 'mid_term_3', 'mid_term_4',
    ]);

    await replaceConversationMemories(db, 'novel-a', 'world-a', state([], [], 'long-summary'), {
      sourceMessageId: 'assistant-2',
      stale: true,
    });
    expect(await aggregateRows(db, 'novel-a', 'world-a')).toEqual([
      { memoryType: 'long_term', content: 'long-summary', sourceMessageId: 'assistant-2' },
    ]);

    await replaceConversationMemories(db, 'novel-a', 'world-a', state([]));
    expect(await aggregateRows(db, 'novel-a', 'world-a')).toEqual([]);
    expect(await aggregateRows(db, 'novel-a', 'world-b')).toEqual([
      { memoryType: 'memory', content: 'keep', sourceMessageId: null },
    ]);
    expect(await aggregateRows(db, 'novel-b', 'world-a')).toEqual([
      { memoryType: 'short_term_0', content: 'keep', sourceMessageId: null },
    ]);
  });
});
