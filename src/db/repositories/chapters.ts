import type { SQLiteDatabase } from 'expo-sqlite';

import type { ChapterRow } from '@/db/types';

export async function upsertChapter(db: SQLiteDatabase, row: ChapterRow) {
  await db.runAsync(
    'INSERT INTO chapters ' +
      '(id, novel_id, chapter_index, title, content, status, created_at, updated_at, json_extra) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content, ' +
      'status = excluded.status, updated_at = excluded.updated_at, json_extra = excluded.json_extra',
    row.id,
    row.novelId,
    row.chapterIndex,
    row.title,
    row.content,
    row.status,
    row.createdAt,
    row.updatedAt,
    row.jsonExtra,
  );
}



export async function listChapterMetadataPage(
  db: SQLiteDatabase,
  novelId: string,
  options?: { limit?: number; beforeChapterIndex?: number },
) {
  const limit = Math.max(1, Math.min(200, Math.round(options?.limit ?? 50)));
  const before = options?.beforeChapterIndex;
  if (typeof before === 'number' && Number.isFinite(before)) {
    return db.getAllAsync<
      Pick<ChapterRow, 'id' | 'novelId' | 'chapterIndex' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'jsonExtra'>
    >(
      'SELECT id, novel_id AS novelId, chapter_index AS chapterIndex, title, status, ' +
        'created_at AS createdAt, updated_at AS updatedAt, json_extra AS jsonExtra FROM chapters ' +
        'WHERE novel_id = ? AND chapter_index < ? ORDER BY chapter_index DESC LIMIT ?',
      novelId,
      Math.floor(before),
      limit,
    );
  }
  return db.getAllAsync<
    Pick<ChapterRow, 'id' | 'novelId' | 'chapterIndex' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'jsonExtra'>
  >(
    'SELECT id, novel_id AS novelId, chapter_index AS chapterIndex, title, status, ' +
      'created_at AS createdAt, updated_at AS updatedAt, json_extra AS jsonExtra FROM chapters ' +
      'WHERE novel_id = ? ORDER BY chapter_index ASC LIMIT ?',
    novelId,
    limit,
  );
}

export async function deleteChapter(db: SQLiteDatabase, chapterId: string) {
  await db.runAsync('DELETE FROM chapters WHERE id = ?', chapterId);
}


export async function getChapterContent(db: SQLiteDatabase, chapterId: string) {
  return db.getFirstAsync<Pick<ChapterRow, 'id' | 'novelId' | 'chapterIndex' | 'title' | 'content'>>(
    'SELECT id, novel_id AS novelId, chapter_index AS chapterIndex, title, content ' +
      'FROM chapters WHERE id = ?',
    chapterId,
  );
}
