import { createDefaultSessionConfigFields } from '@/constants/session-config';
import type { Novel, NovelConversation, NovelSlotBook } from '@/types/tavern';
import { normalizeNovelConversation } from '@/utils/session-config';

export function createEmptyNovelConversation(
  novelId: string,
  title: string,
  timestamp: string,
): NovelConversation {
  return normalizeNovelConversation({
    id: `${novelId}-conversation`,
    novelId,
    title,
    memory: '',
    longTermMemory: '',
    midTermMemories: [],
    shortTermMemories: [],
    lastMessageAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...createDefaultSessionConfigFields(),
  });
}

function stripNovelRequestRuntimeMeta(meta: NovelConversation): NovelConversation {
  const {
    activeRequestId: _activeRequestId,
    requestStatus: _requestStatus,
    lastRequestError: _lastRequestError,
    agentStage: _agentStage,
    ...persistent
  } = meta;
  return persistent;
}

const NOVEL_BODY_PERSISTENCE_KEYS = [
  'chapters',
  'chapterBackups',
  'audits',
  'novelStoryAnalysis',
  'novelStoryFacts',
  'novelForecasts',
  'novelContinuationPlans',
  'novelBranches',
  'novelGenerationJobs',
  'novelStorySnapshots',
  'novelRewriteAudits',
] as const;

function stripCastBiographies(cast: Novel['cast'] | undefined): Novel['cast'] | undefined {
  return cast?.map(({ biographies: _biographies, ...character }) => character);
}

/** Human-only long-form biographies live in their own storage collection. */
export function stripNovelCharacterBiographiesForPersistence(novel: Novel): Novel {
  return {
    ...novel,
    cast: stripCastBiographies(novel.cast) ?? [],
    quickTravel: novel.quickTravel
      ? {
          ...novel.quickTravel,
          worlds: novel.quickTravel.worlds.map((world) => ({
            ...world,
            cast: stripCastBiographies(world.cast) ?? [],
          })),
        }
      : novel.quickTravel,
  };
}

export function stripNovelBodyForPersistence(novel: Novel): Novel {
  const next = stripNovelCharacterBiographiesForPersistence(novel);
  for (const key of NOVEL_BODY_PERSISTENCE_KEYS) {
    delete next[key];
  }
  return next;
}

export function stripConversationForPersistence(meta: NovelConversation): NovelConversation {
  return {
    ...stripNovelRequestRuntimeMeta(meta),
    memory: '',
    longTermMemory: '',
    midTermMemories: [],
    shortTermMemories: [],
    memoryStale: false,
  };
}

export function stripSlotMessagesForPersistence(book: NovelSlotBook): NovelSlotBook {
  return {
    ...book,
    slots: book.slots.map((slot) => ({ ...slot, snapshotVersion: undefined, messages: [] })),
    previousSnapshot: book.previousSnapshot
      ? { ...book.previousSnapshot, snapshotVersion: undefined, messages: [] }
      : null,
  };
}
