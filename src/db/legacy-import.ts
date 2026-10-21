import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EncodingType,
  documentDirectory,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertChapter } from '@/db/repositories/chapters';
import { upsertMemory } from '@/db/repositories/memories';
import { upsertMessage } from '@/db/repositories/messages';
import { upsertNovel } from '@/db/repositories/novels';
import { serializeChapterMetadata, serializeNovelMetadata } from '@/db/novel-metadata';

export const LEGACY_STORE_KEY = 'tavern-mobile-store-v1';
const LEGACY_BACKUP_FILE = 'tavern-store-v1-legacy-backup.json';

type LegacyStorage = {
  getItem: (key: string) => Promise<string | null>;
};

type LegacySnapshot = {
  novels?: Record<string, unknown>[];
  novelConversations?: Record<string, Record<string, unknown>[]>;
  novelConversationMeta?: Record<string, Record<string, unknown>>;
};

export type LegacyImportReport = {
  backupUri?: string;
  novels: number;
  messages: number;
  chapters: number;
  memories: number;
  fingerprint: string;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fingerprint(parts: string[]) {
  let hash = 2166136261;
  for (const part of parts.sort()) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16);
}

/** Writes a recoverable copy before any database import is attempted. */
export async function backupLegacyStore(
  storage: LegacyStorage = AsyncStorage,
): Promise<{ raw: string; backupUri?: string }> {
  const raw = (await storage.getItem(LEGACY_STORE_KEY)) ?? '';
  if (!raw || !documentDirectory) {
    return { raw };
  }

  const backupUri = documentDirectory + LEGACY_BACKUP_FILE;
  await writeAsStringAsync(backupUri, raw, { encoding: EncodingType.UTF8 });
  return { raw, backupUri };
}

/**
 * Idempotent import primitive. It only uses bound values and upserts by stable
 * IDs, so retrying after a crash does not duplicate rows or touch AsyncStorage.
 */
export async function importLegacySnapshot(
  db: SQLiteDatabase,
  raw: string,
): Promise<Omit<LegacyImportReport, 'backupUri'>> {
  if (!raw.trim()) {
    return { novels: 0, messages: 0, chapters: 0, memories: 0, fingerprint: fingerprint([]) };
  }

  const parsed = JSON.parse(raw) as unknown;
  const snapshot: LegacySnapshot =
    parsed && typeof parsed === 'object' && 'state' in parsed
      ? ((parsed as { state?: LegacySnapshot }).state ?? {})
      : ((parsed as LegacySnapshot) ?? {});
  const novels = Array.isArray(snapshot.novels) ? snapshot.novels : [];
  const conversations = snapshot.novelConversations ?? {};
  const conversationMeta = snapshot.novelConversationMeta ?? {};
  const ids: string[] = [];
  let messageCount = 0;
  let chapterCount = 0;
  let memoryCount = 0;

  await db.withTransactionAsync(async () => {
    for (const novel of novels) {
      const novelId = stringValue(novel.id);
      if (!novelId) {
        continue;
      }
      const now = new Date().toISOString();
      await upsertNovel(db, {
        id: novelId,
        name: stringValue(novel.name, '未命名小说'),
        worldName: stringValue(novel.worldName),
        worldEra: stringValue(novel.worldEra),
        worldConflict: stringValue(novel.worldConflict),
        worldTone: stringValue(novel.worldTone),
        writingStyle: stringValue(novel.writingStyle),
        createdAt: stringValue(novel.createdAt, now),
        updatedAt: stringValue(novel.updatedAt, now),
        jsonExtra: serializeNovelMetadata(novel),
        storyAnalysisJson:
          novel.novelStoryAnalysis && typeof novel.novelStoryAnalysis === 'object'
            ? JSON.stringify(novel.novelStoryAnalysis)
            : '',
      });
      ids.push('novel:' + novelId);

      const rawChapters = Array.isArray(novel.chapters) ? novel.chapters : [];
      for (let index = 0; index < rawChapters.length; index += 1) {
        const chapter = rawChapters[index] as Record<string, unknown>;
        const chapterId = stringValue(chapter.id, novelId + '-chapter-' + String(index + 1));
        await upsertChapter(db, {
          id: chapterId,
          novelId,
          chapterIndex: numberValue(chapter.chapterIndex, index + 1),
          title: stringValue(chapter.title),
          content: stringValue(chapter.content),
          status: stringValue(chapter.status, 'draft'),
          createdAt: stringValue(chapter.createdAt, now),
          updatedAt: stringValue(chapter.updatedAt, now),
          jsonExtra: serializeChapterMetadata(chapter),
        });
        chapterCount += 1;
        ids.push('chapter:' + chapterId + ':' + String(stringValue(chapter.content).length));
      }

      const messages = Array.isArray(conversations[novelId]) ? conversations[novelId] : [];
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        const messageId = stringValue(message.id, novelId + '-message-' + String(index + 1));
        await upsertMessage(db, {
          id: messageId,
          novelId,
          role: stringValue(message.role, 'user'),
          content: stringValue(message.content),
          reasoningContent: '',
          status: stringValue(message.status, 'complete'),
          createdAt: stringValue(message.createdAt, now),
          updatedAt: stringValue(message.updatedAt, now),
          promptTokens:
            typeof message.promptTokens === 'number' ? message.promptTokens : null,
          completionTokens:
            typeof message.completionTokens === 'number' ? message.completionTokens : null,
          modelId: typeof message.modelId === 'string' ? message.modelId : null,
          sequenceNo: index,
        });
        messageCount += 1;
        ids.push('message:' + messageId + ':' + String(stringValue(message.content).length));
      }

      const meta = conversationMeta[novelId] ?? {};
      const memoryGroups: [string, unknown][] = [
        ['memory', meta.memory],
        ['long_term', meta.longTermMemory],
        ['mid_term', meta.midTermMemories],
        ['short_term', meta.shortTermMemories],
      ];
      for (const [memoryType, rawMemory] of memoryGroups) {
        const values = Array.isArray(rawMemory) ? rawMemory : [rawMemory];
        for (let index = 0; index < values.length; index += 1) {
          const content = stringValue(values[index]);
          if (!content) {
            continue;
          }
          const memoryId = novelId + '-memory-' + memoryType + '-' + String(index);
          await upsertMemory(db, {
            id: memoryId,
            novelId,
            memoryType,
            content,
            sourceMessageId: null,
            sourceChapterId: null,
            sourceType: 'legacy',
            sourceId: null,
            stateVersion: 0,
            confidence: 1,
            stale: 0,
            createdAt: now,
            updatedAt: now,
          });
          memoryCount += 1;
          ids.push('memory:' + memoryId + ':' + String(content.length));
        }
      }
    }
  });

  return {
    novels: ids.filter((id) => id.startsWith('novel:')).length,
    messages: messageCount,
    chapters: chapterCount,
    memories: memoryCount,
    fingerprint: fingerprint(ids),
  };
}
