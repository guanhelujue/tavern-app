import type { Novel } from '@/types/tavern';
import { NOVEL_TARGET_WORDS_RANGE } from '@/constants/novel-continuation';

export type NovelOutlineGenerationOptions = {
  targetChapterCount?: number;
  targetWords?: number;
  /** Explicit first chapter for a deliberate whole-book rebuild. */
  startChapterIndex?: number;
  userBrief?: string;
};

const MIN_OUTLINE_CHAPTERS = 1;
const MAX_OUTLINE_CHAPTERS = 10_000;
const MIN_OUTLINE_WORDS = 1_000;
const MAX_OUTLINE_WORDS = NOVEL_TARGET_WORDS_RANGE[1] * MAX_OUTLINE_CHAPTERS;

function normalizeStartChapterIndex(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.trunc(value));
}

/** Derive the whole-outline word count from its two editable inputs. */
export function calculateNovelOutlineTotalWords(
  chapterCount: unknown,
  wordsPerChapter: unknown,
): number {
  if (
    (typeof chapterCount !== 'number' && typeof chapterCount !== 'string') ||
    (typeof wordsPerChapter !== 'number' && typeof wordsPerChapter !== 'string')
  ) {
    return 0;
  }
  const chapters = Number(chapterCount);
  const words = Number(wordsPerChapter);
  if (!Number.isFinite(chapters) || !Number.isFinite(words) || chapters <= 0 || words <= 0) {
    return 0;
  }
  return Math.trunc(chapters) * Math.trunc(words);
}

/** Keep chapter-count input consistent across the world-outline and workbench flows. */
export function clampNovelOutlineChapterCount(value: unknown, fallback = 12): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  const safeFallback = Number.isFinite(fallback) ? Math.trunc(fallback) : 12;
  const count = Number.isFinite(parsed) ? Math.trunc(parsed) : safeFallback;
  return Math.min(MAX_OUTLINE_CHAPTERS, Math.max(MIN_OUTLINE_CHAPTERS, count));
}

function clampOutlineWords(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(MAX_OUTLINE_WORDS, Math.max(MIN_OUTLINE_WORDS, Math.round(value)));
}

function buildProjectBriefText(novel: Pick<Novel, 'projectBrief'>): string | undefined {
  const brief = novel.projectBrief;
  if (!brief) {
    return undefined;
  }

  const lines = [
    ['故事 premise', brief.premise],
    ['主题', brief.theme],
    ['主角弧光', brief.protagonistArc],
    ['结局方向', brief.ending],
    ['第一章目标', brief.firstChapterGoal],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([label, value]) => `${label}：${String(value).trim()}`);

  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Resolve an outline request from explicit options and the persisted project brief.
 * Explicit values always win, while workbench novels inherit their planned chapter count.
 */
export function resolveNovelOutlineOptions(
  novel: Pick<Novel, 'projectBrief' | 'continuationSettings'>,
  overrides: NovelOutlineGenerationOptions = {},
): NovelOutlineGenerationOptions {
  const requestedCount = overrides.targetChapterCount ?? novel.projectBrief?.plannedChapters;
  const targetChapterCount = requestedCount === undefined
    ? undefined
    : clampNovelOutlineChapterCount(requestedCount);
  const inheritedWords = targetChapterCount === undefined
    ? undefined
    : targetChapterCount * (novel.continuationSettings?.targetWords ?? 1_800);
  const targetWords = clampOutlineWords(overrides.targetWords ?? inheritedWords);
  const startChapterIndex = normalizeStartChapterIndex(overrides.startChapterIndex);
  const userBrief = overrides.userBrief !== undefined
    ? overrides.userBrief.trim()
    : buildProjectBriefText(novel);

  return {
    ...(targetChapterCount === undefined ? {} : { targetChapterCount }),
    ...(targetWords === undefined ? {} : { targetWords }),
    ...(startChapterIndex === undefined ? {} : { startChapterIndex }),
    ...(userBrief ? { userBrief } : {}),
  };
}

/** Normalize direct service calls that do not have a persisted novel brief. */
export function normalizeNovelOutlineOptions(
  options: NovelOutlineGenerationOptions,
): NovelOutlineGenerationOptions {
  const targetChapterCount = options.targetChapterCount === undefined
    ? undefined
    : clampNovelOutlineChapterCount(options.targetChapterCount);
  const targetWords = clampOutlineWords(options.targetWords);
  const startChapterIndex = normalizeStartChapterIndex(options.startChapterIndex);

  return {
    ...(targetChapterCount === undefined ? {} : { targetChapterCount }),
    ...(targetWords === undefined ? {} : { targetWords }),
    ...(startChapterIndex === undefined ? {} : { startChapterIndex }),
    ...(options.userBrief?.trim() ? { userBrief: options.userBrief.trim() } : {}),
  };
}
