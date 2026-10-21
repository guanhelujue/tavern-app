import type { SQLiteDatabase } from 'expo-sqlite';

import type { NovelCharacterBiography } from '@/types/tavern';

export async function listCharacterBiographies(
  db: SQLiteDatabase,
  novelId: string,
  characterId: string,
): Promise<NovelCharacterBiography[]> {
  return db.getAllAsync<NovelCharacterBiography>(
    `SELECT id, title, request, content,
       created_at AS createdAt, updated_at AS updatedAt
     FROM character_biographies
     WHERE novel_id = ? AND character_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    novelId,
    characterId,
  );
}

export async function replaceCharacterBiographies(
  db: SQLiteDatabase,
  novelId: string,
  characterId: string,
  entries: NovelCharacterBiography[],
) {
  await db.runAsync(
    'DELETE FROM character_biographies WHERE novel_id = ? AND character_id = ?',
    novelId,
    characterId,
  );
  for (const [index, entry] of entries.entries()) {
    await db.runAsync(
      `INSERT INTO character_biographies
       (id, novel_id, character_id, title, request, content, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      novelId,
      characterId,
      entry.title,
      entry.request,
      entry.content,
      entry.createdAt,
      entry.updatedAt,
      index,
    );
  }
}

export async function deleteCharacterBiographies(
  db: SQLiteDatabase,
  novelId: string,
  characterId: string,
) {
  await db.runAsync(
    'DELETE FROM character_biographies WHERE novel_id = ? AND character_id = ?',
    novelId,
    characterId,
  );
}

export async function deleteNovelBiographies(db: SQLiteDatabase, novelId: string) {
  await db.runAsync('DELETE FROM character_biographies WHERE novel_id = ?', novelId);
}
