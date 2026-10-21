import type { SQLiteDatabase } from 'expo-sqlite';

import type { StoryFactRow } from '@/db/types';

export async function upsertStoryFact(db: SQLiteDatabase, row: StoryFactRow) {
  await db.runAsync(
    'INSERT INTO story_facts ' +
      '(id, novel_id, fact_type, subject_id, content_json, source_event_id, state_version, confidence, locked, stale, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET fact_type = excluded.fact_type, subject_id = excluded.subject_id, ' +
      'content_json = excluded.content_json, source_event_id = excluded.source_event_id, ' +
      'state_version = excluded.state_version, confidence = excluded.confidence, locked = excluded.locked, ' +
      'stale = excluded.stale, updated_at = excluded.updated_at ' +
      'WHERE story_facts.locked = 0 OR excluded.locked = 1',
    row.id,
    row.novelId,
    row.factType,
    row.subjectId,
    row.contentJson,
    row.sourceEventId,
    row.stateVersion,
    row.confidence,
    row.locked,
    row.stale,
    row.updatedAt,
  );
}

export async function upsertProjectedStoryFact(
  db: SQLiteDatabase,
  row: StoryFactRow,
  generation: number,
) {
  await db.runAsync(
    'INSERT INTO story_projection_facts ' +
      '(novel_id, generation, id, fact_type, subject_id, content_json, source_event_id, state_version, ' +
      'canon_revision, confidence, locked, stale, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(novel_id, generation, id) DO UPDATE SET fact_type = excluded.fact_type, ' +
      'subject_id = excluded.subject_id, content_json = excluded.content_json, source_event_id = excluded.source_event_id, ' +
      'state_version = excluded.state_version, canon_revision = excluded.canon_revision, confidence = excluded.confidence, ' +
      'locked = excluded.locked, stale = excluded.stale, updated_at = excluded.updated_at ' +
      'WHERE story_projection_facts.locked = 0 OR excluded.locked = 1',
    row.novelId,
    generation,
    row.id,
    row.factType,
    row.subjectId,
    row.contentJson,
    row.sourceEventId,
    row.stateVersion,
    row.canonRevision ?? 0,
    row.confidence,
    row.locked,
    row.stale,
    row.updatedAt,
  );
}



const PROJECTED_FACT_COLUMNS =
  'f.id, f.novel_id AS novelId, f.fact_type AS factType, f.subject_id AS subjectId, f.content_json AS contentJson, ' +
  'f.source_event_id AS sourceEventId, f.state_version AS stateVersion, f.confidence, f.locked, ' +
  'CASE WHEN pg.through_canon_revision < n.canon_revision THEN 1 ELSE f.stale END AS stale, ' +
  'f.updated_at AS updatedAt, f.generation AS projectionGeneration, f.canon_revision AS canonRevision';

export async function listActiveStoryFacts(
  db: SQLiteDatabase,
  novelId: string,
  options?: { factType?: string; limit?: number; maxStateVersion?: number },
) {
  const limit = Math.max(1, Math.min(1000, Math.round(options?.limit ?? 500)));
  const clauses = ['novel_id = ?', 'stale = 0'];
  const params: (string | number)[] = [novelId];
  if (options?.factType) {
    clauses.push('fact_type = ?');
    params.push(options.factType);
  }
  if (typeof options?.maxStateVersion === 'number') {
    clauses.push('state_version <= ?');
    params.push(Math.floor(options.maxStateVersion));
  }
  params.push(limit);
  return db.getAllAsync<StoryFactRow>(
    `SELECT ${PROJECTED_FACT_COLUMNS} FROM story_projection_facts f ` +
      'JOIN novels n ON n.id = f.novel_id AND n.active_projection_generation = f.generation ' +
      'JOIN projection_generations pg ON pg.novel_id = f.novel_id AND pg.generation = f.generation ' +
      `WHERE ${clauses.map((clause) => `f.${clause}`).join(' AND ')} ` +
      'ORDER BY f.locked DESC, f.state_version DESC, f.updated_at DESC LIMIT ?',
    ...params,
  );
}


export async function markStoryFactsStaleByChapter(
  db: SQLiteDatabase,
  novelId: string,
  chapterId: string,
  updatedAt: string,
) {
  await db.runAsync(
    'UPDATE story_facts SET stale = 1, updated_at = ? WHERE novel_id = ? AND source_event_id IN (' +
      'SELECT e.id FROM story_events e ' +
      'LEFT JOIN chapters c ON c.id = e.chapter_id ' +
      'WHERE e.novel_id = ? AND (e.chapter_id = ? OR c.chapter_index >= (' +
      'SELECT chapter_index FROM chapters WHERE id = ? AND novel_id = ?)))',
    updatedAt,
    novelId,
    novelId,
    chapterId,
    chapterId,
    novelId,
  );
}
