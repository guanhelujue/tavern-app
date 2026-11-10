import type { Message, NovelChapter } from '@/types/tavern';
import { stripAssistantContentForExport } from '@/utils/status-bar-html';

/** Explicit, repeatable conversion. Original messages remain untouched. */
export function buildLegacyNovelChapters(novelId: string, messages: Message[], existing: NovelChapter[]): NovelChapter[] {
  const ids = new Set(existing.map((chapter) => chapter.id));
  let index = Math.max(0, ...existing.map((chapter) => chapter.index));
  let prompt = '';
  const chapters: NovelChapter[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      prompt = message.content;
      continue;
    }
    const id = `legacy-${novelId}-${message.id}`;
    if (message.status !== 'complete' || ids.has(id)) continue;
    const content = stripAssistantContentForExport(message.content).trim();
    if (!content) continue;
    index += 1;
    chapters.push({
      id, index, title: `第${index}章`, summary: '', goal: prompt, content,
      contentStatus: 'loaded', status: 'draft', aiGenerated: true,
      createdAt: message.createdAt, updatedAt: message.updatedAt,
    });
    ids.add(id);
  }
  return chapters;
}
