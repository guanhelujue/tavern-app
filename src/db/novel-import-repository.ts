import type { SQLiteDatabase } from 'expo-sqlite';

import { replaceCharacterBiographies } from '@/db/repositories/character-biographies';
import { upsertChapter } from '@/db/repositories/chapters';
import { replaceNovelStateDocuments } from '@/db/repositories/novel-state-documents';
import { upsertNovel } from '@/db/repositories/novels';
import {
  replaceSessionMessages,
  writeConversationState,
  writeSlotBook,
} from '@/db/novel-session-repository';
import { serializeChapterMetadata, serializeNovelMetadata } from '@/db/novel-metadata';
import type { ChapterRow, NovelRow } from '@/db/types';
import type {
  Message,
  Novel,
  NovelCharacterBiography,
  NovelConversation,
  NovelSlotBook,
} from '@/types/tavern';
import { stripNovelBodyForPersistence } from '@/store/tavern-store-persistence';

type WorldImport = {
  messages: Message[];
  meta: NovelConversation;
  slotBook?: NovelSlotBook;
};

async function assertIdsAvailable(db: SQLiteDatabase, table: string, ids: string[], column = 'id') {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error(`导入文件包含重复的 ${table} 标识。`);
  for (const id of ids) {
    const row = await db.getFirstAsync<{ id: string }>(`SELECT ${column} AS id FROM ${table} WHERE ${column} = ?`, id);
    if (row) throw new Error(`导入标识与现有 ${table} 冲突：${id}`);
  }
}

function novelRow(novel: Novel): NovelRow {
  return {
    id: novel.id,
    name: novel.name,
    worldName: novel.worldName,
    worldEra: novel.worldEra,
    worldConflict: novel.worldConflict,
    worldTone: novel.worldTone,
    writingStyle: novel.writingStyle,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
    jsonExtra: serializeNovelMetadata(novel as unknown as Record<string, unknown>),
    storyAnalysisJson: novel.novelStoryAnalysis ? JSON.stringify(novel.novelStoryAnalysis) : '',
    canonRevision: novel.canonRevision ?? 0,
  };
}

export async function importNovelSnapshot(
  db: SQLiteDatabase,
  novel: Novel,
  worlds: Record<string, WorldImport>,
  biographies?: Record<string, NovelCharacterBiography[]>,
): Promise<void> {
  const importedChapterIds = (novel.chapters ?? []).map((chapter) => chapter.id);
  const importedMessageIds = Object.values(worlds).flatMap((world) => world.messages).map((message) => message.id);
  const importedBiographyIds = Object.values(biographies ?? {}).flatMap((entries) => entries.map((entry) => entry.id));

  await assertIdsAvailable(db, 'novels', [novel.id]);
  await assertIdsAvailable(db, 'chapters', importedChapterIds);
  await assertIdsAvailable(db, 'messages', importedMessageIds);
  await assertIdsAvailable(db, 'character_biographies', importedBiographyIds);

  const journalNovel = stripNovelBodyForPersistence(novel);
  await upsertNovel(db, novelRow(novel));
  await db.runAsync(
    'INSERT INTO novel_import_journal (novel_id, metadata_json) VALUES (?, ?)',
    novel.id,
    JSON.stringify(journalNovel),
  );
  await replaceNovelStateDocuments(db, novel);
  for (const chapter of novel.chapters ?? []) {
    const row: ChapterRow = {
      id: chapter.id,
      novelId: novel.id,
      chapterIndex: chapter.index,
      title: chapter.title,
      content: chapter.content,
      status: chapter.status,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
      jsonExtra: serializeChapterMetadata(chapter as unknown as Record<string, unknown>),
    };
    await upsertChapter(db, row);
  }
  for (const [worldId, world] of Object.entries(worlds)) {
    await replaceSessionMessages(db, novel.id, worldId, world.messages);
    await writeConversationState(db, novel.id, worldId, world.meta);
    if (world.slotBook) await writeSlotBook(db, novel.id, worldId, world.slotBook);
  }
  for (const [characterId, entries] of Object.entries(biographies ?? {})) {
    await replaceCharacterBiographies(
      db,
      novel.id,
      characterId,
      entries,
    );
  }
}

export async function readPendingNovelImports(db: SQLiteDatabase): Promise<Novel[]> {
  const rows = await db.getAllAsync<{ metadata: string }>(
    'SELECT metadata_json AS metadata FROM novel_import_journal ORDER BY novel_id ASC',
  );
  return rows.flatMap((row) => {
    try { return [JSON.parse(row.metadata) as Novel]; } catch { return []; }
  });
}

export async function acknowledgeNovelImport(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM novel_import_journal WHERE novel_id = ?', id);
}
