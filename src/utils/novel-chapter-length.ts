import { NOVEL_TARGET_WORDS_RANGE } from '@/constants/novel-continuation';

export const CHAPTER_MIN_LENGTH_RATIO = 0.9;

/** Match the editor's count: body characters, excluding whitespace. */
export function countChapterWords(content: string): number {
  return content.replace(/\s/g, '').length;
}

export function parseChapterTargetWords(instruction: string): number | undefined {
  const matches = [...instruction.matchAll(/(\d[\d,，]*(?:\.\d+)?)\s*([千万])?\s*字/g)];
  const match = matches.at(-1);
  if (!match) return undefined;
  const value = Number(match[1].replace(/[,，]/g, '')) * (match[2] === '万' ? 10000 : match[2] === '千' ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export function resolveChapterTargetWords(targetWords: number | undefined, instruction = '', fallback = 1800): number {
  const requested = targetWords ?? parseChapterTargetWords(instruction) ?? fallback;
  const value = Number.isFinite(requested) && requested > 0 ? requested : 1800;
  return Math.max(NOVEL_TARGET_WORDS_RANGE[0], Math.min(NOVEL_TARGET_WORDS_RANGE[1], Math.round(value)));
}

export function checkChapterLength(content: string, targetWords: number) {
  const actualWords = countChapterWords(content);
  const minimumWords = Math.ceil(targetWords * CHAPTER_MIN_LENGTH_RATIO);
  return {
    actualWords,
    minimumWords,
    passed: actualWords >= minimumWords,
    message: `本章正文仅 ${actualWords} 字，目标 ${targetWords} 字，至少需要 ${minimumWords} 字（90%）。已退回补写，草稿保留。`,
  };
}

export function assertChapterLength(content: string, targetWords?: number): void {
  if (!targetWords) return;
  const result = checkChapterLength(content, targetWords);
  if (!result.passed) throw new Error(result.message);
}
