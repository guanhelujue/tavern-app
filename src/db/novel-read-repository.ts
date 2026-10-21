import { getAppDatabase } from '@/db/database';
import {
  getChapterContent,
  listChapterMetadataPage,
} from '@/db/repositories/chapters';
import { listMessagePage, listMessagePageByWorld } from '@/db/repositories/messages';
import { listMemories } from '@/db/repositories/memories';
import { NOVEL_MESSAGE_PAGE_SIZE } from '@/constants/novel-chat';
import type { Message } from '@/types/tavern';

export type PageResult<T> = {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
  stateVersion: number;
};

function rowToMessage(row: Awaited<ReturnType<typeof listMessagePage>>[number]): Message {
  return {
    id: row.id,
    characterId: '',
    role: row.role as Message['role'],
    content: row.content,
    reasoningContent: row.reasoningContent ?? undefined,
    status: row.status as Message['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    promptTokens: row.promptTokens ?? undefined,
    completionTokens: row.completionTokens ?? undefined,
    modelId: row.modelId ?? undefined,
  };
}

const clampLimit = (value: number | undefined, max: number, fallback = 50) =>
  Math.max(1, Math.min(max, Math.round(value ?? fallback)));

export async function loadRecentNovelMessages(
  novelId: string,
  options?: { limit?: number; beforeSequenceNo?: number; afterSequenceNo?: number; worldId?: string },
): Promise<PageResult<Awaited<ReturnType<typeof listMessagePage>>[number]>> {
  const limit = clampLimit(options?.limit, 100, NOVEL_MESSAGE_PAGE_SIZE);
  const db = await getAppDatabase();
  const rows = options?.worldId
    ? await listMessagePageByWorld(db, novelId, options.worldId, {
        ...options,
        limit: Math.min(200, limit + 1),
      })
    : await listMessagePage(db, novelId, {
        limit: Math.min(200, limit + 1),
        beforeSequenceNo: options?.beforeSequenceNo,
        afterSequenceNo: options?.afterSequenceNo,
      });
  const isAfter = typeof options?.afterSequenceNo === 'number';
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  if (!isAfter) visible.reverse();
  return {
    items: visible,
    nextCursor: hasMore ? (isAfter ? visible.at(-1)?.sequenceNo ?? null : visible[0]?.sequenceNo ?? null) : null,
    hasMore,
    stateVersion: visible.at(-1)?.sequenceNo ?? 0,
  };
}


export async function loadAllNovelChapterMetadata(novelId: string) {
  const db = await getAppDatabase();
  const rows: Awaited<ReturnType<typeof listChapterMetadataPage>> = [];
  let beforeChapterIndex: number | undefined = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const page = await listChapterMetadataPage(db, novelId, { limit: 200, beforeChapterIndex });
    if (!page.length) break;
    rows.push(...page);
    if (page.length < 200) break;
    beforeChapterIndex = page.at(-1)?.chapterIndex;
  }
  return rows.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

export async function loadNovelChapterContent(chapterId: string) {
  const db = await getAppDatabase();
  return getChapterContent(db, chapterId);
}


/** Returns a bounded, chronological history for prompt construction. */
export async function loadNovelConversationForPrompt(novelId: string, limit = 200, worldId?: string) {
  const page = await loadRecentNovelMessages(novelId, { limit: Math.min(500, Math.max(20, limit)), worldId });
  return page.items.map(rowToMessage);
}

export async function loadNovelMemoryState(novelId: string, worldId?: string) {
  const db = await getAppDatabase();
  const rows = await listMemories(db, novelId, { limit: 200, worldId });
  const byMemoryIndex = (a: { memoryType: string }, b: { memoryType: string }) => {
    const aIndex = Number(a.memoryType.match(/_(\d+)$/)?.[1] ?? 0);
    const bIndex = Number(b.memoryType.match(/_(\d+)$/)?.[1] ?? 0);
    return aIndex - bIndex;
  };
  const longTermMemory = rows.find((row) => row.memoryType === 'long_term')?.content ?? '';
  const midTermMemories = rows
    .filter((row) => row.memoryType.startsWith('mid_term'))
    .sort(byMemoryIndex)
    .map((row) => row.content);
  const shortTermMemories = rows
    .filter((row) => row.memoryType.startsWith('short_term'))
    .sort(byMemoryIndex)
    .map((row) => row.content);
  return { longTermMemory, midTermMemories, shortTermMemories };
}
