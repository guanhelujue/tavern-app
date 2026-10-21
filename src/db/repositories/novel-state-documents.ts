import type { SQLiteDatabase } from 'expo-sqlite';

import type { Novel } from '@/types/tavern';

const COLLECTIONS = {
  chapterBackups: ['novel_chapter_backups', 'id'],
  novelForecasts: ['novel_forecasts', 'forecastId'],
  novelContinuationPlans: ['novel_continuation_plans', 'planId'],
  novelBranches: ['novel_branches', 'branchId'],
  novelStorySnapshots: ['novel_story_snapshots', 'snapshotId'],
  novelGenerationJobs: ['novel_generation_jobs', 'jobId'],
  novelRewriteAudits: ['novel_rewrite_audits', 'auditId'],
  audits: ['novel_chapter_audits', 'id'],
} as const;

type CollectionKey = keyof typeof COLLECTIONS;

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export async function replaceNovelStateDocuments(db: SQLiteDatabase, novel: Novel) {
  for (const [key, [table, idKey]] of Object.entries(COLLECTIONS) as [CollectionKey, readonly [string, string]][]) {
    const values = (novel[key] ?? []) as unknown[];
    await db.runAsync(`DELETE FROM ${table} WHERE novel_id = ?`, novel.id);
    for (let index = 0; index < values.length; index += 1) {
      const value = recordOf(values[index]);
      const id = String(value[idKey] ?? value.id ?? `${novel.id}:${key}:${index}`);
      const createdAt = String(value.createdAt ?? value.startedAt ?? novel.createdAt);
      const updatedAt = String(value.updatedAt ?? value.createdAt ?? novel.updatedAt);
      const stateVersion = Number(value.stateVersion ?? novel.novelStoryAnalysis?.stateVersion ?? 0);
      if (table === 'novel_generation_jobs') {
        await db.runAsync(
          `INSERT INTO ${table} (id, novel_id, state_version, created_at, updated_at, content_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id, novel.id, Number.isFinite(stateVersion) ? stateVersion : 0, createdAt, updatedAt,
          JSON.stringify(values[index]), String(value.status ?? ''),
        );
      } else {
        await db.runAsync(
          `INSERT INTO ${table} (id, novel_id, state_version, created_at, updated_at, content_json) VALUES (?, ?, ?, ?, ?, ?)`,
          id, novel.id, Number.isFinite(stateVersion) ? stateVersion : 0, createdAt, updatedAt, JSON.stringify(values[index]),
        );
      }
    }
  }
}

export async function loadNovelStateDocuments(db: SQLiteDatabase, novelId: string) {
  const result: Partial<Novel> = {};
  for (const [key, [table]] of Object.entries(COLLECTIONS) as [CollectionKey, readonly [string, string]][]) {
    const rows = await db.getAllAsync<{ contentJson: string }>(
      `SELECT content_json AS contentJson FROM ${table} WHERE novel_id = ? ORDER BY ${
        key === 'chapterBackups' ? 'created_at ASC, rowid ASC' : 'updated_at DESC'
      }`, novelId,
    );
    result[key] = rows.flatMap((row) => {
      try { return [JSON.parse(row.contentJson)]; } catch { return []; }
    }) as never;
  }
  return result;
}
