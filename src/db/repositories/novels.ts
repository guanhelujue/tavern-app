import type { SQLiteDatabase } from 'expo-sqlite';

import type { NovelRow } from '@/db/types';

const UPSERT_NOVEL_SQL = [
  'INSERT INTO novels',
  '(id, name, world_name, world_era, world_conflict, world_tone, writing_style,',
  ' created_at, updated_at, json_extra, story_analysis_json, canon_revision)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  'ON CONFLICT(id) DO UPDATE SET',
  'name = excluded.name, world_name = excluded.world_name, world_era = excluded.world_era,',
  'world_conflict = excluded.world_conflict, world_tone = excluded.world_tone,',
  'writing_style = excluded.writing_style, updated_at = excluded.updated_at,',
  'json_extra = excluded.json_extra,',
  'story_analysis_json = CASE WHEN excluded.canon_revision >= novels.canon_revision',
  '  THEN excluded.story_analysis_json ELSE novels.story_analysis_json END,',
  'canon_revision = MAX(novels.canon_revision, excluded.canon_revision)',
].join(' ');

export async function upsertNovel(db: SQLiteDatabase, row: NovelRow) {
  await db.runAsync(
    UPSERT_NOVEL_SQL,
    row.id,
    row.name,
    row.worldName,
    row.worldEra,
    row.worldConflict,
    row.worldTone,
    row.writingStyle,
    row.createdAt,
    row.updatedAt,
    row.jsonExtra,
    row.storyAnalysisJson ?? '',
    row.canonRevision ?? 0,
  );
}

/** Ensures the parent row exists before a message/chapter write. */
export async function ensureNovelExists(db: SQLiteDatabase, novelId: string) {
  const timestamp = new Date().toISOString();
  await db.runAsync(
    'INSERT OR IGNORE INTO novels ' +
      '(id, name, world_name, world_era, world_conflict, world_tone, writing_style, created_at, updated_at, json_extra, story_analysis_json) ' +
      "VALUES (?, '未命名小说', '', '', '', '', '', ?, ?, '{}', '')",
    novelId,
    timestamp,
    timestamp,
  );
}

export async function deleteNovel(db: SQLiteDatabase, novelId: string) {
  await db.runAsync('DELETE FROM novels WHERE id = ?', novelId);
}

export async function countNovels(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM novels');
  return Number(row?.count ?? 0);
}

export async function getNovel(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<NovelRow>(
    'SELECT id, name, world_name AS worldName, world_era AS worldEra, ' +
      'world_conflict AS worldConflict, world_tone AS worldTone, ' +
    'writing_style AS writingStyle, created_at AS createdAt, ' +
      'updated_at AS updatedAt, json_extra AS jsonExtra, ' +
      'story_analysis_json AS storyAnalysisJson, canon_revision AS canonRevision FROM novels WHERE id = ?',
    id,
  );
}
