import type { Novel, NovelForeshadowing } from '@/types/tavern';
import { readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Stable, local id for a legacy open-thread import. */
export function legacyForeshadowingId(thread: string): string {
  let hash = 2166136261;
  for (const char of thread) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `legacy-thread-${(hash >>> 0).toString(36)}`;
}

/** Convert legacy blueprint threads into ledger entries without mutating the blueprint. */
export function importLegacyForeshadowings(
  novel: Novel,
  existing: NovelForeshadowing[] = novel.foreshadowings ?? [],
): NovelForeshadowing[] {
  const threads = readNovelBlueprint(novel).longForm.openThreads.map(clean).filter(Boolean);
  const next = [...existing];
  for (const thread of threads) {
    const id = legacyForeshadowingId(thread);
    const duplicate = next.some((item) => item.id === id || item.keyword.trim().toLocaleLowerCase() === thread.toLocaleLowerCase());
    if (duplicate) continue;
    next.push({
      id,
      keyword: thread,
      description: thread,
      status: 'open',
      plantedChapterIndex: 0,
      createdAt: new Date().toISOString(),
      note: '从旧版大纲的长期悬念导入；尚未指定埋设章节。',
      locked: true,
    });
  }
  return next;
}

export function formatNovelForeshadowingContext(novel: Novel): string {
  const items = novel.foreshadowings ?? [];
  if (!items.length) return '';
  const lines = items.map((item) => {
    const placement = item.plantedChapterIndex > 0 ? `第${item.plantedChapterIndex}章埋设` : '待埋设';
    const due = item.dueAfterChapterIndex ? `，预计第${item.dueAfterChapterIndex}章后回收` : '';
    const state = item.status === 'open' ? '未回收' : item.status === 'fulfilled' ? `已回收${item.fulfilledChapterIndex ? `（第${item.fulfilledChapterIndex}章）` : ''}` : '已放弃（不要重新引入）';
    return `- ${item.keyword}｜${state}｜${placement}${due}：${item.description}${item.note ? `（备注：${item.note}）` : ''}`;
  });
  return `【伏笔账本】\n这是作者维护的规划；同名伏笔与旧分析冲突时以账本为准。待埋设不代表已经发生；已回收不要再次设为悬念，已放弃不要重新引入。\n${lines.join('\n')}`;
}
