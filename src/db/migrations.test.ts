import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { migrateDatabase } from './migrations';

describe('database migration v16', () => {
  it('creates character biography storage when upgrading a v13 database', async () => {
    const statements: string[] = [];
    const db = {
      execAsync: vi.fn(async (sql: string) => { statements.push(sql); }),
      getFirstAsync: vi.fn(async () => ({ user_version: 13 })),
      withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
    } as never;

    const report = await migrateDatabase(db);

    expect(report).toEqual({ fromVersion: 13, toVersion: 16, appliedVersions: [14, 15, 16] });
    expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS character_biographies');
    expect(statements.join('\n')).toContain('PRAGMA user_version = 14');
    expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS novel_slot_messages');
    expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS novel_chapter_backups');
  });

  it('upgrades a v15 database without changing existing books and is idempotent', async () => {
    const raw = new DatabaseSync(':memory:');
    const db = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async (sql: string) => raw.prepare(sql).get(),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    } as unknown as Parameters<typeof migrateDatabase>[0];
    try {
      await migrateDatabase(db);
      raw.exec("DROP TABLE novel_chapter_backups; PRAGMA user_version = 15;");
      raw.exec("INSERT INTO novels (id, name, created_at, updated_at) VALUES ('existing', '保留原书', 'now', 'now')");
      expect(await migrateDatabase(db)).toEqual({ fromVersion: 15, toVersion: 16, appliedVersions: [16] });
      expect(raw.prepare("SELECT name FROM novels WHERE id = 'existing'").get()?.name).toBe('保留原书');
      expect(raw.prepare('SELECT COUNT(*) AS count FROM novel_chapter_backups').get()?.count).toBe(0);
      expect(await migrateDatabase(db)).toEqual({ fromVersion: 16, toVersion: 16, appliedVersions: [] });
    } finally {
      raw.close();
    }
  });
});
