import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '@/db/migrations';
import { acknowledgeNovelImport, importNovelSnapshot, readPendingNovelImports } from './novel-import-repository';

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

function snapshot() {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'source-novel', name: '源小说', worldName: '世界', worldEra: '', worldConflict: '', worldTone: '', writingStyle: '',
    createdAt: now, updatedAt: now, chapters: [{ id: 'chapter-source', index: 1, title: '第一章', content: '全文', status: 'final', createdAt: now, updatedAt: now }],
  } as any;
}

const world: any = {
  messages: [{ id: 'message-source', characterId: 'source-novel', role: 'user', content: '正文', status: 'complete', createdAt: 'now', updatedAt: 'now' }],
  meta: { id: 'conversation-source', novelId: 'source-novel', title: '主线', memory: '记忆', longTermMemory: '长期', midTermMemories: ['中期'], shortTermMemories: ['短期'], lastMessageAt: 'now', createdAt: 'now', updatedAt: 'now' },
  slotBook: { activeSlotId: 'slot-source', slots: [
    { id: 'slot-source', name: '一', createdAt: 'now', updatedAt: 'now', messages: [{ id: 'message-source', content: '快照一' }] },
    { id: 'slot-two', name: '二', createdAt: 'now', updatedAt: 'now', messages: [{ id: 'message-source', content: '快照二' }] },
  ], previousSnapshot: null },
};

describe('novel import repository', () => {
  it('writes a remapped complete copy and exposes its journal for restart recovery', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    await db.withTransactionAsync(() => importNovelSnapshot(db, snapshot(), { main: world }, {
      hero: [{ id: 'bio-source', title: '小传', request: '', content: '内容', createdAt: 'now', updatedAt: 'now' }],
    }));
    const pending = await readPendingNovelImports(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('source-novel');
    const importedId = pending[0]!.id;
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM chapters WHERE novel_id = ?').get(importedId)?.count)).toBe(1);
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM messages WHERE novel_id = ? AND id = ?').get(importedId, 'message-source')?.count)).toBe(1);
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM character_biographies WHERE novel_id = ?').get(importedId)?.count)).toBe(1);
    await acknowledgeNovelImport(db, importedId);
    expect(await readPendingNovelImports(db)).toEqual([]);
  });

  it('preflights conflicts without writing any rows', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    await db.runAsync("INSERT INTO novels (id, name, world_name, world_era, world_conflict, world_tone, writing_style, created_at, updated_at, json_extra) VALUES ('source-novel', '', '', '', '', '', '', 'now', 'now', '{}')");
    await expect(importNovelSnapshot(db, snapshot(), { main: world })).rejects.toThrow('novels');
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM novel_import_journal').get()?.count)).toBe(0);
  });

  it('rejects active message conflicts across worlds while allowing slot duplicate ids', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    await db.runAsync("INSERT INTO novels (id, name, world_name, world_era, world_conflict, world_tone, writing_style, created_at, updated_at, json_extra) VALUES ('existing', '', '', '', '', '', '', 'now', 'now', '{}')");
    await db.runAsync("INSERT INTO messages (id, novel_id, world_id, role, content, status, created_at, updated_at, sequence_no) VALUES ('message-source', 'existing', 'other', 'user', 'keep', 'complete', 'now', 'now', 0)");
    await expect(importNovelSnapshot(db, snapshot(), { main: world, other: { ...world, messages: [{ ...world.messages[0] }] } })).rejects.toThrow('messages');
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM novel_import_journal').get()?.count)).toBe(0);
  });

  it('rolls back journal and rows when a transaction fails', async () => {
    const { db, raw } = createDb();
    await migrateDatabase(db);
    const original = db.runAsync;
    db.runAsync = async (sql: string, ...params: SQLInputValue[]) => {
      if (sql.includes('novel_import_journal')) throw new Error('simulated failure');
      return original(sql, ...params);
    };
    await expect(db.withTransactionAsync(() => importNovelSnapshot(db, snapshot(), { main: world }))).rejects.toThrow('simulated failure');
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM novels').get()?.count)).toBe(0);
    expect(Number(raw.prepare('SELECT COUNT(*) AS count FROM novel_import_journal').get()?.count)).toBe(0);
  });
});
