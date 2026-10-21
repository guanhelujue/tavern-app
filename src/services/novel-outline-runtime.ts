import type { Novel, NovelOutline, NovelVolumeChapter } from '@/types/tavern';
import { getActiveQuickTravelWorld } from '@/utils/quick-travel';

export const NOVEL_OUTLINE_COMPLETED_MARKER = '【大纲已完成】';

export type NovelOutlineRuntime = {
  scope: 'novel' | 'world';
  scopeName: string;
  outline: NovelOutline;
  previous?: NovelVolumeChapter;
  current: NovelVolumeChapter;
  next?: NovelVolumeChapter;
  targetWords: number;
};

export function flattenNovelOutline(outline?: NovelOutline): NovelVolumeChapter[] {
  return (outline?.volumes ?? [])
    .flatMap((volume) => volume.chapters)
    .sort((left, right) => left.index - right.index);
}

export function parseExplicitChapterIndex(value?: string): number | undefined {
  const match = (value ?? '').slice(0, 500).match(
    /第\s*([0-9]{1,4}|[一二三四五六七八九十百千〇零]+)\s*章/u,
  );
  if (!match) return undefined;
  if (/^\d+$/.test(match[1])) {
    const number = Number.parseInt(match[1], 10);
    return number > 0 ? number : undefined;
  }

  const digits: Record<string, number> = {
    〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  for (const character of match[1]) {
    if (character in units) {
      section = (section || 1) * units[character];
      total += section;
      section = 0;
    } else if (character in digits) {
      section = digits[character];
    }
  }
  const number = total + section;
  return number > 0 ? number : undefined;
}

function chapterFromMarker(chapters: NovelVolumeChapter[], marker?: string) {
  const value = marker?.trim() ?? '';
  if (value === NOVEL_OUTLINE_COMPLETED_MARKER) return undefined;

  const explicitIndex = parseExplicitChapterIndex(value);
  if (explicitIndex !== undefined) {
    const indexed = chapters.find((chapter) => chapter.index === explicitIndex);
    if (indexed) return indexed;
  }

  if (value) {
    const titled = chapters.find((chapter) =>
      chapter.title.trim() && (value.includes(chapter.title.trim()) || chapter.title.trim().includes(value)),
    );
    if (titled) return titled;
  }

  return chapters[0];
}

export function resolveNovelOutlineRuntime(
  novel: Novel,
  currentChapterMarker?: string,
): NovelOutlineRuntime | null {
  const world = getActiveQuickTravelWorld(novel);
  if (world?.runtime.novelGenerationEnabled && world.outline) {
    const chapters = flattenNovelOutline(world.outline);
    const current = chapters.find((chapter) => chapter.index === Math.max(1, world.runtime.currentChapter || 1));
    if (!current) return null;
    const position = chapters.indexOf(current);
    return {
      scope: 'world',
      scopeName: world.name || '当前小世界',
      outline: world.outline,
      previous: chapters[position - 1],
      current,
      next: chapters[position + 1],
      targetWords: Math.max(1000, world.runtime.novelGenerationTargetWords || 4500),
    };
  }

  if (!novel.outline) return null;
  const chapters = flattenNovelOutline(novel.outline);
  const current = chapterFromMarker(chapters, currentChapterMarker);
  if (!current) return null;
  const position = chapters.indexOf(current);
  return {
    scope: 'novel',
    scopeName: novel.name || '当前小说',
    outline: novel.outline,
    previous: chapters[position - 1],
    current,
    next: chapters[position + 1],
    targetWords: Math.max(1000, novel.continuationSettings?.targetWords || 2000),
  };
}

/** Resolve one outline turn only from an explicit `第 X 章` in the user's input. */
export function resolveNovelOutlineTurnRuntime(
  novel: Novel,
  userInput?: string,
): NovelOutlineRuntime | null {
  const requestedIndex = parseExplicitChapterIndex(userInput);
  if (requestedIndex === undefined) return null;

  const world = getActiveQuickTravelWorld(novel);
  if (world?.runtime.novelGenerationEnabled && world.outline) {
    const chapters = flattenNovelOutline(world.outline);
    const current = chapters.find((chapter) => chapter.index === requestedIndex);
    if (!current) return null;
    const position = chapters.indexOf(current);
    return {
      scope: 'world',
      scopeName: world.name || '当前小世界',
      outline: world.outline,
      previous: chapters[position - 1],
      current,
      next: chapters[position + 1],
      targetWords: Math.max(1000, world.runtime.novelGenerationTargetWords || 4500),
    };
  }

  if (!novel.outline) return null;
  const chapters = flattenNovelOutline(novel.outline);
  const current = chapters.find((chapter) => chapter.index === requestedIndex);
  if (!current) return null;
  const position = chapters.indexOf(current);
  return {
    scope: 'novel',
    scopeName: novel.name || '当前小说',
    outline: novel.outline,
    previous: chapters[position - 1],
    current,
    next: chapters[position + 1],
    targetWords: Math.max(1000, novel.continuationSettings?.targetWords || 2000),
  };
}

export function formatNovelOutlineChapterMarker(chapter: NovelVolumeChapter) {
  return `第${chapter.index}章：${chapter.title}`;
}

export function buildNovelOutlineChapterGuidance(runtime: NovelOutlineRuntime | null) {
  if (!runtime) return '';
  return [
    '【当前章节任务·最高优先级】',
    runtime.scope === 'world' ? `当前小世界：${runtime.scopeName}` : `当前小说：${runtime.scopeName}`,
    runtime.outline.summary ? `主线：${runtime.outline.summary}` : '',
    runtime.previous
      ? `上一章衔接：第${runtime.previous.index}章《${runtime.previous.title}》；目标：${runtime.previous.goal}`
      : '这是大纲第一章，无上一章衔接。',
    `第${runtime.current.index}章《${runtime.current.title}》`,
    `本章目标：${runtime.current.goal}`,
    `目标篇幅：约 ${runtime.targetWords} 字`,
    runtime.next
      ? `下一章边界：第${runtime.next.index}章《${runtime.next.title}》（本章不得提前展开）`
      : '这是当前大纲的最后一章，请完成既定收束，不要自行开启大纲外的新章节。',
    '本轮只完成这一章，并在本章落点处结束。只输出章节标题和正文。',
  ].filter(Boolean).join('\n');
}
