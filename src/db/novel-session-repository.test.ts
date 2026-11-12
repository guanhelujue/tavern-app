import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '@/db/migrations';
import {
  readAllSessionMessages,
  readConversationState,
  readSlotBook,
  replaceSessionMessages,
  writeConversationState,
  writeSlotBook,
} from './novel-session-repository';
import type { NovelConversation, NovelSlotBook } from '@/types/tavern';

const databases: DatabaseSync[] = [];

function createDb() {
  const raw = new DatabaseSync(':memory:');
  databases.push(raw);
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
    getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  } as any;
  return { db, raw };
}

afterEach(() => { while (databases.length) databases.pop()?.close(); });

async function seedNovel(db: any, id: string) {
  await db.runAsync(
    "INSERT INTO novels (id, name, world_name, world_era, world_conflict, world_tone, writing_style, created_at, updated_at, json_extra) VALUES (?, '', '', '', '', '', '', 'now', 'now', '{}')",
    id,
  );
}

function message(id: string, worldId: string, sequenceNo: number) {
  return {
    id, characterId: 'novel-a', novelId: 'novel-a', worldId, role: 'user', content: id,
    reasoningContent: '', status: 'complete', createdAt: `2026-01-01T00:00:${String(sequenceNo).padStart(2, '0')}Z`,
    updatedAt: '2026-01-01T00:00:00.000Z', promptTokens: null, completionTokens: null, modelId: null,
  };
}

describe('novel session repository', () => {
  it('round-trips 250 messages and isolates slot books by world', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    await seedNovel(db, 'novel-a');
    const messages = Array.from({ length: 250 }, (_, index) => message(`m-${index}`, 'world-a', index));
    await replaceSessionMessages(db, 'novel-a', 'world-a', messages as any);
    const restored = await readAllSessionMessages(db, 'novel-a', 'world-a');
    expect(restored.map((row) => row.id)).toEqual(messages.map((row) => row.id));
    const book = {
      activeSlotId: 'slot-a',
      slots: [{ id: 'slot-a', name: 'A', createdAt: 'now', updatedAt: 'now', messages, memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [], lastMessageAt: 'now', title: 'A' }],
      previousSnapshot: null,
    } as unknown as NovelSlotBook;
    await writeSlotBook(db, 'novel-a', 'world-a', book);
    await writeSlotBook(db, 'novel-a', 'world-b', { ...book, activeSlotId: 'slot-b' } as NovelSlotBook);
    expect((await readSlotBook(db, 'novel-a', 'world-a'))?.slots[0].messages).toHaveLength(250);
    expect((await readSlotBook(db, 'novel-a', 'world-b'))?.slots[0].messages).toHaveLength(250);
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM novel_slot_books').get()?.count)).toBe(2);
  });

  it('restores memory metadata, rejects cross-scope conflicts, and rejects damaged snapshots', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    await seedNovel(db, 'novel-a');
    const meta = {
      id: 'novel-a-conversation', novelId: 'novel-a', title: 'A', memory: 'base', longTermMemory: 'long',
      midTermMemories: ['mid'], shortTermMemories: ['short'], lastMessageAt: 'now', createdAt: 'now', updatedAt: 'now',
    } as NovelConversation;
    await writeConversationState(db, 'novel-a', 'world-a', meta);
    expect((await readConversationState(db, 'novel-a', 'world-a'))?.longTermMemory).toBe('long');
    await db.runAsync("INSERT INTO messages (id, novel_id, world_id, role, content, status, created_at, updated_at, sequence_no) VALUES ('shared', 'novel-a', 'world-b', 'user', 'keep', 'complete', 'now', 'now', 0)");
    await expect(replaceSessionMessages(db, 'novel-a', 'world-a', [message('shared', 'world-a', 0)] as any)).rejects.toThrow();
    expect(Number(raw.prepare("SELECT COUNT(*) AS count FROM messages WHERE novel_id = 'novel-a' AND world_id = 'world-b'").get()?.count)).toBe(1);
    const book = { activeSlotId: 'slot', slots: [{ id: 'slot', name: 'S', createdAt: 'now', updatedAt: 'now', messages: [message('x', 'world-a', 0)], memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [], lastMessageAt: 'now', title: 'S' }], previousSnapshot: null } as unknown as NovelSlotBook;
    await writeSlotBook(db, 'novel-a', 'world-a', book);
    await db.runAsync("DELETE FROM novel_slot_messages WHERE novel_id = 'novel-a' AND world_id = 'world-a'");
    await expect(readSlotBook(db, 'novel-a', 'world-a')).rejects.toThrow();
  });
});
