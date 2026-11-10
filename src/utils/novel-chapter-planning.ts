import type { NovelChapterPlanning } from '@/types/tavern';

export const CHAPTER_PLANNING_FIELDS = [
  { key: 'conflict', label: '本章冲突', placeholder: '谁与谁、哪种选择或规则发生冲突？' },
  { key: 'keyEvents', label: '关键事件', placeholder: '本章要发生的事，以及带来的变化' },
  { key: 'participants', label: '出场人物', placeholder: '本章涉及的人物' },
  { key: 'scene', label: '时间与场景', placeholder: '故事发生的时间、地点与环境' },
] as const;

export function normalizeChapterPlanning(value: unknown): NovelChapterPlanning {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(CHAPTER_PLANNING_FIELDS.map(({ key }) => [key, typeof record[key] === 'string' ? record[key] : ''])) as NovelChapterPlanning;
}

export function hasChapterPlanning(value?: NovelChapterPlanning): boolean {
  return Boolean(value && CHAPTER_PLANNING_FIELDS.some(({ key }) => value[key].trim()));
}

export function buildChapterInstruction(prompt: string, planning?: NovelChapterPlanning): string {
  const details = planning ? CHAPTER_PLANNING_FIELDS
    .filter(({ key }) => planning[key].trim())
    .map(({ key, label }) => `${label}：${planning[key].trim()}`) : [];
  return [prompt.trim(), details.length ? `【本章规划】\n${details.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
