import { getAppDatabase } from '@/db/database';
import { Platform } from 'react-native';
import { markMemoriesStaleByChapter } from '@/db/repositories/memories';
import { markStoryFactsStaleByChapter } from '@/db/repositories/story-facts';
import { invalidateStoryAnalysis } from '@/services/novel-story-state';
import type { Novel, NovelStoryAnalysis } from '@/types/tavern';

function markCollectionStale<T extends { stale?: boolean; stateVersion?: number }>(
  items: T[] | undefined,
  stateVersion: number,
) {
  return (items ?? []).map((item) => ({ ...item, stale: true, stateVersion }));
}

/** Pure invalidation for the in-memory compatibility projection. */
export function invalidateNovelDerivedState(
  novel: Novel,
  analysis: NovelStoryAnalysis | null,
  fromChapterIndex: number,
) {
  const stateVersion = Math.max(1, (analysis?.stateVersion ?? 0) + 1);
  const nextNovel: Novel = {
    ...novel,
    characterDossiers: markCollectionStale(novel.characterDossiers, stateVersion),
    loreEntries: markCollectionStale(novel.loreEntries, stateVersion),
    relationGraphs: (novel.relationGraphs ?? []).map((graph) => ({
      ...graph,
      stale: true,
      stateVersion,
      nodes: markCollectionStale(graph.nodes, stateVersion),
      edges: markCollectionStale(graph.edges, stateVersion),
    })),
    novelStoryAnalysis: undefined,
    novelForecasts: (novel.novelForecasts ?? []).map((item) => ({ ...item, status: 'stale' as const })),
    novelContinuationPlans: (novel.novelContinuationPlans ?? []).map((item) => ({ ...item, status: 'stale' as const })),
    novelBranches: (novel.novelBranches ?? []).map((item) => ({ ...item, status: 'stale' as const })),
  };
  const nextAnalysis = invalidateStoryAnalysis(analysis, fromChapterIndex);
  if (nextAnalysis) {
    nextAnalysis.stateVersion = stateVersion;
    nextAnalysis.worldFacts = markCollectionStale(nextAnalysis.worldFacts, stateVersion);
    nextAnalysis.characters = markCollectionStale(nextAnalysis.characters, stateVersion);
    nextAnalysis.characterStates = markCollectionStale(nextAnalysis.characterStates, stateVersion);
    nextAnalysis.relationships = markCollectionStale(nextAnalysis.relationships, stateVersion);
    nextAnalysis.timeline = markCollectionStale(nextAnalysis.timeline, stateVersion);
    nextAnalysis.plotThreads = markCollectionStale(nextAnalysis.plotThreads, stateVersion);
    nextAnalysis.hooks = markCollectionStale(nextAnalysis.hooks, stateVersion);
    nextAnalysis.chapterSummaries = markCollectionStale(nextAnalysis.chapterSummaries, stateVersion);
  }
  return {
    novel: nextAnalysis ? { ...nextNovel, novelStoryAnalysis: nextAnalysis } : nextNovel,
    analysis: nextAnalysis,
    stateVersion,
  };
}

/** Persist invalidation markers so a rebuild can be resumed after a crash. */
export async function invalidateNovelDerivedStateInDatabase(
  novelId: string,
  chapterId: string,
) {
  if (Platform.OS === 'web') return;
  const db = await getAppDatabase();
  const now = new Date().toISOString();
  await markMemoriesStaleByChapter(db, novelId, chapterId, now);
  await markStoryFactsStaleByChapter(db, novelId, chapterId, now);
}
