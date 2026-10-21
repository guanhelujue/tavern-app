import type { Novel } from '@/types/tavern';

export type NovelShelfRoute = 'novel' | 'workbench';

/** Imported chapter data or an explicit import marker identifies continuation projects. */
export function isNovelContinuationProject(
  novel: Pick<Novel, 'isContinuationProject' | 'chapters'>,
): boolean {
  return novel.isContinuationProject === true || (novel.chapters?.length ?? 0) > 0;
}

/** Long-form workbench books and imported books both reopen in the workbench. */
export function getNovelShelfRoute(
  novel: Pick<Novel, 'creationMode' | 'isContinuationProject' | 'chapters'>,
): NovelShelfRoute {
  return novel.creationMode === 'workbench' || isNovelContinuationProject(novel)
    ? 'workbench'
    : 'novel';
}
