import type { Novel, NovelChapter, NovelRewriteAudit } from '@/types/tavern';

const DERIVED_KEYS = new Set(['createdAt', 'updatedAt', 'stateVersion', 'stale']);

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).filter((key) => !DERIVED_KEYS.has(key)).sort().map((key) =>
    `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`,
  ).join(',')}}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `rewrite-source-fnv1a-${(result >>> 0).toString(16).padStart(8, '0')}`;
}

export function createNovelAuditSourceFingerprint(input: {
  chapter: Pick<NovelChapter, 'id' | 'index' | 'title' | 'content'> & Partial<Pick<NovelChapter, 'goal' | 'planning' | 'summary' | 'targetWords'>>;
  writingContext: unknown;
}): string {
  return hash(stableSerialize({ chapter: input.chapter, writingContext: input.writingContext }));
}

export function getNovelAuditSourceFingerprint(novel: Novel, chapter: NovelChapter): string {
  return createNovelAuditSourceFingerprint({
    chapter: {
      id: chapter.id,
      index: chapter.index,
      title: chapter.title,
      content: chapter.content,
      summary: chapter.summary,
      goal: chapter.goal,
      planning: chapter.planning,
      targetWords: chapter.targetWords,
    },
    writingContext: {
      foundationPrompt: novel.foundationPrompt,
      projectBrief: novel.projectBrief,
      systemPrompt: novel.systemPrompt,
      writingStyle: novel.writingStyle,
      worldName: novel.worldName,
      worldEra: novel.worldEra,
      worldConflict: novel.worldConflict,
      worldTone: novel.worldTone,
      gameRules: novel.gameRules,
      mainPlot: novel.mainPlot,
      initialStoryState: novel.initialStoryState,
      cast: novel.cast,
      characterDossiers: novel.characterDossiers,
      loreEntries: novel.loreEntries,
      outline: novel.outline,
      continuationSettings: novel.continuationSettings,
      previousChapters: (novel.chapters ?? [])
        .filter((item) => item.index < chapter.index)
        .map((item) => ({
          id: item.id,
          index: item.index,
          status: item.status,
          content: item.content,
          summary: item.summary,
        })),
    },
  });
}

/** Legacy reports without a fingerprint are history, never current validation. */
export function isNovelRewriteAuditCurrent(
  audit: Pick<NovelRewriteAudit, 'chapterId' | 'sourceFingerprint' | 'stale'> | undefined,
  chapterId: string,
  sourceFingerprint: string,
): boolean {
  return Boolean(
    audit &&
      audit.stale !== true &&
      audit.chapterId === chapterId &&
      audit.sourceFingerprint &&
      audit.sourceFingerprint === sourceFingerprint,
  );
}
