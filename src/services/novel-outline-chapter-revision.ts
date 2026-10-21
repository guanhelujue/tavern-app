import type { NovelVolumeChapter } from '../types/tavern';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Convert an untrusted model payload into a patch locked to one chapter. */
export function parseNovelOutlineChapterRevision(
  payload: unknown,
  target: NovelVolumeChapter,
): NovelVolumeChapter {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const title = text(record.title);
  const goal = text(record.goal);
  if (!title || !goal) throw new Error('单章修改结果缺少标题或章节目标，请重试。');

  return {
    index: target.index,
    title,
    goal,
    sceneEnd: typeof record.sceneEnd === 'boolean' ? record.sceneEnd : target.sceneEnd,
  };
}
