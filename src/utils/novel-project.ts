import type { NovelOutline, NovelProjectBrief } from '@/types/tavern';

/**
 * Seed a transparent, user-editable outline from the creation brief. AI may expand it later,
 * but the author's initial intent is never hidden in a prompt-only field.
 */
export function createOutlineFromProjectBrief(
  brief: NovelProjectBrief,
  now = new Date().toISOString(),
): NovelOutline {
  const plannedChapters = Math.max(1, Math.min(999, Math.round(brief.plannedChapters || 20)));
  const firstGoal = brief.firstChapterGoal.trim() || '建立主角的日常、欲望与首个不可回避的冲突。';
  const ending = brief.ending.trim() || '结局方向待作者在工作台中补充。';

  return {
    summary: [
      brief.premise.trim(),
      brief.theme.trim() ? `主题：${brief.theme.trim()}` : '',
      brief.protagonistArc.trim() ? `主角弧：${brief.protagonistArc.trim()}` : '',
      `结局方向：${ending}`,
    ].filter(Boolean).join('\n'),
    volumes: [{
      id: 'volume-1',
      title: '第一卷',
      summary: `开篇卷：建立主线，并朝全书约 ${plannedChapters} 章的目标推进。`,
      chapters: [{ index: 1, title: '第一章', goal: firstGoal, sceneEnd: false }],
    }],
    updatedAt: now,
  };
}
