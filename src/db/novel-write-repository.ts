import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { getAppDatabase } from '@/db/database';
import { deleteChapter, upsertChapter } from '@/db/repositories/chapters';
import { deleteNovel, ensureNovelExists, upsertNovel } from '@/db/repositories/novels';
import { serializeChapterMetadata, serializeNovelMetadata } from '@/db/novel-metadata';
import { replaceNovelStateDocuments } from '@/db/repositories/novel-state-documents';
import type { Novel, NovelChapter } from '@/types/tavern';

const novelWriteQueues = new Map<string, Promise<void>>();

async function withDatabaseBusyRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|SQLITE_BUSY/i.test(message) || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function enqueueNovelWrite<T>(novelId: string, task: () => Promise<T>) {
  const previous = novelWriteQueues.get(novelId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);
  novelWriteQueues.set(novelId, next.then(() => undefined, () => undefined));
  return next;
}

function asRecord(value: unknown) {
  return value as Record<string, unknown>;
}

function chapterRow(novelId: string, chapter: NovelChapter) {
  return {
    id: chapter.id,
    novelId,
    chapterIndex: chapter.index,
    title: chapter.title,
    content: chapter.content,
    status: chapter.status,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
    jsonExtra: serializeChapterMetadata(asRecord(chapter)),
  };
}

export async function writeNovelMetadataInDatabase(transaction: SQLiteDatabase, novel: Novel) {
  await upsertNovel(transaction, {
    id: novel.id,
    name: novel.name,
    worldName: novel.worldName,
    worldEra: novel.worldEra,
    worldConflict: novel.worldConflict,
    worldTone: novel.worldTone,
    writingStyle: novel.writingStyle,
    createdAt: novel.createdAt,
    updatedAt: novel.updatedAt,
    jsonExtra: serializeNovelMetadata(asRecord(novel)),
    storyAnalysisJson: novel.novelStoryAnalysis ? JSON.stringify(novel.novelStoryAnalysis) : '',
    canonRevision: novel.canonRevision ?? 0,
  });
  const current = await transaction.getFirstAsync<{ canonRevision: number }>(
    'SELECT canon_revision AS canonRevision FROM novels WHERE id = ?',
    novel.id,
  );
  if (Number(current?.canonRevision ?? 0) <= (novel.canonRevision ?? 0)) {
    await replaceNovelStateDocuments(transaction, novel);
  }
}

/** Persists only bounded novel metadata;正文和章节通过独立 repository 写入。 */
export async function persistNovelMetadata(novel: Novel) {
  if (Platform.OS === 'web') return;
  return enqueueNovelWrite(novel.id, () => withDatabaseBusyRetry(async () => {
    const db = await getAppDatabase();
    const write = (transaction: typeof db) => writeNovelMetadataInDatabase(transaction, novel);
    const exclusive = db as typeof db & {
      withExclusiveTransactionAsync?: (callback: (transaction: typeof db) => Promise<void>) => Promise<void>;
    };
    if (typeof exclusive.withExclusiveTransactionAsync === 'function') {
      await exclusive.withExclusiveTransactionAsync(write);
    } else if (typeof db.withTransactionAsync === 'function') {
      await db.withTransactionAsync(() => write(db));
    } else {
      await write(db);
    }
  }));
}

export async function persistNovelChapter(novelId: string, chapter: NovelChapter) {
  if (Platform.OS === 'web') return;
  return enqueueNovelWrite(novelId, () => withDatabaseBusyRetry(async () => {
    const db = await getAppDatabase();
    await ensureNovelExists(db, novelId);
    await upsertChapter(db, chapterRow(novelId, chapter));
  }));
}

export async function removeNovelChapterFromDatabase(novelId: string, chapterId: string) {
  if (Platform.OS === 'web') return;
  return enqueueNovelWrite(novelId, () => withDatabaseBusyRetry(async () => {
    const db = await getAppDatabase();
    await deleteChapter(db, chapterId);
  }));
}

export async function removeNovelFromDatabase(novelId: string) {
  if (Platform.OS === 'web') return;
  return enqueueNovelWrite(novelId, () => withDatabaseBusyRetry(async () => {
    const db = await getAppDatabase();
    await deleteNovel(db, novelId);
  }));
}
