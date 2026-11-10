import type { NovelChapter, NovelGenerationJob } from '@/types/tavern';
import type { ImportedNovelChapter, ImportedNovelText } from '@/utils/novel-import';

export type NovelTextImportValidation = { ok: true } | { ok: false; reason: string };

export function getNextImportedChapterIndex(chapters: readonly NovelChapter[] = []): number {
  return Math.max(0, ...chapters.map((chapter) => Number.isFinite(chapter.index) ? chapter.index : 0)) + 1;
}

export function validateNovelTextImport({
  imported,
  existingChapters = [],
  generationJobs = [],
  legacyChapters = [],
}: {
  imported?: Pick<ImportedNovelText, 'chapters'> | null;
  existingChapters?: readonly NovelChapter[];
  generationJobs?: readonly Pick<NovelGenerationJob, 'status'>[];
  legacyChapters?: readonly Pick<NovelChapter, 'status' | 'content'>[];
}): NovelTextImportValidation {
  if (!imported?.chapters?.some((chapter) => chapter.content.trim())) {
    return { ok: false, reason: '文件中没有可导入的正文。' };
  }
  if (existingChapters.some((chapter) => chapter.status === 'draft')) {
    return { ok: false, reason: '当前作品有未定稿章节，请先处理草稿后再导入正文。' };
  }
  if (generationJobs.some((job) => job.status === 'running' || job.status === 'paused' || job.status === 'failed')) {
    return { ok: false, reason: '当前有章节生成任务正在运行或等待恢复，请先完成或放弃任务。' };
  }
  if (legacyChapters.some((chapter) => chapter.status === 'draft' && chapter.content.trim())) {
    return { ok: false, reason: '当前作品还有未整理的旧聊天正文，请先整理为章节后再导入。' };
  }
  return { ok: true };
}

export function buildImportedNovelChapters(
  imported: readonly ImportedNovelChapter[],
  existingChapters: readonly NovelChapter[],
  now = new Date().toISOString(),
): NovelChapter[] {
  const start = getNextImportedChapterIndex(existingChapters);
  return imported
    .map((chapter) => ({ title: chapter.title.trim(), content: chapter.content.trim() }))
    .filter((chapter) => chapter.content.length > 0)
    .map(({ title, content }, offset) => ({
      id: `chapter-import-${Date.now()}-${offset}-${Math.random().toString(36).slice(2, 8)}`,
      index: start + offset,
      title: title || `第${start + offset}章`,
      summary: '',
      goal: '',
      content,
      contentStatus: 'loaded' as const,
      status: 'final' as const,
      aiGenerated: false,
      createdAt: now,
      updatedAt: now,
    }));
}
