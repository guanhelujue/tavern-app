import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createEmptyProvider, DEFAULT_PROVIDERS } from '@/constants/providers';
import {
  createImageProvider,
  defaultImageGenerationSettings,
  normalizeImageGenerationSettings,
} from '@/constants/image-models';
import { modelIdsEqual } from '@/constants/provider-capabilities';
import {
  DEFAULT_COLOR_SCHEME_PREFERENCE,
  type ColorSchemePreference,
} from '@/constants/theme';
import { requestChatCompletion, requestCompletionWithUsage } from '@/services/llm';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import { buildChapterInstruction, normalizeChapterPlanning } from '@/utils/novel-chapter-planning';
import { assertChapterLength, checkChapterLength, countChapterWords, resolveChapterTargetWords } from '@/utils/novel-chapter-length';
import {
  generateNovelDirectPlan,
  type GenerateNovelDirectPlanInput,
} from '@/services/novel-direct-agent';
import {
  generateNovelCharacterBrief,
} from '@/services/novel-character-agent';
import {
  buildNovelAgentHandoff,
  runNovelAgentCollaboration,
} from '@/services/novel-agent-collaboration';
import {
  formatNovelEditorReview,
  generateNovelEditorReview,
  shouldRepairNovelDraft,
} from '@/services/novel-editor-agent';
import { shouldRunNovelEditor } from '@/services/novel-agent-review-policy';
import {
  captureNovelPostTurnToken,
  invalidateNovelPostTurn,
  isNovelPostTurnTokenCurrent,
  type NovelPostTurnToken,
} from '@/services/novel-post-turn-validity';
import {
  loadImageProviderSecrets,
  loadProviderSecrets,
  removeImageProviderApiKey,
  removeProviderApiKey,
  saveImageProviderApiKey,
  saveProviderApiKey,
} from '@/services/provider-secrets';
import { runMigrationCoordinator } from '@/db/migration-coordinator';
import {
  auditChapterWithRules,
  factCheckChapter,
  generateOutline,
  generateOutlineInVolumes,
  getFinalChapters,
  getNextChapterIndex,
  resolveContinuationSettings,
  syncForeshadowings,
} from '@/services/novel-continuation-pipeline';
import {
  analyzeStoryStateIncrementally,
  dedupeCharactersInAnalysis,
  detectMisalignedStoryAnalysis,
  isStoryAnalysisFresh,
  resetMisalignedStoryAnalysis,
  type LlmCompletion,
} from '@/services/novel-story-state';
import { computeStoryFingerprint } from '@/constants/novel-story-state';
import {
  EMPTY_SYNC_REPORT,
  syncStoryAnalysisToKnowledgeBase,
} from '@/services/novel-knowledge-sync';
import { generateForecastRoutes } from '@/services/novel-forecast';
import {
  enrichCharactersFromText,
} from '@/services/novel-character-enrich';
import {
  applyChapterToStoryState,
  auditRewriteChapter,
  buildRewriteContext,
  extractChapterStateDelta,
  reviseRewriteChapter,
  shouldAdoptRevision,
} from '@/services/novel-rewrite-pipeline';
import {
  DEFAULT_NOVEL_CONTINUATION_SETTINGS,
} from '@/constants/novel-continuation';
import {
  formatNovelOutlineChapterMarker,
  NOVEL_OUTLINE_COMPLETED_MARKER,
  resolveNovelOutlineTurnRuntime,
} from '@/services/novel-outline-runtime';
import {
  getNovelAuditSourceFingerprint,
  isNovelRewriteAuditCurrent,
} from '@/services/novel-audit-freshness';
import {
  startStreamingForeground,
  stopStreamingForeground,
} from '@/utils/foreground-service';
import {
  DEFAULT_LONG_TERM_MEMORY_PROMPT,
  DEFAULT_MID_TERM_MEMORY_PROMPT,
  DEFAULT_NOVEL_SYSTEM_PROMPT,
  DEFAULT_SHORT_TERM_MEMORY_PROMPT,
  resolveLongTermMemoryPrompt,
  resolveMidTermMemoryPrompt,
  resolveNovelSystemPrompt,
  resolveShortTermMemoryPrompt,
} from '@/constants/novel-memory';
import { normalizeWritingStyle } from '@/constants/writing-styles';
import { buildStoryImportPatch, storyImportFingerprint, type StoryImportCandidate } from '@/features/story-import/model';
import {
  CHAT_FONT_SIZE_DEFAULT,
  clampChatFontSize,
  normalizeChatFontFamily,
  type ChatFontFamilyId,
} from '@/constants/reading';
import {
  clampBubbleOpacity,
  clampContextLength,
  type ChatSessionKind,
} from '@/constants/session-config';
import { buildChatSessionExportBundle, type ChatSessionExportBundle } from '@/utils/chat-session-io';
import { copyNovelBackup } from '@/utils/novel-backup-copy';
import { importNovelSnapshot, readPendingNovelImports, acknowledgeNovelImport } from '@/db/novel-import-repository';
import {
  mergeShortTermIntoLongTermMemory,
  refreshNovelMemoryAndSummaryAfterTurn,
  rewriteMemoryErrorMessage,
} from '@/services/novel-memory';
import {
  applyNovelRelationInference,
  inferNovelCastRelations,
  type NovelRelationInferenceReport,
} from '@/services/novel-relation-inference';
import {
  extractSuggestedRoutesFromAssistantContent,
} from '@/utils/status-bar-html';
import { generateSuggestedRoutes } from '@/services/novel-suggested-routes';
import {
  clampChatBackgroundOpacity,
  DEFAULT_CHAT_BACKGROUND_OPACITY,
  toStoredNovelImageRef,
} from '@/utils/novel-images';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import { normalizeCharacterAiSummary } from '@/features/character-dossier-v2/ai-summary';
import type { SceneInspirationChatMessage } from '@/features/scene-inspiration/domain';
import {
  buildQuickTravelContext,
  createWorldPackFromNovel,
  ensureQuickTravelArchive,
  getActiveQuickTravelWorld,
} from '@/utils/quick-travel';
import {
  createEmptyNovelConversation,
  stripConversationForPersistence,
  stripNovelCharacterBiographiesForPersistence,
  stripNovelBodyForPersistence,
  stripSlotMessagesForPersistence,
} from '@/store/tavern-store-persistence';
import {
  DEFAULT_CONTENT_BAN_FLAGS,
  normalizeContentBanFlags,
} from '@/constants/content-bans';
import {
  DEFAULT_CONTENT_SCALE_PRESET,
  normalizeContentScalePreset,
} from '@/constants/content-scale';
import { normalizeWritingPromptExtensions } from '@/utils/writing-prompt-extensions';
import { normalizeWritingModSettings } from '@/utils/writing-mods';
import {
  DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
  normalizeCharacterCardAppearanceId,
} from '@/constants/character-card-appearances';
import {
  normalizeWritingStyleTemplates,
} from '@/constants/writing-style-templates';
import { ensureNovelDossiers, normalizeCastPrivacyFields, syncDossiersWithCast } from '@/utils/novel-dossiers';
import { ensureNovelLoreCollections, ensureNovelLoreEntries } from '@/utils/novel-lore';
import {
  EMPTY_PLAYER_PROFILE_FIELDS,
  ensureProtagonistCastMigrated,
  mirrorProtagonistToPlayerFields,
  normalizePlayerProfileFields,
} from '@/utils/novel-player';
import {
  linkRelationTargetsToCast,
  normalizeCastRelations,
  stripCastRelationsToSubject,
} from '@/utils/novel-relations';
import { createNovelSaveSlotId, MAX_NOVEL_SAVE_SLOTS } from '@/constants/novel-slots';
import { NOVEL_MESSAGE_PAGE_SIZE } from '@/constants/novel-chat';
import { normalizeNovelInjectionToggles } from '@/constants/session-injection';
import { normalizeAliases } from '@/utils/helpers';
import {
  deleteCharacterBiographyCollection,
  deleteNovelBiographyCollections,
  normalizeCharacterBiographies,
  loadNovelBiographyCollections,
  replaceNovelBiographyCollections,
  saveCharacterBiographies,
} from '@/services/character-biography-storage';
import {
  applySlotToWorking,
  buildRegressionEchoFromWorking,
  ensureNovelSlotBook,
  flushActiveSlot,
  migrateNovelSlotBooks,
  snapshotWorkingToSlot,
} from '@/utils/novel-slots';
import { filterBoundGlobalWorldbook } from '@/utils/worldbook';
import {
  normalizeNovelConversation,
} from '@/utils/session-config';
import { buildImportedNovelChapters, validateNovelTextImport } from '@/utils/novel-text-import';
import { buildLegacyNovelChapters } from '@/utils/novel-legacy-chapters';
import type { ImportedNovelText } from '@/utils/novel-import';
import { stripNovelChapterExpansion } from '@/utils/novel-chapter-expansion';
import { normalizeNovelUserInput } from '@/utils/novel-user-input';
import {
  resolveNovelOutlineOptions,
  type NovelOutlineGenerationOptions,
} from '@/utils/novel-outline-options';
import {
  beginNovelRequest,
  beginNovelMutation,
  isNovelMutationActive,
  cancelNovelRequest as cancelActiveNovelRequest,
  getActiveNovelRequestId,
  isNovelRequestAbortError,
  deriveNovelRequestFailure,
  formatNovelRequestFailureContent,
} from '@/services/novel-request-lifecycle';
import {
  createNovelPersistenceGate,
  waitForNovelPersistence,
  commitNovelPersistence,
  createWebNovelStateStorage,
} from '@/services/novel-persistence-gate';
import {
  appendNovelMessage,
  commitNovelMessage,
  deleteNovelMessage,
  markNovelMessageStatus,
} from '@/services/novel-message-commit';
import { getAppDatabase } from '@/db/database';
import { inDatabaseTransaction } from '@/db/transaction';
import { readAllSessionMessages, readSlotBook, writeSlotBook, readConversationState, writeConversationState, replaceSessionMessages } from '@/db/novel-session-repository';
import { markMemoriesStaleByWorld, replaceConversationMemories } from '@/db/repositories/memories';
import { listActiveStoryFacts } from '@/db/repositories/story-facts';
import { ensureNovelExists, getNovel } from '@/db/repositories/novels';
import { loadNovelStateDocuments } from '@/db/repositories/novel-state-documents';
import {
  loadAllNovelChapterMetadata,
  loadNovelChapterContent,
  loadNovelConversationForPrompt,
  loadNovelMemoryState,
} from '@/db/novel-read-repository';
import {
  enqueueNovelWrite,
  writeNovelMetadataInDatabase,
  persistNovelChapter,
  persistNovelChapterChanges,
  persistNovelMetadata,
  removeNovelChapterFromDatabase,
  removeNovelFromDatabase,
} from '@/db/novel-write-repository';
import {
  commitNovelChapter,
  fingerprintChapterContent,
  recordBlockedMissionVerification,
} from '@/services/novel-canon-commit';
import { processProjectionRebuildJobs } from '@/services/novel-projection-rebuild-worker';
import { buildChapterMission, verifyChapterMission } from '@/services/novel-chapter-mission';
import { loadLatestChapterMission, markChapterMissionUsed, saveChapterMission } from '@/db/repositories/chapter-missions';
import { resolveContextTokenBudget } from '@/services/context-budget';
import { processConsistencyAuditJobs } from '@/services/novel-consistency-audit-worker';
import { resolveNovelAuditBoundaries } from '@/services/novel-audit-boundaries';
import {
  invalidateNovelDerivedState,
  invalidateNovelDerivedStateInDatabase,
} from '@/services/novel-derived-invalidation';
import { abandonNovelRequest, savePartialNovelRequest, scanNovelRecovery, type NovelRecoveryItem } from '@/services/novel-recovery';
import {
  appendNovelStreamDelta,
  beginNovelStream,
  clearNovelStream,
} from '@/services/novel-stream-buffer';
import type {
  ApiSettings,
  ConfirmNovelChapterResult,
  ContentStyleSettings,
  ContextSettings,
  CreateNovelInput,
  CreateWorldbookEntryInput,
  GenerationSettings,
  ImageGenerationSettings,
  ImageProviderConfig,
  LlmProvider,
  NovelCharacterDossier,
  NovelLoreCollection,
  NovelLoreEntry,
  Message,
  Novel,
  NovelConversation,
  NovelCharacterBrief,
  NovelDirectPlan,
  NovelEditorReview,
  NovelInjectionToggles,
  NovelAgentId,
  NovelSlotBook,
  SessionCustomConfig,
  WorldbookEntry,
  WritingStyleTemplate,
  NovelCastCharacter,
  NovelChapter,
  NovelChapterAudit,
  NovelAuditIssue,
  NovelForeshadowing,
  NovelOutline,
  NovelChapterBackup,
  NovelContinuationSettings,
  NovelContinuationPlan,
  NovelGenerationJob,
  NovelStorySnapshot,
  NovelStoryAnalysis,
  NovelMissionVerification,
  NovelRewriteAudit,
  NovelOutlinePatch,
  NovelOutlineProposal,
  NovelOutlineVersion,
  SaveNovelOutlineProposalInput,
  WorldPack,
  WorldSettlement,
} from '@/types/tavern';
import {
  applyNovelOutlinePatch,
  cloneNovelOutline,
  hashNovelOutline,
} from '@/utils/novel-outline-proposals';
import {
  defaultGenerationSettings,
  ensureActiveProvider,
  getActiveProvider as getActiveProviderFromApiSettings,
  migrateLegacyApiSettings,
  normalizeGenerationSettings,
  normalizeProvider,
  resolveAgentApiSettings as resolveAgentApiSettingsFromApiSettings,
  resolveApiSettings as resolveApiSettingsFromApiSettings,
} from '@/store/tavern-store-api-settings';

export type NovelSlotOpResult =
  | { ok: true; slotId?: string }
  | {
      ok: false;
      reason: 'missing' | 'full' | 'not_found' | 'last_slot' | 'streaming' | 'no_rollback' | 'unavailable';
    };

export function getNovelSlotBookKey(novel?: Novel) {
  return novel ? (getNovelWorldId(novel) === 'legacy' ? novel.id : `${novel.id}::${getNovelWorldId(novel)}`) : '';
}

function getNovelWorldId(novel?: Novel) {
  return novel ? getActiveQuickTravelWorld(novel)?.id ?? 'legacy' : 'legacy';
}

/**
 * Returns a throttled delta callback that batches `onDelta` calls into one
 * `requestAnimationFrame` flush. During streaming, LLM tokens arrive 30–100×/sec;
 * without batching each one triggers a Zustand `set()` → full subtree re-render.
 * Accumulating per frame caps updates at ~60 Hz while keeping the text smooth.
 */
function createThrottledDeltaHandler(
  onFlush: (accumulated: string) => void,
): (delta: string) => void {
  let buffer = '';
  let pending = false;

  return (delta: string) => {
    buffer += delta;
    if (pending) return;
    pending = true;

    requestAnimationFrame(() => {
      pending = false;
      const flush = buffer;
      buffer = '';
      onFlush(flush);
    });
  };
}

function stripProviderSecret(provider: LlmProvider) {
  const { apiKey: _apiKey, ...safeProvider } = provider;
  return safeProvider;
}

function stripImageProviderSecret(provider: ImageProviderConfig) {
  const { apiKey: _apiKey, ...safeProvider } = provider;
  return safeProvider;
}

function stripGenerationSecret(settings: GenerationSettings) {
  return settings;
}

function normalizeCastPrivacy(
  privacy: Novel['cast'][number]['privacy'] | null | undefined,
): Novel['cast'][number]['privacy'] | undefined {
  return normalizeCastPrivacyFields(privacy);
}

function normalizeCastCharacter(
  character: Partial<Novel['cast'][number]> | null | undefined,
  index: number,
): Novel['cast'][number] {
  const privacy = normalizeCastPrivacy(character?.privacy);
  const portraitFocus =
    character?.portraitFocus &&
    Number.isFinite(character.portraitFocus.eyeX) &&
    Number.isFinite(character.portraitFocus.eyeY)
      ? {
          eyeX: Math.min(1, Math.max(0, character.portraitFocus.eyeX)),
          eyeY: Math.min(1, Math.max(0, character.portraitFocus.eyeY)),
          ...(Number.isFinite(character.portraitFocus.confidence)
            ? {
                confidence: Math.min(1, Math.max(0, character.portraitFocus.confidence ?? 0)),
              }
            : {}),
          ...(character.portraitFocus.detector === 'mlkit' || character.portraitFocus.detector === 'opencv'
            ? { detector: character.portraitFocus.detector }
            : {}),
        }
      : undefined;
  const dossierV2 = character?.dossierV2
    ? normalizeCharacterDossierV2(character.dossierV2, character)
    : undefined;
  const storedDossierV2 = dossierV2
    ? {
        ...dossierV2,
        private: {
          ...dossierV2.private,
          ...(dossierV2.private.portraitUri?.trim()
            ? {
                portraitUri: toStoredNovelImageRef(dossierV2.private.portraitUri.trim()),
              }
            : { portraitUri: undefined }),
        },
      }
    : undefined;
  const aiSummary = storedDossierV2
    ? normalizeCharacterAiSummary(character?.aiSummary, character ?? {}, storedDossierV2)
    : undefined;

  return {
    id:
      typeof character?.id === 'string' && character.id.trim()
        ? character.id.trim()
        : `cast-${index}-${Date.now()}`,
    name: character?.name?.trim() ?? '',
    aliases: normalizeAliases(character?.aliases)
      .filter((alias) => alias.toLowerCase() !== (character?.name?.trim() ?? '').toLowerCase()),
    profession: character?.profession?.trim() ?? '',
    age: character?.age?.trim() ?? '',
    gender: character?.gender?.trim() ?? '',
    height: character?.height?.trim() ?? '',
    weight: character?.weight?.trim() ?? '',
    birthplace: character?.birthplace?.trim() ?? '',
    affiliation: character?.affiliation?.trim() ?? '',
    appearance: character?.appearance?.trim() ?? '',
    personality: character?.personality?.trim() ?? '',
    speechStyle: character?.speechStyle?.trim() ?? '',
    background: character?.background?.trim() ?? '',
    isProtagonist: character?.isProtagonist === true,
    motive: character?.motive?.trim() ?? '',
    strengths: character?.strengths?.trim() ?? '',
    weaknesses: character?.weaknesses?.trim() ?? '',
    ...(() => {
      const relations = normalizeCastRelations(character?.relations);
      return relations ? { relations } : {};
    })(),
    ...(typeof character?.portraitUri === 'string' && character.portraitUri.trim()
      ? { portraitUri: toStoredNovelImageRef(character.portraitUri.trim()) }
      : {}),
    ...(portraitFocus ? { portraitFocus } : {}),
    ...(privacy ? { privacy } : {}),
    ...(storedDossierV2 ? { dossierV2: storedDossierV2 } : {}),
    ...(aiSummary ? { aiSummary } : {}),
    ...(() => {
      const biographies = normalizeCharacterBiographies(character?.biographies);
      return biographies.length ? { biographies } : {};
    })(),
  };
}

function detachCharacterBiographies(character: NovelCastCharacter) {
  const biographies = normalizeCharacterBiographies(character.biographies);
  const { biographies: _biographies, ...persistentCharacter } = character;
  return { character: persistentCharacter as NovelCastCharacter, biographies };
}

function retireBatchGenerationJob(job: NovelGenerationJob): NovelGenerationJob {
  return job.kind === 'batch' && job.status !== 'completed' && job.status !== 'cancelled'
    ? { ...job, status: 'cancelled', currentStep: '批量写作已移除，已生成章节保留', updatedAt: nowIso() }
    : job;
}

function normalizeNovel(novel: Novel): Novel {
  const rawCast = Array.isArray(novel.cast)
    ? novel.cast.map((item, index) => normalizeCastCharacter(item, index))
    : [];

  // Quick-travel novels keep the host/main-world identity in the novel-level
  // player fields. Do not materialize a placeholder cast card merely because
  // those legacy mirror fields are populated; only an explicitly marked card
  // should become a protagonist in a quick-travel project.
  const cast = (novel.quickTravel?.config.enabled
    ? rawCast
    : ensureProtagonistCastMigrated(rawCast, novel)
  ).map((item, index) =>
    normalizeCastCharacter(item, index),
  );
  const linkedCast = cast.map((item, index) =>
    normalizeCastCharacter(
      {
        ...item,
        relations: linkRelationTargetsToCast(item.relations, cast),
      },
      index,
    ),
  );
  const quickTravelArchive = novel.quickTravel
    ? ensureQuickTravelArchive(novel)
    : undefined;
  const normalizedQuickTravel = quickTravelArchive
    ? {
        ...quickTravelArchive,
        worlds: quickTravelArchive.worlds.map((world) => {
          const worldCast = (Array.isArray(world.cast) ? world.cast : []).map((item, castIndex) =>
            normalizeCastCharacter(item, castIndex),
          );
          const linkedWorldCast = worldCast.map((item, castIndex) =>
            normalizeCastCharacter(
              {
                ...item,
                relations: linkRelationTargetsToCast(item.relations, worldCast),
              },
              castIndex,
            ),
          );
          const originalPlot = world.originalPlot ?? {
            premise: '',
            knownToProtagonist: '',
            beats: [],
            originalEnding: '',
          };
          const runtime = world.runtime ?? {
            currentScene: '',
            currentChapter: 0,
            mission: '',
            missionStatus: 'not_started' as const,
            completedObjectives: [],
            deviations: [],
            currentEnding: '',
          };
          const outlineChapters = Array.isArray(world.outline?.volumes)
            ? world.outline.volumes.flatMap((volume) =>
                Array.isArray(volume.chapters) ? volume.chapters : [],
              )
            : [];
          const hasAuthoredOutline = Boolean(
            world.outline &&
              ((typeof world.outline.summary === 'string' && world.outline.summary.trim()) ||
                outlineChapters.some(
                  (chapter) => typeof chapter.goal === 'string' && chapter.goal.trim(),
                )),
          );
          return {
            ...world,
            name: typeof world.name === 'string' ? world.name.trim() : '',
            generationBrief:
              typeof world.generationBrief === 'string' ? world.generationBrief.trim() : '',
            worldEra: typeof world.worldEra === 'string' ? world.worldEra.trim() : '',
            worldRules: typeof world.worldRules === 'string' ? world.worldRules.trim() : '',
            protagonistIdentity:
              typeof world.protagonistIdentity === 'string' ? world.protagonistIdentity.trim() : '',
            entryScene: typeof world.entryScene === 'string' ? world.entryScene.trim() : '',
            mission: typeof world.mission === 'string' ? world.mission.trim() : '',
            cast: linkedWorldCast,
            characterDossiers: ensureNovelDossiers({
              cast: linkedWorldCast,
              characterDossiers: Array.isArray(world.characterDossiers)
                ? world.characterDossiers
                : [],
            }),
            loreEntries: Array.isArray(world.loreEntries) ? world.loreEntries : [],
            originalPlot,
            // Keep old persisted data compatible, but derive chapter-driven
            // writing from an authored outline instead of a chat-bar switch.
            runtime: {
              ...runtime,
              novelGenerationEnabled: runtime.novelGenerationEnabled === true || hasAuthoredOutline,
            },
          };
        }),
      }
    : undefined;
  const playerMirror = mirrorProtagonistToPlayerFields(linkedCast);

  return {
    ...novel,
    systemPrompt: resolveNovelSystemPrompt(novel.systemPrompt),
    writingStyle: normalizeWritingStyle(novel.writingStyle),
    shortTermMemoryPrompt: resolveShortTermMemoryPrompt(novel.shortTermMemoryPrompt),
    midTermMemoryPrompt: resolveMidTermMemoryPrompt(novel.midTermMemoryPrompt),
    longTermMemoryPrompt: resolveLongTermMemoryPrompt(novel.longTermMemoryPrompt),
    playerName: playerMirror.playerName,
    playerPersona: playerMirror.playerPersona,
    playerMotive: playerMirror.playerMotive,
    ...normalizePlayerProfileFields(playerMirror),
    worldName: novel.worldName?.trim() ?? '',
    worldEra: novel.worldEra?.trim() ?? '',
    worldConflict: novel.worldConflict?.trim() ?? '',
    worldTone: novel.worldTone?.trim() ?? '',
    mainPlot: novel.mainPlot?.trim() ?? '',
    initialStoryState: novel.initialStoryState?.trim() ?? '',
    gameRules: novel.gameRules?.trim() ?? '',
    statusBar: '',
    autoSuggestRoutes: Boolean(novel.autoSuggestRoutes),
    characterCardAppearanceId: normalizeCharacterCardAppearanceId(novel.characterCardAppearanceId),
    // Opening messages removed; keep empty for old persisted novels.
    openingMessage: '',
    isDraft: Boolean(novel.isDraft),
    createStep:
      novel.createStep === 2 || novel.createStep === 3 || novel.createStep === 1
        ? novel.createStep
        : 1,
    // 续写工程标记只由显式导入标记或已有章节决定。
    // 普通小说生成大纲时也会写入 continuationSettings（例如目标字数），不能据此误判为续写。
    // Historical backup metadata only; source no longer selects a creation mode.
    isContinuationProject: Boolean(novel.isContinuationProject),
    creationMode: 'workbench',
    agentMode: novel.agentMode === 'direct' ? 'direct' : 'narrator',
    agentReviewMode: novel.agentReviewMode === 'deep' ? 'deep' : 'fast',
    foundationPrompt: novel.foundationPrompt?.trim() || undefined,
    creationBlueprint: novel.creationBlueprint ?? undefined,
    projectBrief: novel.projectBrief
      ? {
          premise: novel.projectBrief.premise?.trim() ?? '',
          theme: novel.projectBrief.theme?.trim() ?? '',
          protagonistArc: novel.projectBrief.protagonistArc?.trim() ?? '',
          ending: novel.projectBrief.ending?.trim() ?? '',
          plannedChapters: Number.isFinite(novel.projectBrief.plannedChapters)
            ? Math.max(1, Math.min(10_000, Math.round(novel.projectBrief.plannedChapters)))
            : 20,
          firstChapterGoal: novel.projectBrief.firstChapterGoal?.trim() ?? '',
        }
      : undefined,
    cast: linkedCast,
    characterDossiers: ensureNovelDossiers({
      cast: linkedCast,
      characterDossiers: novel.characterDossiers,
    }),
    loreEntries: ensureNovelLoreEntries(novel),
    loreCollections: ensureNovelLoreCollections(novel.loreCollections),
    // Legacy field retained for import compatibility; graph functionality was removed.
    relationGraphs: [],
    coverImageUri: novel.coverImageUri?.trim()
      ? toStoredNovelImageRef(novel.coverImageUri.trim())
      : undefined,
    chatBackgroundUri: novel.chatBackgroundUri?.trim()
      ? toStoredNovelImageRef(novel.chatBackgroundUri.trim())
      : undefined,
    chatBackgroundOpacity: clampChatBackgroundOpacity(
      novel.chatBackgroundOpacity ?? DEFAULT_CHAT_BACKGROUND_OPACITY,
    ),
    quickTravel: normalizedQuickTravel,
    novelGenerationJobs: novel.novelGenerationJobs?.map(retireBatchGenerationJob),
  };
}

export const getActiveProvider = getActiveProviderFromApiSettings;
export const resolveApiSettings = resolveApiSettingsFromApiSettings;
export const resolveAgentApiSettings = resolveAgentApiSettingsFromApiSettings;


const defaultContextSettings: ContextSettings = {
  globalSystemPrompt:
    'You are the roleplay engine for a Tavern-like chat app. Follow the message hierarchy carefully and preserve immersive continuity.',
  authorsNote: '',
  jailbreak: '',
};

function markNovelChapterStateStale(novel: Novel, fromChapterIndex: number) {
  return invalidateNovelDerivedState(
    novel,
    novel.novelStoryAnalysis ?? null,
    fromChapterIndex,
  ).novel;
}

const durableStateStorage = Platform.OS === 'web'
  ? createWebNovelStateStorage(AsyncStorage)
  : AsyncStorage;
const gatedAsyncStorage = createNovelPersistenceGate(durableStateStorage);

function resolveSessionWorldbook(
  globalEntries: WorldbookEntry[],
  boundGlobalWorldbookIds?: string[],
) {
  const boundGlobals = filterBoundGlobalWorldbook(globalEntries, boundGlobalWorldbookIds);
  return boundGlobals;
}

function resolveContentStyleContext(state: {
  contentStyleSettings: ContentStyleSettings;
  writingStyleTemplates: WritingStyleTemplate[];
}) {
  return {
    settings: state.contentStyleSettings,
    writingStyleTemplates: state.writingStyleTemplates,
  };
}

export type AppearanceSettings = {
  colorScheme: ColorSchemePreference;
  /** Enables cinematic transitions and decorative motion across the interface. */
  motionEnabled: boolean;
  /** Chat bubble body font family. */
  chatFontFamily: ChatFontFamilyId;
  /** Chat bubble body font size (px). */
  chatFontSize: number;
};

/** Body-transcript export preferences (P5). */
export type ExportSettings = {
  /** Android SAF directory URI. Empty = share sheet / browser download. */
  directoryUri: string;
  /** Friendly label for the settings UI. */
  directoryLabel: string;
  /** txt or markdown body export. */
  format: 'txt' | 'md';
  /** When true, file name includes `-{timestamp}`. */
  includeTimestamp: boolean;
};

/** Global defaults applied when creating a new novel (step 3 prompts). */
export type NovelPromptDefaults = {
  systemPrompt: string;
  shortTermMemoryPrompt: string;
  midTermMemoryPrompt: string;
  longTermMemoryPrompt: string;
};

type TavernState = {
  novels: Novel[];
  novelConversations: Record<string, Message[]>;
  /** Local, non-canon inspiration transcript. Never injected into novel writing context. */
  novelInspirationChats: Record<string, SceneInspirationChatMessage[]>;
  novelConversationMeta: Record<string, NovelConversation>;
  /** IF-style progress branches per novel (world settings stay on Novel). */
  novelSlotBooks: Record<string, NovelSlotBook>;
  novelConversationRevisions: Record<string, number>;
  novelWorldSessions: Record<string, { messages: Message[]; meta: NovelConversation }>;
  worldbookEntries: WorldbookEntry[];
  globalSystemPrompt: string;
  authorsNote: string;
  jailbreak: string;
  providers: Record<string, LlmProvider>;
  generationSettings: GenerationSettings;
  imageGenerationSettings: ImageGenerationSettings;
  appearanceSettings: AppearanceSettings;
  exportSettings: ExportSettings;
  novelPromptDefaults: NovelPromptDefaults;
  contentStyleSettings: ContentStyleSettings;
  writingStyleTemplates: WritingStyleTemplate[];
  databaseMode: DatabaseMode;
  migrationError: string;
  providerSecretsWarning: string;
  hasHydrated: boolean;
  novelRecoveryItems: NovelRecoveryItem[];
};

type TavernActions = {
  createNovel: (input: CreateNovelInput) => string;
  updateNovel: (novelId: string, input: Partial<CreateNovelInput>) => void;
  appendNovelInspirationMessage: (
    novelId: string,
    message: SceneInspirationChatMessage,
  ) => void;
  addQuickTravelWorld: (novelId: string, world?: Partial<WorldPack>) => Promise<string | null>;
  deleteQuickTravelWorld: (novelId: string, worldId: string) => boolean;
  switchQuickTravelWorld: (novelId: string, worldId: string) => Promise<boolean>;
  settleQuickTravelWorld: (
    novelId: string,
    settlement: Omit<WorldSettlement, 'id' | 'worldId' | 'createdAt'>,
  ) => boolean;
  deleteNovel: (novelId: string) => void;
  ensureNovelConversation: (novelId: string) => void;
  resolveNovelRecovery: (item: NovelRecoveryItem, action: 'save_partial' | 'abandon') => Promise<void>;
  hydrateNovelConversation: (novelId: string) => Promise<void>;
  hydrateNovelChapterContent: (chapterId: string) => Promise<void>;
  hydrateRecentNovelChapters: (
    novelId: string,
    options?: { limit?: number; beforeChapterIndex?: number },
  ) => Promise<void>;
  /** Flush working conversation into the active save slot (for accurate slot list). */
  syncActiveNovelSlot: (novelId: string) => void;
  /** Freeze current progress as a memory point (stay on the live line). */
  createNovelSaveSlot: (novelId: string, name?: string) => Promise<NovelSlotOpResult>;
  /** Hard-load a memory point; optional Re:0 echo from the line being left. */
  switchNovelSaveSlot: (
    novelId: string,
    slotId: string,
    options?: { withEcho?: boolean },
  ) => Promise<NovelSlotOpResult>;
  renameNovelSaveSlot: (novelId: string, slotId: string, name: string) => Promise<NovelSlotOpResult>;
  deleteNovelSaveSlot: (novelId: string, slotId: string) => Promise<NovelSlotOpResult>;
  /** One-step undo of the last memory-point load. */
  rollbackNovelSaveSlot: (novelId: string) => Promise<NovelSlotOpResult>;
  /** Clear【回归残响】on the live line without changing messages. */
  clearNovelRegressionEcho: (novelId: string) => NovelSlotOpResult;
  createWorldbookEntry: (input: CreateWorldbookEntryInput) => string;
  deleteWorldbookEntry: (entryId: string) => void;
  regenerateNovelMessage: (novelId: string, messageId: string) => Promise<void>;
  editNovelMessage: (novelId: string, messageId: string, content: string) => Promise<void>;
  deleteNovelMessage: (novelId: string, messageId: string) => Promise<void>;
  /** Edit a user message, drop all following turns, and generate a fresh AI reply. */
  resubmitNovelUserMessage: (
    novelId: string,
    messageId: string,
    content: string,
  ) => Promise<void>;
  sendNovelMessage: (novelId: string, content: string) => Promise<void>;
  cancelNovelMessage: (novelId: string) => boolean;
  addProvider: (input?: Partial<LlmProvider>) => string;
  updateProvider: (providerId: string, updates: Partial<Omit<LlmProvider, 'id' | 'isActive'>>) => void;
  setProviderApiKey: (providerId: string, apiKey: string) => void;
  removeProvider: (providerId: string) => void;
  setActiveProvider: (providerId: string) => void;
  setProviderFetchedModels: (providerId: string, models: string[]) => void;
  setProviderSelectedModel: (providerId: string, modelId: string) => void;
  updateProviderModelSettings: (
    providerId: string,
    modelId: string,
    settings: Partial<import('@/types/tavern').ProviderModelSettings>,
  ) => void;
  hydrateProviderSecrets: () => Promise<void>;
  updateGenerationSettings: (settings: Partial<GenerationSettings>) => void;
  updateImageGenerationSettings: (settings: Partial<ImageGenerationSettings>) => void;
  addImageProvider: (input?: Partial<ImageProviderConfig>) => string;
  updateImageProvider: (
    providerId: string,
    updates: Partial<Omit<ImageProviderConfig, 'id'>>,
  ) => void;
  setImageProviderApiKey: (providerId: string, apiKey: string) => void;
  removeImageProvider: (providerId: string) => void;
  updateAppearanceSettings: (settings: Partial<AppearanceSettings>) => void;
  updateExportSettings: (settings: Partial<ExportSettings>) => void;
  updateNovelPromptDefaults: (settings: Partial<NovelPromptDefaults>) => void;
  updateContentStyleSettings: (settings: Partial<ContentStyleSettings>) => void;
  updateNovelStoryMemories: (
    novelId: string,
    updates: {
      longTermMemory: string;
      midTermMemories: string[];
      shortTermMemories: string[];
    },
  ) => Promise<void>;
  updateNovelInjectionToggles: (
    novelId: string,
    toggles: Partial<NovelInjectionToggles>,
  ) => void;
  /** Toggle the 8-5-1 memory system on/off for a novel conversation. */
  updateNovelMemorySystemToggle: (
    novelId: string,
    enabled: boolean,
  ) => void;
  /**
   * Generate supporting-character dossiers from a bounded text source and
   * append them to the novel's cast. The default remains the latest AI reply.
   */
  generateNovelSupportingCharacters: (
    novelId: string,
    options?: {
      source?: 'current-reply' | 'current-chapter' | 'all-text';
      /** Return review candidates without mutating the cast. */
      previewOnly?: boolean;
    },
  ) => Promise<NovelCastCharacter[]>;
  /** Novel-level V2 dossier appearance. */
  updateNovelCharacterCardAppearanceId: (novelId: string, appearanceId: string) => void;
  updateNovelCharacterDossiers: (novelId: string, dossiers: NovelCharacterDossier[]) => void;
  /** Replace novel lore / settings knowledge entries. */
  updateNovelLoreEntries: (novelId: string, entries: NovelLoreEntry[]) => void;
  /** Replace user-created world-atlas volumes. */
  updateNovelLoreCollections: (novelId: string, collections: NovelLoreCollection[]) => void;
  /** Upsert cast roster and sync knowledge-base entries from structured character fields. */
  /** Upsert cast roster; when `pivotId` is set, write that card's relations into the main graph. */
  updateNovelCastCharacters: (
    novelId: string,
    cast: Novel['cast'],
    options?: { pivotId?: string },
  ) => void;
  /** Read the complete cast and reconcile all in-cast relationships in one AI pass. */
  inferNovelCharacterRelations: (novelId: string) => Promise<NovelRelationInferenceReport>;
  /**
   * Delete a knowledge-base character card: remove matching cast + dossier atomically
   * so ensureNovelDossiers cannot resurrect it from leftover cast.
   */
  deleteNovelKnowledgeCharacter: (novelId: string, dossierId: string) => boolean;
  mergeNovelShortTermMemories: (novelId: string) => Promise<void>;
  updateSessionContextLength: (
    kind: ChatSessionKind,
    sessionId: string,
    contextLength: number,
  ) => void;
  updateSessionCustomConfig: (
    kind: ChatSessionKind,
    sessionId: string,
    updates: Partial<
      Pick<
        SessionCustomConfig,
        | 'mainPrompt'
        | 'prefix'
        | 'suffix'
        | 'backgroundEnabled'
        | 'bubbleOpacity'
        | 'replyLengthPreset'
        | 'boundGlobalWorldbookIds'
      >
    >,
  ) => void;
  importSessionBundle: (bundle: ChatSessionExportBundle) => Promise<void>;
  buildNovelBackup: (novelId: string) => Promise<ChatSessionExportBundle>;
  updateNovelAppearance: (
    novelId: string,
    updates: Partial<Pick<Novel, 'chatBackgroundUri' | 'chatBackgroundOpacity'>>,
  ) => void;
  // ── Novel continuation workbench ──────────────────────────────────────────
  /** Explicit user saves wait for durable storage before publishing changes. */
  saveNovelChapter: (novelId: string, chapter: NovelChapter) => Promise<void>;
  appendNovelChapters: (novelId: string, chapters: NovelChapter[]) => Promise<void>;
  importNovelText: (novelId: string, imported: ImportedNovelText) => Promise<void>;
  /** Add a chapter (draft or final) as a streaming checkpoint. */
  addNovelChapter: (novelId: string, chapter: NovelChapter) => void;
  /** Update a chapter's editable fields in place. */
  updateNovelChapter: (
    novelId: string,
    chapterId: string,
    updates: Partial<Pick<NovelChapter, 'title' | 'summary' | 'goal' | 'content' | 'planning' | 'targetWords'>>,
  ) => void;
  /** Promote a draft chapter to final (accept into the book). */
  finalizeNovelChapter: (novelId: string, chapterId: string) => Promise<void>;
  /** Delete a chapter. */
  deleteNovelChapter: (novelId: string, chapterId: string) => void;
  /** Record a chapter audit result. */
  saveNovelChapterAudit: (
    novelId: string,
    audit: Pick<
      NovelChapterAudit,
      'chapterId' | 'chapterIndex' | 'issues' | 'passed' | 'modelId'
      | 'sourceFingerprint' | 'stale'
    >,
  ) => void;
  /** Replace the foreshadowing ledger. */
  replaceNovelForeshadowings: (novelId: string, items: NovelForeshadowing[]) => void;
  /** Save an AI outline result as a proposal; canonical outline remains unchanged. */
  saveNovelOutlineProposal: (
    novelId: string,
    input: SaveNovelOutlineProposalInput,
  ) => string | null;
  /** Accept a proposal only if its base outline is still current. */
  acceptNovelOutlineProposal: (
    novelId: string,
    proposalId: string,
  ) => { ok: true } | { ok: false; reason: 'missing' | 'conflict' | 'invalid' };
  /** Reject a pending proposal without changing the canonical outline. */
  rejectNovelOutlineProposal: (novelId: string, proposalId: string) => void;
  /** Permanently remove one outline proposal record without changing the outline. */
  deleteNovelOutlineProposal: (novelId: string, proposalId: string) => void;
  /** Remove one historical outline snapshot without changing the current outline. */
  deleteNovelOutlineVersion: (novelId: string, versionId: string) => void;
  /** Save a scoped outline (main novel or quick-travel world) and create a history snapshot. */
  saveNovelOutlineAtScope: (
    novelId: string,
    scopeId: string,
    outline: NovelOutline,
    reason?: string,
  ) => void;
  /** Apply only reviewed story materials in one state update, rejecting stale previews. */
  applyNovelStoryImport: (
    novelId: string,
    candidate: StoryImportCandidate,
    selectedIds: string[],
    baseFingerprint: string,
  ) => { appliedCount: number; skipped: string[] };
  /** Clear a scoped outline while keeping its last snapshot for recovery. */
  clearNovelOutlineAtScope: (novelId: string, scopeId: string, reason?: string) => void;
  /** Update continuation pipeline settings. */
  updateNovelContinuationSettings: (
    novelId: string,
    updates: Partial<NovelContinuationSettings>,
  ) => void;
  /** Record per-task usage stats for the continuation pipeline. */
  recordNovelContinuationUsage: (
    novelId: string,
    task: string,
    tokens: number,
  ) => void;
  /** Push a versioned backup of a chapter's current content. */
  backupNovelChapter: (novelId: string, chapterId: string) => void;
  /** Restore a chapter from a backup entry. */
  rollbackNovelChapter: (novelId: string, chapterId: string, backupId: string) => Promise<void>;
  // ── AI continuation pipeline (async orchestrators) ─────────────────────────
  /** Run rule audit + LLM fact-check on a chapter and persist the report. */
  auditNovelChapter: (novelId: string, chapterId: string) => Promise<void>;
  /** AI-generate the whole-book outline (volumes + chapter goals). */
  generateNovelOutline: (novelId: string, options?: NovelOutlineGenerationOptions) => Promise<void>;
  /** 依据已选路线生成对应段落大纲（追加为新的卷，从下一章编号开始）。 */
  generateNovelOutlineForPlan: (
    novelId: string,
    planId: string,
    options?: NovelOutlineGenerationOptions,
  ) => Promise<void>;
  // ── 续写 / 结局重写（postive.md）──────────────────────────────────────────
  /** 增量状态分析（checkpoint 恢复；并发锁保护）。返回是否真正跑了模型调用。 */
  analyzeNovelStoryState: (
    novelId: string,
    options?: {
      onProgress?: (progress: number, chapter: number, status: string) => void;
      onComplete?: (ran: boolean, paused: boolean) => void;
    },
  ) => Promise<{ ran: boolean; paused: boolean }>;
  /** 把状态分析结果同步到知识库（角色卡 / lore）。返回报告。 */
  syncNovelKnowledgeBase: (novelId: string, options?: { refreshGenerated?: boolean }) => import('@/services/novel-knowledge-sync').KnowledgeSyncReport;
  /** 全文检索 + LLM 精炼角色档案（appearance/personality/privacy/evidence 等）。 */
  enrichNovelCharacters: (
    novelId: string,
    options?: { onProgress?: (step: string) => void },
  ) => Promise<{ enriched: number }>;
  /** 更新角色的 SFW/NSFW 预写种子（检索增强的输入，不被 LLM 覆盖）。 */
  updateNovelCharacterSeeds: (
    novelId: string,
    characterId: string,
    seeds: { sfwSeed?: string; nsfwSeed?: string },
  ) => void;
  /** 路线推演（非正史），生成 3 条候选路线。 */
  createNovelForecast: (
    novelId: string,
    options: {
      mode: 'continue' | 'ending';
      divergenceChapter: number;
      userGuide: { endingPreference: string; targetLength: string; mustKeep: string; mustAvoid: string };
      onProgress?: (message: string) => void;
    },
  ) => Promise<string>;
  /** 选中一条路线，生成 ContinuationPlan（仍非正史）。 */
  selectNovelForecastRoute: (novelId: string, forecastId: string, routeId: string) => void;
  /** 生成下一章草稿（走重写上下文；流式写入）。 */
  rewriteNovelNextChapter: (
    novelId: string,
    options?: {
      planId?: string;
      userGuide?: { endingPreference: string; targetLength: string; mustKeep: string; mustAvoid: string };
      userInstruction?: string;
      planning?: NovelChapter['planning'];
      targetWords?: number;
      targetChapterIndex?: number;
      branchId?: string;
      resumeJobId?: string;
      onDelta?: (delta: string) => void;
    },
  ) => Promise<string | null>;
  resumeNovelGenerationJob: (novelId: string, jobId: string) => Promise<string | null>;
  abandonNovelGenerationJob: (novelId: string, jobId: string) => void;
  retryNovelGenerationJob: (novelId: string, jobId: string) => Promise<string | null>;
  /** 8 维审查一章（结果挂 novelRewriteAudits）。 */
  auditRewriteChapter: (novelId: string, chapterId: string) => Promise<void>;
  /** 确认草稿为正式章节：提取状态增量 → 更新 StoryState → 快照 → （可选分支）。 */
  confirmNovelChapter: (
    novelId: string,
    chapterId: string,
    options?: { branchId?: string; snapshotLabel?: string; override?: boolean },
  ) => Promise<ConfirmNovelChapterResult>;
  /** 在分支内确认草稿（写入分支，不动正史）。 */
  confirmBranchChapter: (
    novelId: string,
    branchId: string,
    chapterId: string,
    options?: { snapshotLabel?: string },
  ) => Promise<void>;
  /** AI 修订草稿：仅采用明显更优的修订版，保留原稿版本。 */
  reviseNovelChapter: (
    novelId: string,
    chapterId: string,
    options?: { allowStructural?: boolean },
  ) => Promise<{ adopted: boolean; score: number }>;
  /** 回滚到快照。 */
  /** 记录 / 更新耗时任务。 */
  upsertNovelGenerationJob: (
    novelId: string,
    job: Partial<NovelGenerationJob> & { jobId: string; kind: NovelGenerationJob['kind']; mode: NovelGenerationJob['mode'] },
  ) => void;
  updateWorldbookEntry: (entryId: string, updates: Partial<CreateWorldbookEntryInput>) => void;
  toggleWorldbookEntry: (entryId: string) => void;
  retryDatabaseMigration: () => Promise<void>;
  setHasHydrated: (hasHydrated: boolean) => void;
};

export type TavernStore = TavernState & TavernActions;

type PersistedProvider = Omit<LlmProvider, 'apiKey'>;
type PersistedGenerationSettings = GenerationSettings;
type PersistedImageProvider = Omit<ImageProviderConfig, 'apiKey'>;
type PersistedImageGenerationSettings = Omit<ImageGenerationSettings, 'providers'> & {
  providers: Record<string, PersistedImageProvider>;
};

type DatabaseMode = 'pending' | 'migrating' | 'sqlite' | 'web-fallback' | 'migration-failed';

type PersistedTavernState = Omit<
  Pick<
    TavernState,
    | 'novels'
    | 'novelInspirationChats'
    | 'novelConversationMeta'
    | 'novelSlotBooks'
    | 'novelWorldSessions'
    | 'worldbookEntries'
    | 'globalSystemPrompt'
    | 'authorsNote'
    | 'jailbreak'
    | 'appearanceSettings'
    | 'exportSettings'
    | 'novelPromptDefaults'
    | 'contentStyleSettings'
    | 'writingStyleTemplates'
  >,
  never
> & {
  novelConversations?: Record<string, Message[]>;
  providers: Record<string, PersistedProvider>;
  generationSettings: PersistedGenerationSettings;
  imageGenerationSettings: PersistedImageGenerationSettings;
  worldbook?: WorldbookEntry[];
  apiSettings?: {
    provider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    contextWindowMessages?: number;
    streamingEnabled?: boolean;
  };
};

const defaultAppearanceSettings: AppearanceSettings = {
  colorScheme: DEFAULT_COLOR_SCHEME_PREFERENCE,
  motionEnabled: true,
  chatFontFamily: 'song',
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
};

const defaultExportSettings: ExportSettings = {
  directoryUri: '',
  directoryLabel: '',
  format: 'txt',
  includeTimestamp: true,
};

function normalizeExportSettings(settings?: Partial<ExportSettings> | null): ExportSettings {
  return {
    directoryUri: settings?.directoryUri?.trim() ?? '',
    directoryLabel: settings?.directoryLabel?.trim() ?? '',
    format: settings?.format === 'md' ? 'md' : 'txt',
    includeTimestamp:
      typeof settings?.includeTimestamp === 'boolean'
        ? settings.includeTimestamp
        : defaultExportSettings.includeTimestamp,
  };
}

const defaultContentStyleSettings: ContentStyleSettings = {
  defaultWritingStyle: '',
  ...normalizeWritingPromptExtensions(),
  ...normalizeWritingModSettings(),
  contentScalePreset: DEFAULT_CONTENT_SCALE_PRESET,
  bans: { ...DEFAULT_CONTENT_BAN_FLAGS },
};

function normalizeContentStyleSettings(
  settings?: Partial<ContentStyleSettings> | null,
): ContentStyleSettings {
  return {
    defaultWritingStyle: normalizeWritingStyle(settings?.defaultWritingStyle),
    ...normalizeWritingPromptExtensions(settings),
    ...normalizeWritingModSettings(settings),
    contentScalePreset: normalizeContentScalePreset(settings?.contentScalePreset),
    bans: normalizeContentBanFlags(settings?.bans),
  };
}

const defaultNovelPromptDefaults: NovelPromptDefaults = {
  systemPrompt: DEFAULT_NOVEL_SYSTEM_PROMPT,
  shortTermMemoryPrompt: DEFAULT_SHORT_TERM_MEMORY_PROMPT,
  midTermMemoryPrompt: DEFAULT_MID_TERM_MEMORY_PROMPT,
  longTermMemoryPrompt: DEFAULT_LONG_TERM_MEMORY_PROMPT,
};

function normalizeNovelPromptDefaults(
  settings?: Partial<NovelPromptDefaults> | null,
): NovelPromptDefaults {
  return {
    systemPrompt: resolveNovelSystemPrompt(settings?.systemPrompt),
    shortTermMemoryPrompt: resolveShortTermMemoryPrompt(settings?.shortTermMemoryPrompt),
    midTermMemoryPrompt: resolveMidTermMemoryPrompt(settings?.midTermMemoryPrompt),
    longTermMemoryPrompt: resolveLongTermMemoryPrompt(settings?.longTermMemoryPrompt),
  };
}

const initialState: TavernState = {
  novels: [],
  novelConversations: {},
  novelInspirationChats: {},
  novelConversationMeta: {},
  novelSlotBooks: {},
  novelConversationRevisions: {},
  novelWorldSessions: {},
  worldbookEntries: [],
  ...defaultContextSettings,
  providers: { ...DEFAULT_PROVIDERS },
  generationSettings: defaultGenerationSettings,
  imageGenerationSettings: defaultImageGenerationSettings,
  appearanceSettings: defaultAppearanceSettings,
  exportSettings: defaultExportSettings,
  novelPromptDefaults: defaultNovelPromptDefaults,
  contentStyleSettings: defaultContentStyleSettings,
  writingStyleTemplates: [],
  databaseMode: 'pending',
  migrationError: '',
  providerSecretsWarning: '',
  hasHydrated: false,
  novelRecoveryItems: [],
};

function normalizeAppearanceSettings(
  settings?: Partial<AppearanceSettings> | null,
): AppearanceSettings {
  const colorScheme =
    settings?.colorScheme === 'light' ||
    settings?.colorScheme === 'dark' ||
    settings?.colorScheme === 'system'
      ? settings.colorScheme
      : DEFAULT_COLOR_SCHEME_PREFERENCE;
  return {
    colorScheme,
    motionEnabled: settings?.motionEnabled !== false,
    chatFontFamily: normalizeChatFontFamily(settings?.chatFontFamily),
    chatFontSize: clampChatFontSize(settings?.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT),
  };
}

/** Serialize post-turn memory jobs per novel so concurrent turns don't drop entries. */
const novelPostTurnQueues = new Map<string, Promise<void>>();

function enqueueNovelPostTurn(novelId: string, task: () => Promise<void>) {
  const previous = novelPostTurnQueues.get(novelId) ?? Promise.resolve();
  const next = previous.then(task, task).finally(() => {
    if (novelPostTurnQueues.get(novelId) === next) {
      novelPostTurnQueues.delete(novelId);
    }
  });
  novelPostTurnQueues.set(novelId, next);
  return next;
}

/** Wait for the previous turn's memory/summary maintenance before starting a new turn. */
async function waitForNovelPostTurn(novelId: string) {
  const pending = novelPostTurnQueues.get(novelId);
  if (pending) {
    await pending.catch(() => undefined);
  }
}

class StaleNovelPostTurnError extends Error {
  constructor() {
    super('Novel post-turn task is stale.');
    this.name = 'StaleNovelPostTurnError';
  }
}

function isNovelPostTurnCurrent(token: NovelPostTurnToken): boolean {
  const state = useTavernStore.getState();
  const novel = state.novels.find((item) => item.id === token.novelId);
  const message = state.novelConversations[token.novelId]?.find(
    (item) => item.id === token.assistantMessageId,
  );
  return isNovelPostTurnTokenCurrent(token, {
    novelExists: Boolean(novel),
    assistantMessage: message,
    activeSlotId: state.novelSlotBooks[getNovelSlotBookKey(state.novels.find((item) => item.id === token.novelId))]?.activeSlotId ?? null,
    worldId: getNovelWorldId(novel),
  });
}

function assertNovelPostTurnCurrent(token: NovelPostTurnToken): void {
  if (!isNovelPostTurnCurrent(token)) {
    throw new StaleNovelPostTurnError();
  }
}

/** Resolve the legacy background settings for suggested routes and side maintenance. */
function resolveUtilityApiSettingsForSideJobs(
  providers: Record<string, LlmProvider>,
  generationSettings: GenerationSettings,
): ApiSettings {
  return resolveApiSettings(providers, generationSettings, { purpose: 'utility', task: 'outline' });
}

function resolveNovelAgentApiSettings(
  providers: Record<string, LlmProvider>,
  generationSettings: GenerationSettings,
  agentId: NovelAgentId,
): ApiSettings {
  return resolveAgentApiSettings(providers, generationSettings, agentId);
}

async function runNovelDirectAgent({
  providers,
  generationSettings,
  novel,
  history,
  instruction,
  memory,
  signal,
}: {
  providers: Record<string, LlmProvider>;
  generationSettings: GenerationSettings;
  novel: Novel;
  history: GenerateNovelDirectPlanInput['history'];
  instruction: string;
  memory?: GenerateNovelDirectPlanInput['memory'];
  signal?: AbortSignal;
}) {
  return generateNovelDirectPlan({
    apiSettings: resolveNovelAgentApiSettings(providers, generationSettings, 'direct'),
    novel,
    history,
    instruction,
    memory,
    signal,
  });
}

function updateNovelAgentState(
  novelId: string,
  novelName: string,
  patch: Partial<
    Pick<
      NovelConversation,
      | 'agentStage'
      | 'lastDirectPlan'
      | 'lastDirectAgentError'
      | 'lastCharacterBrief'
      | 'lastCharacterAgentError'
      | 'lastEditorReview'
      | 'lastEditorAgentError'
    >
  >,
) {
  const timestamp = new Date().toISOString();
  useTavernStore.setState((current) => ({
    novelConversationMeta: {
      ...current.novelConversationMeta,
      [novelId]: {
        ...normalizeNovelConversation(
          current.novelConversationMeta[novelId] ??
            createEmptyNovelConversation(novelId, novelName, timestamp),
        ),
        ...patch,
        updatedAt: timestamp,
      },
    },
  }));
}

type NovelAgentMemory = GenerateNovelDirectPlanInput['memory'];

type NovelAgentPreflightResult = {
  handoff: string;
  directPlan?: NovelDirectPlan;
  characterBrief?: NovelCharacterBrief;
};

async function runNovelAgentPreflight({
  providers,
  generationSettings,
  novel,
  history,
  instruction,
  memory,
  signal,
}: {
  providers: Record<string, LlmProvider>;
  generationSettings: GenerationSettings;
  novel: Novel;
  history: GenerateNovelDirectPlanInput['history'];
  instruction: string;
  memory?: NovelAgentMemory;
  signal?: AbortSignal;
}): Promise<NovelAgentPreflightResult> {
  if (novel.agentMode !== 'direct') {
    return { handoff: '' };
  }

  updateNovelAgentState(novel.id, novel.name, {
    agentStage: 'memory-context',
    lastDirectAgentError: undefined,
    lastCharacterBrief: undefined,
    lastCharacterAgentError: undefined,
    lastEditorReview: undefined,
    lastEditorAgentError: undefined,
  });

  const hasCast = (novel.cast ?? []).some((character) => character.name.trim());
  updateNovelAgentState(novel.id, novel.name, { agentStage: 'collaboration' });
  const collaboration = await runNovelAgentCollaboration({
    hasCharacter: hasCast,
    runDirect: async () => {
      const result = await runNovelDirectAgent({
        providers, generationSettings, novel, history, instruction, memory, signal,
      });
      return { value: result.plan, tokens: result.tokens, model: result.model };
    },
    runCharacter: hasCast
      ? async () => {
          const result = await generateNovelCharacterBrief({
            apiSettings: resolveNovelAgentApiSettings(providers, generationSettings, 'character'),
            novel, history, instruction, memory, signal,
          });
          return { value: result.brief, tokens: result.tokens, model: result.model };
        }
      : undefined,
  });
  const directPlan = collaboration.directPlan;
  const characterBrief = collaboration.characterBrief;
  if (collaboration.directTokens) {
    useTavernStore.getState().recordNovelContinuationUsage(novel.id, 'direct-agent', collaboration.directTokens);
  }
  if (collaboration.characterTokens) {
    useTavernStore.getState().recordNovelContinuationUsage(novel.id, 'character-agent', collaboration.characterTokens);
  }
  updateNovelAgentState(novel.id, novel.name, {
    lastDirectPlan: directPlan,
    lastDirectAgentError: collaboration.directError
      ? collaboration.directError instanceof Error ? collaboration.directError.message : 'Direct 规划失败，已回退到 Narrator。'
      : undefined,
    lastCharacterBrief: characterBrief,
    lastCharacterAgentError: collaboration.characterError
      ? collaboration.characterError instanceof Error ? collaboration.characterError.message : 'Character 简报失败，已跳过角色协作。'
      : undefined,
  });

  const failedAgents = [
    collaboration.directError
      ? `Direct：${collaboration.directError instanceof Error ? collaboration.directError.message : '规划失败'}`
      : '',
    hasCast && collaboration.characterError
      ? `Character：${collaboration.characterError instanceof Error ? collaboration.characterError.message : '简报失败'}`
      : '',
  ].filter(Boolean);
  if (failedAgents.length) {
    throw new Error(
      `协作模式未完成（${failedAgents.join('；')}）。已停止 Narrator，避免绕过协作直接生成正文。`,
    );
  }

  updateNovelAgentState(novel.id, novel.name, { agentStage: 'narrator' });
  return {
    handoff: buildNovelAgentHandoff({ directPlan, characterBrief }),
    directPlan,
    characterBrief,
  };
}

type NovelChatRequest = Parameters<typeof requestChatCompletion>[0];
type NovelChatResponse = Awaited<ReturnType<typeof requestChatCompletion>>;

async function runNovelEditorPass({
  providers,
  generationSettings,
  novel,
  history,
  instruction,
  memory,
  directPlan,
  characterBrief,
  draftReply,
  request,
  signal,
}: {
  providers: Record<string, LlmProvider>;
  generationSettings: GenerationSettings;
  novel: Novel;
  history: GenerateNovelDirectPlanInput['history'];
  instruction: string;
  memory?: NovelAgentMemory;
  directPlan?: NovelDirectPlan;
  characterBrief?: NovelCharacterBrief;
  draftReply: NovelChatResponse;
  request: NovelChatRequest;
  signal?: AbortSignal;
}): Promise<{ reply: NovelChatResponse; review?: NovelEditorReview }> {
  if (!shouldRunNovelEditor(novel.agentMode, novel.agentReviewMode)) {
    return { reply: draftReply };
  }

  updateNovelAgentState(novel.id, novel.name, { agentStage: 'editor' });
  try {
    const editorResult = await generateNovelEditorReview({
      apiSettings: resolveNovelAgentApiSettings(providers, generationSettings, 'editor'),
      novel,
      history,
      instruction,
      draft: draftReply.content,
      directPlan,
      characterBrief,
      memory,
      signal,
    });
    const review = editorResult.review;
    updateNovelAgentState(novel.id, novel.name, {
      lastEditorReview: review,
      lastEditorAgentError: undefined,
    });

    if (!shouldRepairNovelDraft(review)) {
      updateNovelAgentState(novel.id, novel.name, { agentStage: 'narrator' });
      return { reply: draftReply, review };
    }

    updateNovelAgentState(novel.id, novel.name, { agentStage: 'repair' });
    const repairedReply = await requestChatCompletion({
      ...request,
      agentHandoff: [request.agentHandoff, formatNovelEditorReview(review)]
        .filter((item) => item?.trim())
        .join('\n\n'),
      onDelta: undefined,
      onReasoningDelta: undefined,
      signal,
    });
    updateNovelAgentState(novel.id, novel.name, { agentStage: 'narrator' });
    return { reply: repairedReply, review };
  } catch (error) {
    if (isNovelRequestAbortError(error)) {
      throw error;
    }
    updateNovelAgentState(novel.id, novel.name, {
      agentStage: 'narrator',
      lastEditorAgentError:
        error instanceof Error ? error.message : 'Editor 审查失败，保留 Narrator 原文。',
    });
    return { reply: draftReply };
  }
}

function setNovelMemoryError(novelId: string, novelName: string, message: string) {
  const stamp = new Date().toISOString();
  useTavernStore.setState((current) => ({
    novelConversationMeta: {
      ...current.novelConversationMeta,
      [novelId]: {
        ...normalizeNovelConversation(
          current.novelConversationMeta[novelId] ??
            createEmptyNovelConversation(novelId, novelName, stamp),
        ),
        lastMemoryError: message,
        updatedAt: stamp,
      },
    },
  }));
}

/**
 * Drop the short-term memory + restore 本幕草稿 written for a replaced assistant turn.
 * Waits for any in-flight post-turn job first, so we don't race with a late write.
 */
async function rollbackNovelShortTermForAssistant(
  novelId: string,
  novelName: string,
  assistantMessageId: string,
  worldId = 'legacy',
) {
  invalidateNovelPostTurn(novelId);

  const stamp = new Date().toISOString();
  useTavernStore.setState((current) => {
    const meta = normalizeNovelConversation(
      current.novelConversationMeta[novelId] ??
        createEmptyNovelConversation(novelId, novelName, stamp),
    );
    const trackedId = meta.lastShortTermMemoryMessageId;
    const shouldRollbackShort = trackedId
      ? trackedId === assistantMessageId
      : // Legacy sessions: only pop when the last write succeeded.
        !meta.lastMemoryError && meta.shortTermMemories.length > 0;

    const shouldRollbackDrafts =
      meta.lastExperienceDraftMessageId === assistantMessageId &&
      Boolean(meta.lastExperienceDraftSnapshot);
    const shouldRollbackSummary = meta.lastAgentSummaryMessageId === assistantMessageId;

    if (!shouldRollbackShort && !shouldRollbackDrafts && !shouldRollbackSummary) {
      return current;
    }

    const nextShorts = [...meta.shortTermMemories];
    if (shouldRollbackShort && nextShorts.length > 0) {
      nextShorts.pop();
    }

    let nextNovels = current.novels;
    let nextRecentIds = meta.recentSceneDossierIds ?? [];

    if (shouldRollbackDrafts && meta.lastExperienceDraftSnapshot) {
      const snapshot = meta.lastExperienceDraftSnapshot;
      nextNovels = current.novels.map((novel) => {
        if (novel.id !== novelId) {
          return novel;
        }
        const dossiers = ensureNovelDossiers(novel).map((item) => {
          if (!(item.id in snapshot)) {
            return item;
          }
          return {
            ...item,
            experienceDraft: snapshot[item.id] ?? '',
            updatedAt: stamp,
          };
        });
        return normalizeNovel({
          ...novel,
          characterDossiers: dossiers,
          updatedAt: stamp,
        });
      });

      if (Array.isArray(meta.lastExperienceDraftRecentIdsSnapshot)) {
        nextRecentIds = [...meta.lastExperienceDraftRecentIdsSnapshot];
      }
    }

    return {
      novels: nextNovels,
      novelConversationMeta: {
        ...current.novelConversationMeta,
        [novelId]: {
          ...meta,
           shortTermMemories: shouldRollbackShort ? nextShorts : meta.shortTermMemories,
           agentSummary: shouldRollbackSummary
             ? meta.lastAgentSummarySnapshot ?? ''
             : meta.agentSummary,
           lastShortTermMemoryMessageId: shouldRollbackShort
             ? undefined
             : meta.lastShortTermMemoryMessageId,
           lastAgentSummaryMessageId: shouldRollbackSummary
             ? undefined
             : meta.lastAgentSummaryMessageId,
           lastAgentSummarySnapshot: shouldRollbackSummary
             ? undefined
             : meta.lastAgentSummarySnapshot,
          recentSceneDossierIds: nextRecentIds,
          lastExperienceDraftMessageId: shouldRollbackDrafts
            ? undefined
            : meta.lastExperienceDraftMessageId,
          lastExperienceDraftSnapshot: shouldRollbackDrafts
            ? undefined
            : meta.lastExperienceDraftSnapshot,
          lastExperienceDraftRecentIdsSnapshot: shouldRollbackDrafts
            ? undefined
            : meta.lastExperienceDraftRecentIdsSnapshot,
          updatedAt: stamp,
        },
      },
    };
  });

  useTavernStore.getState().syncActiveNovelSlot(novelId);
}

/**
 * A rewritten turn can be folded into mid/long-term summaries, so popping one
 * short memory is not sufficient.  Clear the in-memory projection and stale
 * its SQLite rows before the replacement turn is allowed to build a new line.
 */
async function invalidateNovelMemoriesForEditedTurn(
  novelId: string,
  novelName: string,
  worldId = 'legacy',
) {
  invalidateNovelPostTurn(novelId);
  const stamp = new Date().toISOString();
  useTavernStore.setState((current) => {
    const meta = normalizeNovelConversation(
      current.novelConversationMeta[novelId] ?? createEmptyNovelConversation(novelId, novelName, stamp),
    );
    return {
      novelConversationMeta: {
        ...current.novelConversationMeta,
        [novelId]: {
          ...meta,
          longTermMemory: '',
          midTermMemories: [],
          shortTermMemories: [],
          agentSummary: undefined,
          lastShortTermMemoryMessageId: undefined,
          lastAgentSummaryMessageId: undefined,
          lastAgentSummarySnapshot: undefined,
          memoryStale: true,
          updatedAt: stamp,
        },
      },
    };
  });
  if (Platform.OS !== 'web') {
    const db = await getAppDatabase();
    await markMemoriesStaleByWorld(db, novelId, worldId, stamp);
  }
  useTavernStore.getState().syncActiveNovelSlot(novelId);
}

function parseChapterIndexFromText(text: string | undefined) {
  const match = (text ?? '').slice(0, 240).match(/第\s*([0-9]{1,4}|[一二三四五六七八九十百千〇零]+)\s*章/);
  if (!match) return undefined;

  if (/^\d+$/.test(match[1])) {
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  const digits: Record<string, number> = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  for (const char of match[1]) {
    if (char in unit) {
      const multiplier = unit[char];
      section = (section || 1) * multiplier;
      total += section;
      section = 0;
    } else if (char in digits) {
      section = digits[char];
    }
  }
  const value = total + section;
  return value > 0 ? value : undefined;
}

function prepareNovelPromptHistory(
  messages: Message[],
  keepExpansionForMessageId?: string,
) {
  return messages.map((message) => {
    if (message.role !== 'user' || message.id === keepExpansionForMessageId) {
      return message;
    }
    const content = stripNovelChapterExpansion(message.content);
    return content === message.content ? message : { ...message, content };
  });
}

function captureCurrentNovelPostTurnToken(
  novelId: string,
  assistantMessageId: string,
  assistantContent: string,
): NovelPostTurnToken {
  const state = useTavernStore.getState();
  const novel = state.novels.find((item) => item.id === novelId);
  return captureNovelPostTurnToken({
    novelId,
    assistantMessageId,
    assistantContent,
    activeSlotId: state.novelSlotBooks[getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))]?.activeSlotId ?? null,
    worldId: getNovelWorldId(novel),
  });
}

/** Deterministic outline progression must finish before the next prompt can start. */
function advanceNovelOutlineChapterAfterTurn(novelId: string, userInput: string): void {
  const state = useTavernStore.getState();
  const latestNovel = state.novels.find((item) => item.id === novelId);
  if (!latestNovel) return;
  const runtime = resolveNovelOutlineTurnRuntime(latestNovel, userInput);
  if (!runtime) return;

  if (runtime.scope === 'world') {
    const archive = ensureQuickTravelArchive(latestNovel);
    const activeWorldId = archive.activeWorldId ?? archive.worlds[0]?.id;
    const activeWorld = archive.worlds.find((world) => world.id === activeWorldId);
    if (!activeWorld || !runtime.next) return;
    const updatedAt = new Date().toISOString();
    state.updateNovel(novelId, {
      quickTravel: {
        ...archive,
        worlds: archive.worlds.map((world) =>
          world.id === activeWorld.id
            ? {
                ...world,
                runtime: { ...world.runtime, currentChapter: runtime.next!.index },
                updatedAt,
              }
            : world,
        ),
      },
    });
    return;
  }

  const updatedAt = new Date().toISOString();
  useTavernStore.setState((current) => ({
    novelConversationMeta: {
      ...current.novelConversationMeta,
      [novelId]: {
        ...normalizeNovelConversation(
          current.novelConversationMeta[novelId] ??
            createEmptyNovelConversation(novelId, latestNovel.name, updatedAt),
        ),
        currentChapter: runtime.next
          ? formatNovelOutlineChapterMarker(runtime.next)
          : NOVEL_OUTLINE_COMPLETED_MARKER,
        updatedAt,
      },
    },
  }));
}

async function runNovelPostTurnMaintenance({
  novelId,
  novel,
  userContent,
  assistantContent,
  assistantMessageId,
  longTermMemory,
  midTermMemories,
  shortTermMemories,
  agentSummary,
  postTurnToken,
}: {
  novelId: string;
  /** @deprecated Kept for call-site compatibility; utility lane resolves its own model. */
  apiSettings?: ApiSettings;
  novel: Novel;
  userContent: string;
  assistantContent: string;
  /** Assistant bubble id — recorded so regenerate can roll back this turn's derived state. */
  assistantMessageId: string;
  longTermMemory: string;
  midTermMemories: string[];
  shortTermMemories: string[];
  agentSummary?: string;
  postTurnToken: NovelPostTurnToken;
}) {
  return enqueueNovelPostTurn(novelId, async () => {
    if (!isNovelPostTurnCurrent(postTurnToken)) return;
    const stamp = new Date().toISOString();
    const worldId = getNovelWorldId(novel);
    const routeModeWorld = getActiveQuickTravelWorld(novel);
    const allowSuggestedRoutes =
      novel.autoSuggestRoutes && routeModeWorld?.runtime.novelGenerationEnabled !== true;
    const parsedRoutes = allowSuggestedRoutes
      ? extractSuggestedRoutesFromAssistantContent(assistantContent)
      : [];

    useTavernStore.setState((current) => {
      if (!isNovelPostTurnCurrent(postTurnToken)) return current;
      const base = normalizeNovelConversation(
        current.novelConversationMeta[novelId] ??
          createEmptyNovelConversation(novelId, novel.name, stamp),
      );

      return {
        novelConversationMeta: {
          ...current.novelConversationMeta,
          [novelId]: {
            ...base,
            ...(allowSuggestedRoutes
              ? {
                  suggestedRoutes: parsedRoutes,
                  isSuggestingRoutes: parsedRoutes.length === 0,
                }
              : {}),
            updatedAt: stamp,
          },
        },
      };
    });

    let memoryApiSettings: ApiSettings | null = null;

    try {
      const latestState = useTavernStore.getState();
      const memoryMaxTokens = latestState.generationSettings.memoryMaxTokens ?? 512;
      memoryApiSettings = resolveNovelAgentApiSettings(
        latestState.providers,
        latestState.generationSettings,
        'memory',
      );

      // Always append against the freshest short-term list (avoids concurrent drop).
      const latestMeta = normalizeNovelConversation(
        useTavernStore.getState().novelConversationMeta[novelId] ??
          createEmptyNovelConversation(novelId, novel.name, stamp),
      );
      const memoryUpdate = await refreshNovelMemoryAndSummaryAfterTurn({
        apiSettings: memoryApiSettings,
        memoryMaxTokens,
        novel,
        userContent,
        assistantContent,
        longTermMemory: latestMeta.longTermMemory || longTermMemory,
        midTermMemories:
          latestMeta.midTermMemories.length > 0
            ? latestMeta.midTermMemories
            : midTermMemories,
        shortTermMemories:
          latestMeta.shortTermMemories.length > 0
            ? latestMeta.shortTermMemories
            : shortTermMemories,
        agentSummary: latestMeta.agentSummary || agentSummary || '',
      });
      assertNovelPostTurnCurrent(postTurnToken);
      const rememberedAt = new Date().toISOString();

      if (Platform.OS !== 'web') {
        await enqueueNovelWrite(novelId, async () => {
          const memoryDb = await getAppDatabase();
          await inDatabaseTransaction(memoryDb, async (database) => {
            await replaceConversationMemories(database, novelId, worldId, memoryUpdate, {
              sourceMessageId: assistantMessageId, updatedAt: rememberedAt,
            });
            assertNovelPostTurnCurrent(postTurnToken);
          });
        });
      }

      assertNovelPostTurnCurrent(postTurnToken);
      useTavernStore.setState((current) => !isNovelPostTurnCurrent(postTurnToken) ? current : ({
        novelConversationMeta: {
          ...current.novelConversationMeta,
          [novelId]: {
            ...normalizeNovelConversation(
              current.novelConversationMeta[novelId] ??
                createEmptyNovelConversation(novelId, novel.name, rememberedAt),
            ),
            longTermMemory: memoryUpdate.longTermMemory,
            midTermMemories: memoryUpdate.midTermMemories,
            shortTermMemories: memoryUpdate.shortTermMemories,
            agentSummary: memoryUpdate.agentSummary,
            memoryStale: false,
            lastShortTermMemoryMessageId: assistantMessageId,
            lastAgentSummaryMessageId: assistantMessageId,
            lastAgentSummarySnapshot: latestMeta.agentSummary,
            lastMemoryError: undefined,
            updatedAt: rememberedAt,
          },
        },
      }));
      useTavernStore.getState().syncActiveNovelSlot(novelId);
    } catch (error) {
      if (error instanceof StaleNovelPostTurnError || !isNovelPostTurnCurrent(postTurnToken)) return;
      const raw =
        error instanceof Error ? error.message : '短期记忆写入失败，请检查后台模型配置。';
      const message = rewriteMemoryErrorMessage(raw);
      console.warn('[novel-memory]', novelId, message);
      setNovelMemoryError(novelId, novel.name, message);
      memoryApiSettings = null;
    }

    // Fallback: main reply had no parseable routes — one utility call, attach to sessionMeta.
    if (allowSuggestedRoutes && parsedRoutes.length === 0) {
      try {
        const latestState = useTavernStore.getState();
        const routeSettings = resolveUtilityApiSettingsForSideJobs(
          latestState.providers,
          latestState.generationSettings,
        );
        const latestMeta = normalizeNovelConversation(
          latestState.novelConversationMeta[novelId] ??
            createEmptyNovelConversation(novelId, novel.name, stamp),
        );
        const routes = await generateSuggestedRoutes({
          apiSettings: routeSettings,
          novel,
          userContent,
          assistantContent,
          longTermMemory: latestMeta.longTermMemory || longTermMemory,
          midTermMemories:
            latestMeta.midTermMemories.length > 0
              ? latestMeta.midTermMemories
              : midTermMemories,
          shortTermMemories:
            latestMeta.shortTermMemories.length > 0
              ? latestMeta.shortTermMemories
              : shortTermMemories,
        });
        assertNovelPostTurnCurrent(postTurnToken);
        const routesAt = new Date().toISOString();
        useTavernStore.setState((current) => !isNovelPostTurnCurrent(postTurnToken) ? current : ({
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, novel.name, routesAt),
              ),
              suggestedRoutes: routes,
              isSuggestingRoutes: false,
              updatedAt: routesAt,
            },
          },
        }));
        useTavernStore.getState().syncActiveNovelSlot(novelId);
      } catch (error) {
        if (error instanceof StaleNovelPostTurnError || !isNovelPostTurnCurrent(postTurnToken)) return;
        const message =
          error instanceof Error ? error.message : '建议路线生成失败';
        console.warn('[novel-suggested-routes]', novelId, message);
        useTavernStore.setState((current) => !isNovelPostTurnCurrent(postTurnToken) ? current : ({
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, novel.name, stamp),
              ),
              suggestedRoutes: [],
              isSuggestingRoutes: false,
              updatedAt: new Date().toISOString(),
            },
          },
        }));
      }
    }

  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 续写 / 结局重写 —— 并发锁 + LLM 注入（postive.md P5）
// ─────────────────────────────────────────────────────────────────────────────

const novelWriteLocks = new Map<string, { owner: string; acquiredAt: number }>();

/**
 * 并发锁：同一本小说同一时间只允许一个「状态更新任务」（分析/推演/确认）。
 * 返回 token；释放时凭 token 释放，避免误释放他人锁。
 */
function acquireNovelWriteLock(novelId: string, owner: string): string | null {
  const existing = novelWriteLocks.get(novelId);
  if (existing) {
    return null;
  }
  const token = `${owner}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  novelWriteLocks.set(novelId, { owner: token, acquiredAt: Date.now() });
  return token;
}

function releaseNovelWriteLock(novelId: string, token: string): void {
  const existing = novelWriteLocks.get(novelId);
  if (existing?.owner === token) {
    novelWriteLocks.delete(novelId);
  }
}

/** 把 store 的 apiSettings 包装成可注入服务的 LlmCompletion（测试可替换为 fake）。 */
function buildStoreCompletion(apiSettings: ApiSettings, onDelta?: (delta: string) => void): LlmCompletion {
  return async (messages, purpose) => {
    const result = await requestCompletionWithUsage({
      apiSettings,
      messages,
      purpose,
      onDelta,
    });
    return {
      content: result.content,
      modelId: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      finishReason: result.finishReason,
    };
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function simpleFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function getNovelOutlineAtScope(novel: Novel, scopeId: string): NovelOutline | undefined {
  if (scopeId === 'novel') {
    return novel.outline;
  }
  return novel.quickTravel?.worlds.find((world) => world.id === scopeId)?.outline;
}

function replaceNovelOutlineAtScope(
  novel: Novel,
  scopeId: string,
  outline: NovelOutline | undefined,
): Novel | undefined {
  if (scopeId === 'novel') {
    return { ...novel, outline };
  }
  if (!novel.quickTravel?.worlds.some((world) => world.id === scopeId)) {
    return undefined;
  }
  return {
    ...novel,
    quickTravel: {
      ...novel.quickTravel,
      worlds: novel.quickTravel.worlds.map((world) =>
        world.id === scopeId
          ? {
              ...world,
              outline,
              runtime: { ...world.runtime, novelGenerationEnabled: Boolean(outline) },
              updatedAt: new Date().toISOString(),
            }
          : world,
      ),
    },
  };
}

function appendNovelOutlineVersion(
  novel: Novel,
  scopeId: string,
  outline: NovelOutline,
  source: NovelOutlineVersion['source'],
  reason?: string,
  proposalId?: string,
): Novel {
  const timestamp = new Date().toISOString();
  const version: NovelOutlineVersion = {
    id: makeId('outline-version'),
    scopeId,
    outline: cloneNovelOutline(outline),
    source,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    ...(proposalId ? { proposalId } : {}),
    createdAt: timestamp,
  };
  return {
    ...novel,
    outlineVersions: [...(novel.outlineVersions ?? []), version].slice(-50),
    updatedAt: timestamp,
  };
}

export const useTavernStore = create<TavernStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      createNovel: (input) => {
        const timestamp = new Date().toISOString();
        const novelId = `novel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isDraft = Boolean(input.isDraft);
        const detachedCast = (Array.isArray(input.cast) ? input.cast : [])
          .map(detachCharacterBiographies);
        const novel: Novel = normalizeNovel(
          {
          id: novelId,
          name: input.name.trim() || (isDraft ? '未命名草稿' : ''),
          shortIntro: input.shortIntro.trim(),
          detailedIntro: input.detailedIntro.trim(),
          systemPrompt: resolveNovelSystemPrompt(input.systemPrompt),
          writingStyle: normalizeWritingStyle(input.writingStyle),
          shortTermMemoryPrompt: resolveShortTermMemoryPrompt(input.shortTermMemoryPrompt),
          midTermMemoryPrompt: resolveMidTermMemoryPrompt(
            typeof input.midTermMemoryPrompt === 'string' ? input.midTermMemoryPrompt : '',
          ),
          longTermMemoryPrompt: resolveLongTermMemoryPrompt(input.longTermMemoryPrompt),
          playerName: input.playerName.trim(),
          playerPersona: input.playerPersona.trim(),
          playerMotive: input.playerMotive.trim(),
          ...normalizePlayerProfileFields(input),
          worldName: input.worldName.trim(),
          worldEra: input.worldEra.trim(),
          worldConflict: input.worldConflict.trim(),
          worldTone: input.worldTone.trim(),
          mainPlot: input.mainPlot.trim(),
          initialStoryState: input.initialStoryState?.trim() ?? '',
          gameRules: input.gameRules?.trim() ?? '',
          statusBar: '',
          autoSuggestRoutes: Boolean(input.autoSuggestRoutes),
          relationGraphEnabled: false,
          characterCardAppearanceId: normalizeCharacterCardAppearanceId(input.characterCardAppearanceId),
          cast: detachedCast.map((item) => item.character),
          characterDossiers: Array.isArray(input.characterDossiers)
            ? input.characterDossiers
            : [],
          loreEntries: Array.isArray(input.loreEntries) ? input.loreEntries : [],
          relationGraphs: [],
          chapters: Array.isArray(input.chapters) ? input.chapters : [],
          foreshadowings: Array.isArray(input.foreshadowings) ? input.foreshadowings : [],
          audits: Array.isArray(input.audits) ? input.audits : [],
          outline: input.outline ?? undefined,
          outlineVersions: Array.isArray(input.outlineVersions) ? input.outlineVersions : [],
          outlineProposals: Array.isArray(input.outlineProposals) ? input.outlineProposals : [],
          foundationPrompt: input.foundationPrompt?.trim() || undefined,
          creationBlueprint: input.creationBlueprint ?? undefined,
          projectBrief: input.projectBrief ?? undefined,
          creationMode: 'workbench',
          agentMode: input.agentMode === 'direct' ? 'direct' : 'narrator',
          agentReviewMode: input.agentReviewMode === 'deep' ? 'deep' : 'fast',
          dialogueSamples: Array.isArray(input.dialogueSamples) ? input.dialogueSamples : [],
          styleFeatures: Array.isArray(input.styleFeatures) ? input.styleFeatures : [],
          chapterBackups: Array.isArray(input.chapterBackups) ? input.chapterBackups : [],
          continuationStats: input.continuationStats ?? undefined,
          continuationSettings: input.continuationSettings ?? undefined,
          openingMessage: '',
          defaultModelId: input.defaultModelId.trim(),
          defaultProviderId: input.defaultProviderId?.trim() || undefined,
          coverImageUri: input.coverImageUri?.trim()
            ? toStoredNovelImageRef(input.coverImageUri.trim())
            : undefined,
          chatBackgroundUri: input.chatBackgroundUri?.trim()
            ? toStoredNovelImageRef(input.chatBackgroundUri.trim())
            : undefined,
          chatBackgroundOpacity: input.chatBackgroundOpacity,
          isDraft,
          createStep: input.createStep ?? 1,
          isContinuationProject: Boolean(input.isContinuationProject),
          quickTravel: input.quickTravel,
          createdAt: timestamp,
          updatedAt: timestamp,
          },
        );

        const emptyMeta = createEmptyNovelConversation(novelId, novel.name, timestamp);
        const slotBook = ensureNovelSlotBook({
          messages: [],
          meta: emptyMeta,
          novelName: novel.name,
        });

        set((state) => ({
          novels: [novel, ...state.novels],
          novelConversations: {
            ...state.novelConversations,
            [novelId]: [],
          },
          novelConversationMeta: {
            ...state.novelConversationMeta,
            [novelId]: emptyMeta,
          },
          novelSlotBooks: {
            ...state.novelSlotBooks,
            [getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))]: slotBook,
          },
        }));

        void persistNovelMetadata(novel).catch((error) => {
          console.error('[novel] failed to persist new novel metadata', error);
        });
        for (const item of detachedCast) {
          if (!item.biographies.length) continue;
          void saveCharacterBiographies(
            { novelId, characterId: item.character.id },
            item.biographies,
          ).catch((error) => {
            console.error('[novel] failed to persist initial character biographies', error);
          });
        }
        for (const chapter of novel.chapters ?? []) {
          void persistNovelChapter(novel.id, chapter).catch((error) => {
            console.error('[novel] failed to persist initial chapter', error);
          });
        }

        return novelId;
      },
      appendNovelInspirationMessage: (novelId, message) => {
        const content = message.content.trim();
        if (!content) return;
        set((state) => ({
          novelInspirationChats: {
            ...state.novelInspirationChats,
            [novelId]: [
              ...(state.novelInspirationChats[novelId] ?? []),
              { ...message, content },
            ].slice(-200),
          },
        }));
      },
      updateNovel: (novelId, input) => {
        const detachedInputCast = Array.isArray(input.cast)
          ? input.cast
              .map(detachCharacterBiographies)
          : null;
        const biographyUpdates = Array.isArray(input.cast)
          ? input.cast
              .filter((character) => Object.prototype.hasOwnProperty.call(character, 'biographies'))
              .map((character) => ({
                characterId: character.id,
                biographies: normalizeCharacterBiographies(character.biographies),
              }))
          : [];
        set((state) => {
          const timestamp = new Date().toISOString();
          const existing = state.novels.find((item) => item.id === novelId);

          if (!existing) {
            return state;
          }

          const isDraft =
            input.isDraft === undefined ? Boolean(existing.isDraft) : Boolean(input.isDraft);
          const nextName =
            (typeof input.name === 'string' ? input.name.trim() : '') ||
            (isDraft ? existing.name || '未命名草稿' : existing.name);
          const openingId = `${novelId}-opening`;
          const currentMessages = state.novelConversations[novelId];

          // Drop legacy opening bubbles; novels no longer use opening messages.
          let nextConversations = state.novelConversations;

          if (currentMessages?.some((message) => message.id === openingId)) {
            nextConversations = {
              ...state.novelConversations,
              [novelId]: currentMessages.filter((message) => message.id !== openingId),
            };
          }

          const nextPlayerProfile = normalizePlayerProfileFields({
            ...existing,
            ...input,
          });

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel(
                    {
                      ...novel,
                      name: nextName,
                      shortIntro: input.shortIntro?.trim() ?? existing.shortIntro,
                      detailedIntro: input.detailedIntro?.trim() ?? existing.detailedIntro,
                      systemPrompt:
                        (typeof input.systemPrompt === 'string'
                          ? input.systemPrompt.trim()
                          : '') ||
                        existing.systemPrompt ||
                        DEFAULT_NOVEL_SYSTEM_PROMPT,
                      writingStyle: normalizeWritingStyle(
                        input.writingStyle ?? existing.writingStyle,
                      ),
                      shortTermMemoryPrompt: resolveShortTermMemoryPrompt(
                        typeof input.shortTermMemoryPrompt === 'string'
                          ? input.shortTermMemoryPrompt
                          : existing.shortTermMemoryPrompt,
                      ),
                      midTermMemoryPrompt: resolveMidTermMemoryPrompt(
                        typeof input.midTermMemoryPrompt === 'string'
                          ? input.midTermMemoryPrompt
                          : existing.midTermMemoryPrompt,
                      ),
                      longTermMemoryPrompt: resolveLongTermMemoryPrompt(
                        typeof input.longTermMemoryPrompt === 'string'
                          ? input.longTermMemoryPrompt
                          : existing.longTermMemoryPrompt,
                      ),
                      playerName:
                        typeof input.playerName === 'string'
                          ? input.playerName.trim()
                          : existing.playerName,
                      playerPersona:
                        typeof input.playerPersona === 'string'
                          ? input.playerPersona.trim()
                          : existing.playerPersona,
                      playerMotive:
                        typeof input.playerMotive === 'string'
                          ? input.playerMotive.trim()
                          : existing.playerMotive,
                      ...nextPlayerProfile,
                      worldName:
                        typeof input.worldName === 'string'
                          ? input.worldName.trim()
                          : existing.worldName,
                      worldEra:
                        typeof input.worldEra === 'string'
                          ? input.worldEra.trim()
                          : existing.worldEra,
                      worldConflict:
                        typeof input.worldConflict === 'string'
                          ? input.worldConflict.trim()
                          : existing.worldConflict,
                      worldTone:
                        typeof input.worldTone === 'string'
                          ? input.worldTone.trim()
                          : existing.worldTone,
                      mainPlot:
                        typeof input.mainPlot === 'string'
                          ? input.mainPlot.trim()
                          : existing.mainPlot,
                      initialStoryState:
                        typeof input.initialStoryState === 'string'
                          ? input.initialStoryState.trim()
                          : (existing.initialStoryState ?? ''),
                      gameRules:
                        typeof input.gameRules === 'string'
                          ? input.gameRules.trim()
                          : (existing.gameRules ?? ''),
                      statusBar: '',
                      autoSuggestRoutes:
                        input.autoSuggestRoutes === undefined
                          ? Boolean(existing.autoSuggestRoutes)
                          : Boolean(input.autoSuggestRoutes),
                      relationGraphEnabled: false,
                      characterCardAppearanceId: normalizeCharacterCardAppearanceId(
                        input.characterCardAppearanceId ?? novel.characterCardAppearanceId,
                      ),
                      cast: detachedInputCast
                        ? detachedInputCast.map((item) => item.character)
                        : novel.cast,
                      characterDossiers: Array.isArray(input.characterDossiers)
                        ? input.characterDossiers
                        : novel.characterDossiers,
                      loreEntries: Array.isArray(input.loreEntries)
                        ? input.loreEntries
                        : novel.loreEntries,
                      relationGraphs: [],
                      chapters: Array.isArray(input.chapters) ? input.chapters : novel.chapters,
                      foreshadowings: Array.isArray(input.foreshadowings)
                        ? input.foreshadowings
                        : novel.foreshadowings,
                      audits: Array.isArray(input.audits) ? input.audits : novel.audits,
                      outline: input.outline ?? novel.outline,
                      foundationPrompt: input.foundationPrompt !== undefined
                        ? input.foundationPrompt?.trim() || undefined
                        : novel.foundationPrompt,
                      creationBlueprint: input.creationBlueprint !== undefined
                        ? input.creationBlueprint ?? undefined
                        : novel.creationBlueprint,
                      projectBrief: input.projectBrief ?? novel.projectBrief,
                      creationMode: 'workbench',
                      agentMode:
                        input.agentMode === 'direct'
                          ? 'direct'
                          : input.agentMode === 'narrator'
                            ? 'narrator'
                            : novel.agentMode,
                      agentReviewMode:
                        input.agentReviewMode === 'deep'
                          ? 'deep'
                          : input.agentReviewMode === 'fast'
                            ? 'fast'
                            : novel.agentReviewMode ?? 'fast',
                      dialogueSamples: Array.isArray(input.dialogueSamples)
                        ? input.dialogueSamples
                        : novel.dialogueSamples,
                      styleFeatures: Array.isArray(input.styleFeatures)
                        ? input.styleFeatures
                        : novel.styleFeatures,
                      chapterBackups: Array.isArray(input.chapterBackups)
                        ? input.chapterBackups
                        : novel.chapterBackups,
                      continuationStats: input.continuationStats ?? novel.continuationStats,
                      continuationSettings:
                        input.continuationSettings ?? novel.continuationSettings,
                      openingMessage: '',
                      defaultModelId:
                        typeof input.defaultModelId === 'string'
                          ? input.defaultModelId.trim()
                          : existing.defaultModelId,
                      defaultProviderId:
                        input.defaultProviderId !== undefined
                          ? input.defaultProviderId?.trim() || undefined
                          : existing.defaultProviderId,
                      coverImageUri:
                        Object.prototype.hasOwnProperty.call(input, 'coverImageUri')
                          ? input.coverImageUri?.trim()
                            ? toStoredNovelImageRef(input.coverImageUri.trim())
                            : undefined
                          : existing.coverImageUri,
                      chatBackgroundUri:
                        Object.prototype.hasOwnProperty.call(input, 'chatBackgroundUri')
                          ? input.chatBackgroundUri?.trim()
                            ? toStoredNovelImageRef(input.chatBackgroundUri.trim())
                            : undefined
                          : existing.chatBackgroundUri,
                      chatBackgroundOpacity:
                        input.chatBackgroundOpacity === undefined
                          ? existing.chatBackgroundOpacity
                          : input.chatBackgroundOpacity,
                      isDraft,
                      createStep:
                        input.createStep === 2 ||
                        input.createStep === 3 ||
                        input.createStep === 1
                          ? input.createStep
                          : (novel.createStep ?? 1),
                      quickTravel:
                        input.quickTravel === undefined ? existing.quickTravel : input.quickTravel,
                      updatedAt: timestamp,
                    },
                  )
                : novel,
            ),
            novelConversations: nextConversations,
            novelConversationMeta: state.novelConversationMeta[novelId]
              ? {
                  ...state.novelConversationMeta,
                  [novelId]: {
                    ...normalizeNovelConversation(state.novelConversationMeta[novelId]),
                    title: nextName,
                    updatedAt: timestamp,
                  },
                }
              : state.novelConversationMeta,
          };
        });
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist novel metadata update', error);
          });
        }
        for (const item of biographyUpdates) {
          void saveCharacterBiographies(
            { novelId, characterId: item.characterId },
            item.biographies,
          ).catch((error) => {
            console.error('[novel] failed to persist updated character biographies', error);
          });
        }
      },
      addQuickTravelWorld: async (novelId, worldUpdates) => {
        if (isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId)) throw new Error('正在生成或保存，请完成后再添加世界。');
        const novel = get().novels.find((item) => item.id === novelId);
        if (!novel) return null;
        const archive = ensureQuickTravelArchive(novel);
        const now = new Date().toISOString();
        const base = createWorldPackFromNovel(novel, now);
        const mainWorld = archive.worlds.find((world) => world.isMainWorld);
        const protagonists = (mainWorld?.cast ?? novel.cast ?? []).filter(
          (character) => character.isProtagonist,
        );
        const worldId = `world-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const world: WorldPack = {
          ...base,
          ...worldUpdates,
          id: worldId,
          createdAt: now,
          updatedAt: now,
          originalPlot: worldUpdates?.originalPlot ?? base.originalPlot,
          runtime: worldUpdates?.runtime ?? base.runtime,
          cast: worldUpdates?.cast ?? protagonists,
          characterDossiers:
            worldUpdates?.characterDossiers ??
            base.characterDossiers.filter((dossier) =>
              protagonists.some((character) => character.id === dossier.castId),
            ),
        };
        invalidateNovelPostTurn(novelId);
        get().updateNovel(novelId, {
          quickTravel: {
            ...archive,
            worlds: [...archive.worlds, world],
            activeWorldId: archive.activeWorldId,
          },
        });
        await get().switchQuickTravelWorld(novelId, worldId);
        return worldId;
      },
      deleteQuickTravelWorld: (novelId, worldId) => {
        if (isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId)) return false;
        const novel = get().novels.find((item) => item.id === novelId);
        if (!novel) return false;
        const archive = ensureQuickTravelArchive(novel);
        if (
          archive.activeWorldId === worldId ||
          archive.worlds.length <= 1 ||
          !archive.worlds.some((world) => world.id === worldId) ||
          archive.worlds.some((world) => world.id === worldId && world.isMainWorld)
        ) {
          return false;
        }
        const worlds = archive.worlds.filter((world) => world.id !== worldId);
        const nextActiveId = archive.activeWorldId === worldId
          ? worlds[0]?.id
          : archive.activeWorldId;
        const nextWorld = worlds.find((world) => world.id === nextActiveId) ?? worlds[0];
        if (archive.activeWorldId === worldId) invalidateNovelPostTurn(novelId);
        get().updateNovel(novelId, {
          cast: nextWorld?.cast ?? [],
          characterDossiers: nextWorld?.characterDossiers ?? [],
          quickTravel: { ...archive, worlds, activeWorldId: nextActiveId },
        });
        return true;
      },
      switchQuickTravelWorld: (novelId, worldId) => switchNovelWorld(novelId, worldId),
      settleQuickTravelWorld: (novelId, settlementInput) => {
        const novel = get().novels.find((item) => item.id === novelId);
        if (!novel) return false;
        const archive = ensureQuickTravelArchive(novel);
        const worldId = archive.activeWorldId ?? archive.worlds[0]?.id;
        if (!worldId) return false;
        if (archive.worlds.find((world) => world.id === worldId)?.isMainWorld) return false;
        invalidateNovelPostTurn(novelId);
        const now = new Date().toISOString();
        const settlement: WorldSettlement = {
          ...settlementInput,
          id: `settlement-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          worldId,
          createdAt: now,
        };
        get().updateNovel(novelId, {
          quickTravel: {
            ...archive,
            settlements: [...archive.settlements, settlement],
            worlds: archive.worlds.map((world) =>
              world.id === worldId
                ? { ...world, status: settlement.result === 'success' ? 'completed' : 'failed', updatedAt: now }
                : world,
            ),
          },
        });
        return true;
      },
      deleteNovel: (novelId) => {
        if (isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId)) throw new Error('正在生成或保存，请完成后再删除。');
        invalidateNovelPostTurn(novelId);
        set((state) => {
          const { [novelId]: _removedConversation, ...remainingConversations } =
            state.novelConversations;
          const { [novelId]: _removedInspirationChat, ...remainingInspirationChats } =
            state.novelInspirationChats;
          const { [novelId]: _removedMeta, ...remainingConversationMeta } =
            state.novelConversationMeta;
          const belongsToNovel = (key: string) => key === novelId || key.startsWith(`${novelId}::`);
          const remainingSlotBooks = Object.fromEntries(Object.entries(state.novelSlotBooks).filter(([key]) => !belongsToNovel(key)));
          const remainingWorldSessions = Object.fromEntries(Object.entries(state.novelWorldSessions).filter(([key]) => !belongsToNovel(key)));

          return {
            novels: state.novels.filter((novel) => novel.id !== novelId),
            novelConversations: remainingConversations,
            novelInspirationChats: remainingInspirationChats,
            novelConversationMeta: remainingConversationMeta,
            novelSlotBooks: remainingSlotBooks,
            novelWorldSessions: remainingWorldSessions,
          };
        });
        void deleteNovelBiographyCollections(novelId)
          .catch((error) => {
            console.error('[novel] failed to delete character biographies', error);
          })
          .finally(() => removeNovelFromDatabase(novelId).catch((error) => {
            console.error('[novel] failed to delete novel from database', error);
          }));
      },
      ensureNovelConversation: (novelId) =>
        set((state) => {
          const novel = state.novels.find((item) => item.id === novelId);

          if (!novel) {
            return state;
          }

          const timestamp = new Date().toISOString();
          const hasConversation = Boolean(state.novelConversations[novelId]);
          const openingId = `${novelId}-opening`;

          // Also drop legacy opening bubbles. Native streaming rows stay visible
          // until the user explicitly saves or abandons the interrupted request.
          const existingMessages = state.novelConversations[novelId];
          const cleanedMessages = existingMessages
            ?.filter((message) => message.id !== openingId)
            .map((message) => {
              if (Platform.OS !== 'web' || message.status !== 'streaming') {
                return message;
              }

              const content = message.content.trim();
              const isPlaceholder = !content || content === '正在生成回复...';

              return {
                ...message,
                content: isPlaceholder
                  ? '生成中断：请点击重新生成。'
                  : `${content}\n\n（生成中断，内容可能不完整）`,
                status: isPlaceholder ? ('error' as const) : ('complete' as const),
                updatedAt: timestamp,
              };
            });

          const nextMessages = hasConversation ? (cleanedMessages ?? []) : [];
          const nextMeta = normalizeNovelConversation(
            state.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, timestamp),
          );
          const nextSlotBook = ensureNovelSlotBook({
            book: state.novelSlotBooks[getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))],
            messages: nextMessages,
            meta: nextMeta,
            novelName: novel.name,
          });

          return {
            novelConversations: {
              ...state.novelConversations,
              [novelId]: nextMessages,
            },
            novelConversationMeta: {
              ...state.novelConversationMeta,
              [novelId]: nextMeta,
            },
            novelSlotBooks: {
              ...state.novelSlotBooks,
              [getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))]: nextSlotBook,
            },
          };
        }),
      resolveNovelRecovery: async (item, action) => {
        if (Platform.OS === 'web') return;
        const changed = action === 'save_partial'
          ? await savePartialNovelRequest(item)
          : await abandonNovelRequest(item);
        if (!changed.changed) return;
        useTavernStore.setState((state) => ({
          novelRecoveryItems: state.novelRecoveryItems.filter((candidate) => candidate.id !== item.id),
          novelConversations: {
            ...state.novelConversations,
            [item.novelId]: (state.novelConversations[item.novelId] ?? []).map((message) =>
              message.id === item.id ? { ...message, status: action === 'save_partial' ? 'complete' : 'cancelled', updatedAt: changed.updatedAt } : message,
            ),
          },
        }));
      },
      hydrateNovelConversation: async (novelId) => {
        if (Platform.OS === 'web' || isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId)) return;
        const revision = get().novelConversationRevisions[novelId] ?? 0;
        try {
          const worldId = getNovelWorldId(useTavernStore.getState().novels.find((item) => item.id === novelId));
          const db = await getAppDatabase();
          const [messages, memoryState, durableMeta, slotBook] = await Promise.all([
            loadNovelConversationForPrompt(novelId, NOVEL_MESSAGE_PAGE_SIZE, worldId),
            loadNovelMemoryState(novelId, worldId),
            readConversationState(db, novelId, worldId),
            readSlotBook(db, novelId, worldId),
          ]);
          useTavernStore.setState((state) => {
            const novel = state.novels.find((item) => item.id === novelId);
            if (getNovelWorldId(novel) !== worldId || isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId) || (state.novelConversationRevisions[novelId] ?? 0) !== revision) return state;
            const currentMeta = normalizeNovelConversation(
              state.novelConversationMeta[novelId] ??
                createEmptyNovelConversation(
                  novelId,
                  state.novels.find((item) => item.id === novelId)?.name ?? '未命名小说',
                  new Date().toISOString(),
                ),
            );
            const currentMessages = state.novelConversations[novelId] ?? [];
            return {
              novelConversations: {
                ...state.novelConversations,
                [novelId]: currentMessages.length > 0 ? currentMessages : messages,
              },
              novelConversationMeta: {
                ...state.novelConversationMeta,
                [novelId]: {
                  ...currentMeta,
                  ...chooseDurableConversationMeta(currentMeta, durableMeta),
                  ...memoryState,
                },
              },
              ...(slotBook ? { novelSlotBooks: { ...state.novelSlotBooks, [getNovelSlotBookKey(novel)]: slotBook } } : {}),
            };
          });
        } catch (error) {
          if (useTavernStore.getState().databaseMode !== 'web-fallback') {
            console.warn('[novel] failed to hydrate database conversation', error);
          }
        }
      },
      hydrateNovelChapterContent: async (chapterId) => {
        const owner = useTavernStore.getState().novels.find((novel) =>
          novel.chapters?.some((chapter) => chapter.id === chapterId),
        );
        const chapter = owner?.chapters?.find((item) => item.id === chapterId);
        if (!owner || !chapter || chapter.contentStatus === 'loading' || chapter.contentStatus === 'loaded') return;
        // Web keeps chapter bodies in the Zustand/AsyncStorage compatibility
        // path. Do not try to hydrate them through the native SQLite reader.
        if (Platform.OS === 'web') {
          set((state) => ({
            novels: state.novels.map((novel) => novel.id === owner.id ? {
              ...novel,
              chapters: (novel.chapters ?? []).map((item) =>
                item.id === chapterId ? { ...item, contentStatus: 'loaded' as const } : item),
            } : novel),
          }));
          return;
        }
        set((state) => ({
          novels: state.novels.map((novel) => novel.id === owner.id ? {
            ...novel,
            chapters: (novel.chapters ?? []).map((item) =>
              item.id === chapterId ? { ...item, contentStatus: 'loading' as const } : item),
          } : novel),
        }));
        try {
          const row = await loadNovelChapterContent(chapterId);
          if (!row || row.novelId !== owner.id) throw new Error('章节正文不存在');
          set((state) => ({
            novels: state.novels.map((novel) => novel.id === owner.id ? {
              ...novel,
              chapters: (novel.chapters ?? []).map((item) =>
                item.id === chapterId ? { ...item, content: row.content, contentStatus: 'loaded' as const } : item),
            } : novel),
          }));
        } catch (error) {
          set((state) => ({
            novels: state.novels.map((novel) => novel.id === owner.id ? {
              ...novel,
              chapters: (novel.chapters ?? []).map((item) =>
                item.id === chapterId ? { ...item, contentStatus: 'error' as const } : item),
            } : novel),
          }));
          throw error;
        }
      },
      hydrateRecentNovelChapters: async (novelId, options) => {
        const novel = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!novel) return;
        const limit = Math.max(0, Math.min(20, Math.round(options?.limit ?? 3)));
        if (limit === 0) return;
        const candidates = (novel.chapters ?? [])
          .filter((chapter) => options?.beforeChapterIndex === undefined || chapter.index < options.beforeChapterIndex)
          .sort((a, b) => b.index - a.index)
          .slice(0, limit);
        await Promise.all(candidates.map((chapter) =>
          useTavernStore.getState().hydrateNovelChapterContent(chapter.id),
        ));
      },
      syncActiveNovelSlot: (novelId) =>
        set((state) => {
          const novel = state.novels.find((item) => item.id === novelId);
          const meta = state.novelConversationMeta[novelId];
          const messages = state.novelConversations[novelId];

          if (!novel || !meta) {
            return state;
          }

          const book = ensureNovelSlotBook({
            book: state.novelSlotBooks[getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))],
            messages: messages ?? [],
            meta,
            novelName: novel.name,
          });

          return {
            novelSlotBooks: {
              ...state.novelSlotBooks,
              [getNovelSlotBookKey(state.novels.find((item) => item.id === novelId))]: flushActiveSlot(book, messages ?? [], meta, getActiveQuickTravelWorld(novel)?.runtime.currentChapter),
            },
          };
        }),
      createNovelSaveSlot: (novelId, name) => mutateNovelSlot(novelId, 'create', undefined, name),
      switchNovelSaveSlot: (novelId, slotId, options) => mutateNovelSlot(novelId, 'switch', slotId, undefined, options?.withEcho),
      clearNovelRegressionEcho: (novelId) => {
        const state = useTavernStore.getState();
        const meta = state.novelConversationMeta[novelId];
        if (!meta) {
          return { ok: false, reason: 'missing' };
        }

        if (!meta.regressionEcho?.trim()) {
          return { ok: true };
        }

        useTavernStore.setState({
          novelConversationMeta: {
            ...state.novelConversationMeta,
            [novelId]: {
              ...meta,
              regressionEcho: undefined,
              updatedAt: new Date().toISOString(),
            },
          },
        });

        return { ok: true };
      },
      renameNovelSaveSlot: (novelId, slotId, name) => mutateNovelSlot(novelId, 'rename', slotId, name),
      deleteNovelSaveSlot: (novelId, slotId) => mutateNovelSlot(novelId, 'delete', slotId),
      rollbackNovelSaveSlot: (novelId) => mutateNovelSlot(novelId, 'rollback'),
      editNovelMessage: (novelId, messageId, content) => mutateNovelMessage(novelId, messageId, content),
      deleteNovelMessage: (novelId, messageId) => mutateNovelMessage(novelId, messageId),
      resubmitNovelUserMessage: async (novelId, messageId, content) => {
        if (get().novelRecoveryItems.some((item) => item.novelId === novelId)) {
          throw new Error('请先处理未完成的生成请求。');
        }
        const trimmedContent = content.trim();

        if (!trimmedContent) {
          return;
        }
        invalidateNovelPostTurn(novelId);
        await waitForNovelPostTurn(novelId);

        const timestamp = new Date().toISOString();
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        const conversation = await loadNovelConversationForPrompt(novelId, 500, getNovelWorldId(novel)).catch(
          () => state.novelConversations[novelId] ?? [],
        );
        const targetIndex = conversation.findIndex((message) => message.id === messageId);
        const targetMessage = conversation[targetIndex];

        if (!novel || !targetMessage || targetMessage.role !== 'user') {
          return;
        }

        // Only the latest user turn can be edited — never wipe later history.
        const latestUserIndex = [...conversation]
          .map((message, index) => ({ message, index }))
          .reverse()
          .find((item) => item.message.role === 'user')?.index;

        if (latestUserIndex !== targetIndex) {
          throw new Error('只能修改最新一轮你的消息，以免清空后面的对话。');
        }

        const following = conversation.slice(targetIndex + 1);

        if (
          following.length > 1 ||
          (following.length === 1 && following[0].role !== 'assistant')
        ) {
          throw new Error('只能修改最新一轮你的消息，以免清空后面的对话。');
        }

        if (conversation.some((message) => message.status === 'streaming')) {
          throw new Error('仍有回复在生成中，请稍后再编辑发送。');
        }

        const lease = beginNovelRequest(novelId);
        if (!lease) {
          throw new Error('该小说已有回复正在生成，请稍后再试。');
        }

        const previousAssistant =
          following.length === 1 && following[0].role === 'assistant' ? following[0] : null;

        // Roll back short-term memory for the reply we're about to replace.
        try {
          if (previousAssistant) {
            await rollbackNovelShortTermForAssistant(
              novelId,
              novel.name,
              previousAssistant.id,
              getNovelWorldId(novel),
            );
          }
          await invalidateNovelMemoriesForEditedTurn(
            novelId,
            novel.name,
            getNovelWorldId(novel),
          );
          if (previousAssistant) {
            await deleteNovelMessage(previousAssistant.id);
          }
        } catch (error) {
          lease.release();
          throw error;
        }

        const updatedUserMessage: Message = {
          ...targetMessage,
          content: trimmedContent,
          status: 'complete',
          updatedAt: timestamp,
        };
        const idSeed = `${novelId}-${Date.now()}`;
        const assistantMessage: Message = {
          id: `${idSeed}-assistant`,
          characterId: novelId,
          role: 'assistant',
          content: '正在生成回复...',
          status: 'streaming',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        // Keep everything before this user turn; drop only the immediate AI reply.
        const storedHistory = [...conversation.slice(0, targetIndex), updatedUserMessage];
        const nextHistory = prepareNovelPromptHistory(storedHistory, updatedUserMessage.id);

        set((current) => ({
          novelConversations: {
            ...current.novelConversations,
            [novelId]: [...storedHistory, assistantMessage],
          },
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, novel.name, timestamp),
              ),
              suggestedRoutes: [],
              isSuggestingRoutes: false,
              activeRequestId: lease.requestId,
              requestStatus: 'streaming',
              requestCommitStatus: 'pending',
              lastCommitError: undefined,
              lastRequestError: undefined,
              lastMessageAt: timestamp,
              updatedAt: timestamp,
            },
          },
        }));

        beginNovelStream(novelId, assistantMessage.id);
        await appendNovelMessage(novelId, updatedUserMessage, getNovelWorldId(novel));
        await appendNovelMessage(novelId, assistantMessage, getNovelWorldId(novel));
        await lease.flushPersistence();

        try {
          const latestState = useTavernStore.getState();
          const sessionMeta = normalizeNovelConversation(
            latestState.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, timestamp),
          );
          const apiSettings = resolveNovelAgentApiSettings(
            latestState.providers,
            latestState.generationSettings,
            'narrator',
          );

          const agentMemory = {
            summary: sessionMeta.agentSummary,
            longTermMemory: sessionMeta.longTermMemory,
            midTermMemories: sessionMeta.midTermMemories,
            shortTermMemories: sessionMeta.shortTermMemories,
            currentChapter: sessionMeta.currentChapter,
          };
          const agentPreflight = await runNovelAgentPreflight({
            providers: latestState.providers,
            generationSettings: latestState.generationSettings,
            novel,
            history: nextHistory,
            instruction: trimmedContent,
            memory: agentMemory,
            signal: lease.signal,
          });
          const chatRequest = {
            apiSettings,
            novel,
            globalSystemPrompt: latestState.globalSystemPrompt,
            history: nextHistory,
            authorsNote: [latestState.authorsNote, latestState.jailbreak]
              .map((item) => item?.trim())
              .filter(Boolean)
              .join('\n\n'),
            agentHandoff: agentPreflight.handoff,
            worldbookEntries: resolveSessionWorldbook(
              latestState.worldbookEntries,
              sessionMeta.boundGlobalWorldbookIds,
            ),
            sessionConfig: {
              contextLength: sessionMeta.contextLength,
              injectionToggles: sessionMeta.injectionToggles,
            },
            memoryState: {
              longTermMemory: sessionMeta.longTermMemory,
              midTermMemories: sessionMeta.midTermMemories,
              shortTermMemories: sessionMeta.shortTermMemories,
              regressionEcho: sessionMeta.regressionEcho,
              currentChapter: sessionMeta.currentChapter,
              memorySystemEnabled: sessionMeta.memorySystemEnabled,
            },
            contentStyle: resolveContentStyleContext(latestState),
            signal: lease.signal,
            onDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) {
                return;
              }
              appendNovelStreamDelta(novelId, assistantMessage.id, flush);
            }),
            onReasoningDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) return;
              set((current) => ({
                novelConversations: {
                  ...current.novelConversations,
                  [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                    message.id === assistantMessage.id
                      ? { ...message, reasoningContent: `${message.reasoningContent ?? ''}${flush}` }
                      : message,
                  ),
                },
              }));
            }),
          };
          let reply = await requestChatCompletion(chatRequest);
          if (shouldRunNovelEditor(novel.agentMode, novel.agentReviewMode)) {
            reply = (
              await runNovelEditorPass({
                providers: latestState.providers,
                generationSettings: latestState.generationSettings,
                novel,
                history: nextHistory,
                instruction: trimmedContent,
                memory: agentMemory,
                directPlan: agentPreflight.directPlan,
                characterBrief: agentPreflight.characterBrief,
                draftReply: reply,
                request: chatRequest,
                signal: lease.signal,
              })
            ).reply;
          }
          if (!lease.isCurrent()) {
            return;
          }
          const completedAt = new Date().toISOString();

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                message.id === assistantMessage.id
                  ? {
                      ...message,
                      content: reply.content,
                      reasoningContent: reply.reasoningContent,
                      status: 'complete',
                      promptTokens: reply.promptTokens,
                      completionTokens: reply.completionTokens,
                      modelId: reply.model ?? apiSettings.model,
                      updatedAt: completedAt,
                    }
                  : message,
              ),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, novel.name, completedAt),
                ),
                lastMessageAt: completedAt,
                updatedAt: completedAt,
                activeRequestId: undefined,
                requestStatus: 'idle',
                requestCommitStatus: 'committed',
                lastCommitError: undefined,
                contextManifest: reply.contextManifest,
                contextStateVersion: reply.contextStateVersion,
                lastRequestError: undefined,
              },
            },
          }));

          await commitNovelMessage(novelId, {
            ...assistantMessage,
            content: reply.content,
            reasoningContent: reply.reasoningContent,
            status: 'complete',
            promptTokens: reply.promptTokens,
            completionTokens: reply.completionTokens,
            modelId: reply.model ?? apiSettings.model,
            updatedAt: completedAt,
          });
          lease.setCommitStatus('committed');
          clearNovelStream(novelId, assistantMessage.id);

          advanceNovelOutlineChapterAfterTurn(novelId, trimmedContent);
          const latestMeta = normalizeNovelConversation(
            useTavernStore.getState().novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, completedAt),
          );
          if (latestMeta.memorySystemEnabled !== false) {
            const postTurnToken = captureCurrentNovelPostTurnToken(
              novelId,
              assistantMessage.id,
              reply.content,
            );
            await runNovelPostTurnMaintenance({
              novelId,
              apiSettings,
              novel,
              userContent: stripNovelChapterExpansion(trimmedContent),
              assistantContent: reply.content,
              assistantMessageId: assistantMessage.id,
              longTermMemory: latestMeta.longTermMemory,
              midTermMemories: latestMeta.midTermMemories,
              shortTermMemories: latestMeta.shortTermMemories,
              agentSummary: latestMeta.agentSummary,
              postTurnToken,
            }).catch((error) => console.warn('[novel-post-turn]', novelId, error));
          }
          if (novel.agentMode === 'direct') {
            updateNovelAgentState(novelId, novel.name, { agentStage: undefined });
          }
          lease.release();
        } catch (error) {
          if (!lease.isCurrent()) {
            return;
          }
          const failedNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
          if (failedNovel?.agentMode === 'direct') {
            updateNovelAgentState(novelId, failedNovel.name, { agentStage: undefined });
          }
          const failedAt = new Date().toISOString();
          const failure = deriveNovelRequestFailure(error);
          const errorMessage = failure.message;

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) => {
                if (message.id !== assistantMessage.id) {
                  return message;
                }

                return {
                  ...message,
                  content: formatNovelRequestFailureContent(message.content, failure),
                  status: failure.messageStatus,
                  updatedAt: failedAt,
                };
              }),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, novel.name, failedAt),
                ),
                activeRequestId: undefined,
                requestStatus: failure.requestStatus,
                requestCommitStatus: 'commit_failed',
                lastCommitError: errorMessage,
                lastRequestError: failure.aborted ? undefined : errorMessage,
                updatedAt: failedAt,
              },
            },
          }));

          try {
            const failedMessage = useTavernStore.getState().novelConversations[novelId]?.find(
              (message) => message.id === assistantMessage.id,
            );
            if (failedMessage) {
              await markNovelMessageStatus(
                novelId,
                failedMessage,
                failure.messageStatus,
              );
              lease.setCommitStatus('committed');
              set((current) => ({
                novelConversationMeta: {
                  ...current.novelConversationMeta,
                  [novelId]: {
                    ...normalizeNovelConversation(current.novelConversationMeta[novelId]),
                    requestCommitStatus: 'committed',
                  },
                },
              }));
            }
          } catch (commitError) {
            lease.setCommitStatus('commit_failed', commitError instanceof Error ? commitError.message : String(commitError));
            console.error('[novel] failed to persist resubmit error state', commitError);
          }
          clearNovelStream(novelId, assistantMessage.id);
          lease.release();
          throw error;
        }
      },
      createWorldbookEntry: (input) => {
        const timestamp = new Date().toISOString();
        const entryId = `worldbook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const entry: WorldbookEntry = {
          id: entryId,
          keys: input.keys,
          content: input.content,
          enabled: input.enabled,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          worldbookEntries: [entry, ...state.worldbookEntries],
        }));

        return entryId;
      },
      deleteWorldbookEntry: (entryId) =>
        set((state) => ({
          worldbookEntries: state.worldbookEntries.filter((entry) => entry.id !== entryId),
        })),
      sendNovelMessage: async (novelId, content) => {
        if (get().novelRecoveryItems.some((item) => item.novelId === novelId)) {
          throw new Error('请先处理未完成的生成请求。');
        }
        const normalizedInput = normalizeNovelUserInput(content);
        if (!normalizedInput) {
          return;
        }
        const { content: trimmedContent, currentChapter: nextChapter } = normalizedInput;

        await waitForNovelPostTurn(novelId);
        const lease = beginNovelRequest(novelId);
        if (!lease) {
          throw new Error('该小说已有回复正在生成，请稍后再试。');
        }

        let assistantMessageId = '';
        try {

        const timestamp = new Date().toISOString();
        const currentNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!currentNovel) {
          throw new Error('小说不存在。');
        }
        const idSeed = `${novelId}-${Date.now()}`;
        const userMessage: Message = {
          id: `${idSeed}-user`,
          characterId: novelId,
          role: 'user',
          content: trimmedContent,
          status: 'complete',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const assistantMessage: Message = {
          id: `${idSeed}-assistant`,
          characterId: novelId,
          role: 'assistant',
          content: '正在生成回复...',
          status: 'streaming',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        assistantMessageId = assistantMessage.id;

        const fallbackHistory = useTavernStore.getState().novelConversations[novelId] ?? [];
        const persistedHistory = await loadNovelConversationForPrompt(novelId, 500, getNovelWorldId(currentNovel)).catch(
          () => [],
        );
        const baseHistory = persistedHistory.length > 0 ? persistedHistory : fallbackHistory;
        const nextHistory = [...prepareNovelPromptHistory(baseHistory), userMessage];

        set((state) => ({
          novelConversations: {
            ...state.novelConversations,
            [novelId]: [...baseHistory, userMessage, assistantMessage],
          },
          novelConversationMeta: {
            ...state.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                state.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(
                    novelId,
                    state.novels.find((item) => item.id === novelId)?.name ?? '未命名小说',
                    timestamp,
                  ),
              ),
              // Clear previous-turn chips so the new reply does not briefly reuse them.
              suggestedRoutes: [],
              isSuggestingRoutes: false,
              activeRequestId: lease.requestId,
              requestStatus: 'streaming',
              requestCommitStatus: 'pending',
              lastCommitError: undefined,
              lastRequestError: undefined,
              ...(nextChapter ? { currentChapter: nextChapter } : {}),
              lastMessageAt: timestamp,
              updatedAt: timestamp,
            },
          },
        }));

        beginNovelStream(novelId, assistantMessage.id);
        await appendNovelMessage(novelId, userMessage, getNovelWorldId(currentNovel));
        await appendNovelMessage(novelId, assistantMessage, getNovelWorldId(currentNovel));
        await lease.flushPersistence();

          const state = useTavernStore.getState();
          const novel = state.novels.find((item) => item.id === novelId);

          if (!novel) {
            throw new Error('小说不存在。');
          }

          const sessionMeta = normalizeNovelConversation(
            state.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, timestamp),
          );

          const apiSettings = resolveNovelAgentApiSettings(
            state.providers,
            state.generationSettings,
            'narrator',
          );

          startStreamingForeground();
          const agentMemory = {
            summary: sessionMeta.agentSummary,
            longTermMemory: sessionMeta.longTermMemory,
            midTermMemories: sessionMeta.midTermMemories,
            shortTermMemories: sessionMeta.shortTermMemories,
            currentChapter: sessionMeta.currentChapter,
          };
          const agentPreflight = await runNovelAgentPreflight({
            providers: state.providers,
            generationSettings: state.generationSettings,
            novel,
            history: nextHistory,
            instruction: trimmedContent,
            memory: agentMemory,
            signal: lease.signal,
          });
          const chatRequest = {
            apiSettings,
            novel,
            globalSystemPrompt: state.globalSystemPrompt,
            history: nextHistory,
            authorsNote: [state.authorsNote, state.jailbreak]
              .map((item) => item?.trim())
              .filter(Boolean)
              .join('\n\n'),
            agentHandoff: agentPreflight.handoff,
            worldbookEntries: resolveSessionWorldbook(
              state.worldbookEntries,
              sessionMeta.boundGlobalWorldbookIds,
            ),
            sessionConfig: {
              contextLength: sessionMeta.contextLength,
              injectionToggles: sessionMeta.injectionToggles,
            },
            memoryState: {
              longTermMemory: sessionMeta.longTermMemory,
              midTermMemories: sessionMeta.midTermMemories,
              shortTermMemories: sessionMeta.shortTermMemories,
              regressionEcho: sessionMeta.regressionEcho,
              currentChapter: sessionMeta.currentChapter,
              memorySystemEnabled: sessionMeta.memorySystemEnabled,
            },
            contentStyle: resolveContentStyleContext(state),
            signal: lease.signal,
            onDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) {
                return;
              }
              appendNovelStreamDelta(novelId, assistantMessage.id, flush);
            }),
            onReasoningDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) return;
              set((current) => ({
                novelConversations: {
                  ...current.novelConversations,
                  [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                    message.id === assistantMessage.id
                      ? { ...message, reasoningContent: `${message.reasoningContent ?? ''}${flush}` }
                      : message,
                  ),
                },
              }));
            }),
          };
          let reply = await requestChatCompletion(chatRequest);
          if (shouldRunNovelEditor(novel.agentMode, novel.agentReviewMode)) {
            reply = (
              await runNovelEditorPass({
                providers: state.providers,
                generationSettings: state.generationSettings,
                novel,
                history: nextHistory,
                instruction: trimmedContent,
                memory: agentMemory,
                directPlan: agentPreflight.directPlan,
                characterBrief: agentPreflight.characterBrief,
                draftReply: reply,
                request: chatRequest,
                signal: lease.signal,
              })
            ).reply;
          }
          if (!lease.isCurrent()) {
            return;
          }
          const completedAt = new Date().toISOString();

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                message.id === assistantMessage.id
                  ? {
                      ...message,
                      content: reply.content,
                      reasoningContent: reply.reasoningContent,
                      status: 'complete',
                      promptTokens: reply.promptTokens,
                      completionTokens: reply.completionTokens,
                      modelId: reply.model ?? apiSettings.model,
                      updatedAt: completedAt,
                    }
                  : message,
              ),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, novel.name, completedAt),
                ),
                lastMessageAt: completedAt,
                updatedAt: completedAt,
                activeRequestId: undefined,
                requestStatus: 'idle',
                requestCommitStatus: 'committed',
                lastCommitError: undefined,
                contextManifest: reply.contextManifest,
                contextStateVersion: reply.contextStateVersion,
                lastRequestError: undefined,
              },
            },
          }));

          await commitNovelMessage(novelId, {
            ...assistantMessage,
            content: reply.content,
            reasoningContent: reply.reasoningContent,
            status: 'complete',
            promptTokens: reply.promptTokens,
            completionTokens: reply.completionTokens,
            modelId: reply.model ?? apiSettings.model,
            updatedAt: completedAt,
          });
          lease.setCommitStatus('committed');
          clearNovelStream(novelId, assistantMessage.id);

          advanceNovelOutlineChapterAfterTurn(novelId, trimmedContent);
          const latestMeta = normalizeNovelConversation(
            useTavernStore.getState().novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, completedAt),
          );
          if (latestMeta.memorySystemEnabled !== false) {
            const postTurnToken = captureCurrentNovelPostTurnToken(
              novelId,
              assistantMessage.id,
              reply.content,
            );
            await runNovelPostTurnMaintenance({
              novelId,
              apiSettings,
              novel,
              userContent: stripNovelChapterExpansion(trimmedContent),
              assistantContent: reply.content,
              assistantMessageId: assistantMessage.id,
              longTermMemory: latestMeta.longTermMemory,
              midTermMemories: latestMeta.midTermMemories,
              shortTermMemories: latestMeta.shortTermMemories,
              agentSummary: latestMeta.agentSummary,
              postTurnToken,
            }).catch((error) => console.warn('[novel-post-turn]', novelId, error));
          }

          if (novel.agentMode === 'direct') {
            updateNovelAgentState(novelId, novel.name, { agentStage: undefined });
          }
          stopStreamingForeground();
          lease.release();
        } catch (error) {
          if (!lease.isCurrent()) {
            return;
          }
          const failedNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
          if (failedNovel?.agentMode === 'direct') {
            updateNovelAgentState(novelId, failedNovel.name, { agentStage: undefined });
          }
          stopStreamingForeground();
          const failedAt = new Date().toISOString();
          const failure = deriveNovelRequestFailure(error);
          const errorMessage = failure.message;

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) => {
                if (message.id !== assistantMessageId) {
                  return message;
                }

                return {
                  ...message,
                  content: formatNovelRequestFailureContent(message.content, failure),
                  status: failure.messageStatus,
                  updatedAt: failedAt,
                };
              }),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, '未命名小说', failedAt),
                ),
                activeRequestId: undefined,
                requestStatus: failure.requestStatus,
                requestCommitStatus: 'commit_failed',
                lastCommitError: errorMessage,
                lastRequestError: failure.aborted ? undefined : errorMessage,
                updatedAt: failedAt,
              },
            },
          }));

          try {
            const failedMessage = useTavernStore.getState().novelConversations[novelId]?.find(
              (message) => message.id === assistantMessageId,
            );
            if (failedMessage) {
              await markNovelMessageStatus(
                novelId,
                failedMessage,
                failure.messageStatus,
              );
              lease.setCommitStatus('committed');
              set((current) => ({
                novelConversationMeta: {
                  ...current.novelConversationMeta,
                  [novelId]: {
                    ...normalizeNovelConversation(current.novelConversationMeta[novelId]),
                    requestCommitStatus: 'committed',
                  },
                },
              }));
            }
          } catch (commitError) {
            lease.setCommitStatus('commit_failed', commitError instanceof Error ? commitError.message : String(commitError));
            console.error('[novel] failed to persist generation error state', commitError);
          }
          clearNovelStream(novelId, assistantMessageId);
          lease.release();
          throw error;
        }
      },
      regenerateNovelMessage: async (novelId, messageId) => {
        if (get().novelRecoveryItems.some((item) => item.novelId === novelId)) {
          throw new Error('请先处理未完成的生成请求。');
        }
        invalidateNovelPostTurn(novelId);
        await waitForNovelPostTurn(novelId);
        const timestamp = new Date().toISOString();
        const state = useTavernStore.getState();
        let novel = state.novels.find((item) => item.id === novelId);
        const conversation = await loadNovelConversationForPrompt(novelId, 500, getNovelWorldId(novel)).catch(
          () => state.novelConversations[novelId] ?? [],
        );
        const targetIndex = conversation.findIndex((message) => message.id === messageId);
        const targetMessage = conversation[targetIndex];

        if (!novel || !targetMessage || targetMessage.role !== 'assistant') {
          return;
        }

        const storedHistory = conversation.slice(0, targetIndex);
        const precedingUser = [...storedHistory].reverse().find((message) => message.role === 'user');
        const history = prepareNovelPromptHistory(storedHistory, precedingUser?.id);
        const isLastMessage = targetIndex === conversation.length - 1;

        // A completed chapter-driven turn advances the active world to the
        // next outline chapter. Regeneration is a replay of the selected turn,
        // so restore the chapter named by that turn before rebuilding context.
        // Otherwise a regenerated 第1章 receives the 第2章 outline.
        const replayChapterIndex =
          parseChapterIndexFromText(targetMessage.content) ??
          parseChapterIndexFromText(precedingUser?.content);
        if (novel && replayChapterIndex !== undefined) {
          const archive = ensureQuickTravelArchive(novel);
          const activeWorld = archive.worlds.find(
            (world) => world.id === (archive.activeWorldId ?? archive.worlds[0]?.id),
          );
          if (
            activeWorld?.runtime.novelGenerationEnabled &&
            activeWorld.runtime.currentChapter !== replayChapterIndex
          ) {
            const updatedAt = new Date().toISOString();
            useTavernStore.getState().updateNovel(novelId, {
              quickTravel: {
                ...archive,
                worlds: archive.worlds.map((world) =>
                  world.id === activeWorld.id
                    ? {
                        ...world,
                        runtime: { ...world.runtime, currentChapter: replayChapterIndex },
                        updatedAt,
                      }
                    : world,
                ),
              },
            });
            novel = useTavernStore.getState().novels.find((item) => item.id === novelId) ?? novel;
          }
        }

        if (conversation.some((message) => message.status === 'streaming')) {
          throw new Error('仍有回复在生成中，请稍后再试。');
        }

        const lease = beginNovelRequest(novelId);
        if (!lease) {
          throw new Error('该小说已有回复正在生成，请稍后再试。');
        }

        // Drop this turn's short-term memory before regenerating so the prompt
        // and the next compress both see a consistent pre-turn state.
        try {
          if (isLastMessage) {
            await rollbackNovelShortTermForAssistant(
              novelId,
              novel.name,
              messageId,
              getNovelWorldId(novel),
            );
          }
        } catch (error) {
          lease.release();
          throw error;
        }

        set((current) => ({
          novelConversations: {
            ...current.novelConversations,
            [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    content: '',
                    reasoningContent: undefined,
                    contentStatus: 'unloaded' as const,
                    status: 'streaming',
                    updatedAt: timestamp,
                  }
                : message,
            ),
          },
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, novel.name, timestamp),
              ),
              suggestedRoutes: [],
              isSuggestingRoutes: false,
              activeRequestId: lease.requestId,
              requestStatus: 'streaming',
              requestCommitStatus: 'pending',
              lastCommitError: undefined,
              lastRequestError: undefined,
              updatedAt: timestamp,
            },
          },
        }));

        beginNovelStream(novelId, messageId);
        await appendNovelMessage(
          novelId,
          { ...targetMessage, content: '', reasoningContent: undefined, status: 'streaming', updatedAt: timestamp },
          getNovelWorldId(novel),
        );
        await lease.flushPersistence();

        try {
          const latestState = useTavernStore.getState();
          const sessionMeta = normalizeNovelConversation(
            latestState.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel.name, timestamp),
          );
          const apiSettings = resolveNovelAgentApiSettings(
            latestState.providers,
            latestState.generationSettings,
            'narrator',
          );

          startStreamingForeground();
          const agentMemory = {
            summary: sessionMeta.agentSummary,
            longTermMemory: sessionMeta.longTermMemory,
            midTermMemories: sessionMeta.midTermMemories,
            shortTermMemories: sessionMeta.shortTermMemories,
            currentChapter: sessionMeta.currentChapter,
          };
          const agentPreflight = await runNovelAgentPreflight({
            providers: latestState.providers,
            generationSettings: latestState.generationSettings,
            novel,
            history,
            instruction: precedingUser?.content ?? targetMessage.content,
            memory: agentMemory,
            signal: lease.signal,
          });
          const chatRequest = {
            apiSettings,
            novel,
            globalSystemPrompt: latestState.globalSystemPrompt,
            history,
            authorsNote: [latestState.authorsNote, latestState.jailbreak]
              .map((item) => item?.trim())
              .filter(Boolean)
              .join('\n\n'),
            agentHandoff: agentPreflight.handoff,
            worldbookEntries: resolveSessionWorldbook(
              latestState.worldbookEntries,
              sessionMeta.boundGlobalWorldbookIds,
            ),
            sessionConfig: {
              contextLength: sessionMeta.contextLength,
              injectionToggles: sessionMeta.injectionToggles,
            },
            memoryState: {
              longTermMemory: sessionMeta.longTermMemory,
              midTermMemories: sessionMeta.midTermMemories,
              shortTermMemories: sessionMeta.shortTermMemories,
              regressionEcho: sessionMeta.regressionEcho,
              currentChapter: sessionMeta.currentChapter,
              memorySystemEnabled: sessionMeta.memorySystemEnabled,
            },
            contentStyle: resolveContentStyleContext(latestState),
            signal: lease.signal,
            onDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) {
                return;
              }
              appendNovelStreamDelta(novelId, messageId, flush);
            }),
            onReasoningDelta: createThrottledDeltaHandler((flush) => {
              if (!lease.isCurrent()) return;
              set((current) => ({
                novelConversations: {
                  ...current.novelConversations,
                  [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                    message.id === messageId
                      ? { ...message, reasoningContent: `${message.reasoningContent ?? ''}${flush}` }
                      : message,
                  ),
                },
              }));
            }),
          };
          let reply = await requestChatCompletion(chatRequest);
          if (shouldRunNovelEditor(novel.agentMode, novel.agentReviewMode)) {
            reply = (
              await runNovelEditorPass({
                providers: latestState.providers,
                generationSettings: latestState.generationSettings,
                novel,
                history,
                instruction: precedingUser?.content ?? targetMessage.content,
                memory: agentMemory,
                directPlan: agentPreflight.directPlan,
                characterBrief: agentPreflight.characterBrief,
                draftReply: reply,
                request: chatRequest,
                signal: lease.signal,
              })
            ).reply;
          }
          const completedAt = new Date().toISOString();

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      content: reply.content,
                      reasoningContent: reply.reasoningContent,
                      status: 'complete',
                      promptTokens: reply.promptTokens,
                      completionTokens: reply.completionTokens,
                      modelId: reply.model ?? apiSettings.model,
                      updatedAt: completedAt,
                    }
                  : message,
              ),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, novel.name, completedAt),
                ),
                lastMessageAt: completedAt,
                updatedAt: completedAt,
                activeRequestId: undefined,
                requestStatus: 'idle',
                requestCommitStatus: 'committed',
                lastCommitError: undefined,
                contextManifest: reply.contextManifest,
                contextStateVersion: reply.contextStateVersion,
                lastRequestError: undefined,
              },
            },
          }));

          await commitNovelMessage(novelId, {
            ...targetMessage,
            content: reply.content,
            reasoningContent: reply.reasoningContent,
            status: 'complete',
            promptTokens: reply.promptTokens,
            completionTokens: reply.completionTokens,
            modelId: reply.model ?? apiSettings.model,
            updatedAt: completedAt,
          });
          lease.setCommitStatus('committed');
          clearNovelStream(novelId, messageId);

          if (isLastMessage && precedingUser?.content.trim()) {
            const latestMeta = normalizeNovelConversation(
              useTavernStore.getState().novelConversationMeta[novelId] ??
                createEmptyNovelConversation(novelId, novel.name, completedAt),
            );
            if (latestMeta.memorySystemEnabled !== false) {
              const postTurnToken = captureCurrentNovelPostTurnToken(novelId, messageId, reply.content);
              await runNovelPostTurnMaintenance({
                novelId,
                apiSettings,
                novel,
                userContent: stripNovelChapterExpansion(precedingUser.content),
                assistantContent: reply.content,
                assistantMessageId: messageId,
                longTermMemory: latestMeta.longTermMemory,
                midTermMemories: latestMeta.midTermMemories,
                shortTermMemories: latestMeta.shortTermMemories,
                agentSummary: latestMeta.agentSummary,
                postTurnToken,
              }).catch((error) => console.warn('[novel-post-turn]', novelId, error));
            }
          }

          if (novel.agentMode === 'direct') {
            updateNovelAgentState(novelId, novel.name, { agentStage: undefined });
          }
          stopStreamingForeground();
        } catch (error) {
          if (!lease.isCurrent()) {
            return;
          }
          if (novel.agentMode === 'direct') {
            updateNovelAgentState(novelId, novel.name, { agentStage: undefined });
          }
          stopStreamingForeground();
          const failedAt = new Date().toISOString();
          const failure = deriveNovelRequestFailure(error);
          const errorMessage = failure.aborted ? failure.message : (failure.message === '请求模型失败。' ? '重新生成失败。' : failure.message);

          set((current) => ({
            novelConversations: {
              ...current.novelConversations,
              [novelId]: (current.novelConversations[novelId] ?? []).map((message) => {
                if (message.id !== messageId) {
                  return message;
                }

                return {
                  ...message,
                  content: formatNovelRequestFailureContent(message.content, failure, '重新生成失败'),
                  status: failure.messageStatus,
                  updatedAt: failedAt,
                };
              }),
            },
            novelConversationMeta: {
              ...current.novelConversationMeta,
              [novelId]: {
                ...normalizeNovelConversation(
                  current.novelConversationMeta[novelId] ??
                    createEmptyNovelConversation(novelId, '未命名小说', failedAt),
                ),
                activeRequestId: undefined,
                requestStatus: failure.requestStatus,
                requestCommitStatus: 'commit_failed',
                lastCommitError: errorMessage,
                lastRequestError: failure.aborted ? undefined : errorMessage,
                updatedAt: failedAt,
              },
            },
          }));
          try {
            const failedMessage = useTavernStore.getState().novelConversations[novelId]?.find(
              (message) => message.id === messageId,
            );
            if (failedMessage) {
              await markNovelMessageStatus(
                novelId,
                failedMessage,
                failure.messageStatus,
              );
              lease.setCommitStatus('committed');
              set((current) => ({
                novelConversationMeta: {
                  ...current.novelConversationMeta,
                  [novelId]: {
                    ...normalizeNovelConversation(current.novelConversationMeta[novelId]),
                    requestCommitStatus: 'committed',
                  },
                },
              }));
            }
          } catch (commitError) {
            lease.setCommitStatus('commit_failed', commitError instanceof Error ? commitError.message : String(commitError));
            console.error('[novel] failed to persist regeneration error state', commitError);
          }
          clearNovelStream(novelId, messageId);
        } finally {
          lease.release();
        }
      },
      cancelNovelMessage: (novelId) => {
        const requestId = getActiveNovelRequestId(novelId);
        if (!requestId) {
          return false;
        }
        const timestamp = new Date().toISOString();
        set((current) => ({
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, '未命名小说', timestamp),
              ),
              activeRequestId: requestId,
              requestStatus: 'cancelling',
              updatedAt: timestamp,
            },
          },
        }));
        cancelActiveNovelRequest(novelId);
        return true;
      },
      addProvider: (input) => {
        const provider = createEmptyProvider(input);

        set((state) => ({
          providers: {
            ...state.providers,
            [provider.id]: {
              ...provider,
              isActive: Object.keys(state.providers).length === 0,
            },
          },
        }));

        return provider.id;
      },
      updateProvider: (providerId, updates) =>
        set((state) => {
          const current = state.providers[providerId];

          if (!current) {
            return state;
          }

          if (typeof updates.apiKey === 'string') {
            void saveProviderApiKey(providerId, updates.apiKey).catch(() => {
              set({
                providerSecretsWarning:
                  'SecureStore 写入失败；API Key 只保留在本次会话，不会写入持久化状态。',
              });
            });
          }

          return {
            providers: {
              ...state.providers,
              [providerId]: {
                ...current,
                ...updates,
                id: providerId,
                isActive: current.isActive,
              },
            },
          };
        }),
      setProviderApiKey: (providerId, apiKey) => {
        void saveProviderApiKey(providerId, apiKey).catch(() => {
          set({
            providerSecretsWarning:
              'SecureStore 写入失败；API Key 只保留在本次会话，不会写入持久化状态。',
          });
        });
        set((state) => {
          const current = state.providers[providerId];
          if (!current) {
            return state;
          }
          return {
            providers: {
              ...state.providers,
              [providerId]: { ...current, apiKey: apiKey.trim() },
            },
          };
        });
      },
      removeProvider: (providerId) =>
        set((state) => {
          void removeProviderApiKey(providerId).catch(() => undefined);
          const { [providerId]: _removed, ...remaining } = state.providers;
          const nextProviders = ensureActiveProvider(remaining);
          return {
            providers:
              Object.keys(nextProviders).length > 0 ? nextProviders : { ...DEFAULT_PROVIDERS },
            generationSettings: normalizeGenerationSettings(
              state.generationSettings.utilityProviderId === providerId ||
                state.generationSettings.collaborationProviderId === providerId
                ? {
                    ...state.generationSettings,
                    ...(state.generationSettings.utilityProviderId === providerId
                      ? { utilityProviderId: '', utilityModelId: '' }
                      : {}),
                    ...(state.generationSettings.collaborationProviderId === providerId
                      ? { collaborationProviderId: '', collaborationModelId: '' }
                      : {}),
                  }
                : state.generationSettings,
            ),
          };
        }),
      setActiveProvider: (providerId) =>
        set((state) => {
          if (!state.providers[providerId]) {
            return state;
          }

          return {
            providers: Object.fromEntries(
              Object.values(state.providers).map((provider) => [
                provider.id,
                {
                  ...provider,
                  isActive: provider.id === providerId,
                },
              ]),
            ),
          };
        }),
      setProviderFetchedModels: (providerId, models) =>
        set((state) => {
          const current = state.providers[providerId];

          if (!current) {
            return state;
          }

          const selectedModel =
            current.selectedModel && models.some((model) => modelIdsEqual(model, current.selectedModel))
              ? current.selectedModel
              : (models[0] ?? '');

          return {
            providers: {
              ...state.providers,
              [providerId]: {
                ...current,
                fetchedModels: models,
                fetchedModelsSource: 'remote',
                selectedModel,
              },
            },
          };
        }),
      setProviderSelectedModel: (providerId, modelId) =>
        set((state) => {
          const current = state.providers[providerId];

          if (!current) {
            return state;
          }

          return {
            providers: {
              ...state.providers,
              [providerId]: {
                ...current,
                selectedModel: modelId.trim(),
              },
            },
          };
        }),
      updateProviderModelSettings: (providerId, modelId, settings) =>
        set((state) => {
          const current = state.providers[providerId];
          const normalizedModelId = modelId.trim();
          if (!current || !normalizedModelId) {
            return state;
          }

          return {
            providers: {
              ...state.providers,
              [providerId]: {
                ...current,
                modelSettings: {
                  ...(current.modelSettings ?? {}),
                  [normalizedModelId]: {
                    ...(current.modelSettings?.[normalizedModelId] ?? {}),
                    ...settings,
                  },
                },
              },
            },
          };
        }),
      updateGenerationSettings: (settings) =>
        set((state) => ({
          generationSettings: normalizeGenerationSettings({
            ...state.generationSettings,
            ...settings,
          }),
        })),
      updateImageGenerationSettings: (settings) =>
        set((state) => ({
          imageGenerationSettings: normalizeImageGenerationSettings({
            ...state.imageGenerationSettings,
            ...settings,
          }),
        })),
      addImageProvider: (input) => {
        const provider = createImageProvider(input);
        set((state) => ({
          imageGenerationSettings: {
            ...state.imageGenerationSettings,
            providerId: state.imageGenerationSettings.providerId || provider.id,
            providers: {
              ...state.imageGenerationSettings.providers,
              [provider.id]: provider,
            },
          },
        }));
        return provider.id;
      },
      updateImageProvider: (providerId, updates) =>
        set((state) => {
          const current = state.imageGenerationSettings.providers[providerId];
          if (!current) return state;
          if (typeof updates.apiKey === 'string') {
            void saveImageProviderApiKey(providerId, updates.apiKey).catch(() => {
              set({
                providerSecretsWarning:
                  'SecureStore 写入失败；图像 API Key 只保留在本次会话，不会写入持久化状态。',
              });
            });
          }
          return {
            imageGenerationSettings: {
              ...state.imageGenerationSettings,
              providers: {
                ...state.imageGenerationSettings.providers,
                [providerId]: {
                  ...current,
                  ...updates,
                  id: providerId,
                  apiKey: typeof updates.apiKey === 'string' ? updates.apiKey.trim() : current.apiKey,
                },
              },
            },
          };
        }),
      setImageProviderApiKey: (providerId, apiKey) => {
        void saveImageProviderApiKey(providerId, apiKey).catch(() => {
          set({
            providerSecretsWarning:
              'SecureStore 写入失败；图像 API Key 只保留在本次会话，不会写入持久化状态。',
          });
        });
        set((state) => {
          const current = state.imageGenerationSettings.providers[providerId];
          if (!current) return state;
          return {
            imageGenerationSettings: {
              ...state.imageGenerationSettings,
              providers: {
                ...state.imageGenerationSettings.providers,
                [providerId]: { ...current, apiKey: apiKey.trim() },
              },
            },
          };
        });
      },
      removeImageProvider: (providerId) =>
        set((state) => {
          void removeImageProviderApiKey(providerId).catch(() => undefined);
          const { [providerId]: _removed, ...remaining } = state.imageGenerationSettings.providers;
          const nextProviderId =
            state.imageGenerationSettings.providerId === providerId
              ? Object.keys(remaining)[0] ?? ''
              : state.imageGenerationSettings.providerId;
          return {
            imageGenerationSettings: normalizeImageGenerationSettings({
              providerId: nextProviderId,
              providers: remaining,
            }),
          };
        }),
      updateAppearanceSettings: (settings) =>
        set((state) => ({
          appearanceSettings: normalizeAppearanceSettings({
            ...state.appearanceSettings,
            ...settings,
          }),
        })),
      updateExportSettings: (settings) =>
        set((state) => ({
          exportSettings: normalizeExportSettings({
            ...state.exportSettings,
            ...settings,
          }),
        })),
      updateNovelPromptDefaults: (settings) =>
        set((state) => ({
          novelPromptDefaults: normalizeNovelPromptDefaults({
            ...state.novelPromptDefaults,
            ...settings,
          }),
        })),
      updateContentStyleSettings: (settings) =>
        set((state) => ({
          contentStyleSettings: normalizeContentStyleSettings({
            ...state.contentStyleSettings,
            ...settings,
            bans:
              settings.bans === undefined
                ? state.contentStyleSettings.bans
                : { ...state.contentStyleSettings.bans, ...settings.bans },
          }),
        })),
      updateNovelAppearance: (novelId, updates) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel({
                    ...novel,
                    ...updates,
                    chatBackgroundOpacity:
                      updates.chatBackgroundOpacity === undefined
                        ? novel.chatBackgroundOpacity
                        : clampChatBackgroundOpacity(updates.chatBackgroundOpacity),
                    updatedAt: timestamp,
                  })
                : novel,
            ),
          };
        }),
      // ── Novel continuation workbench (sync CRUD) ────────────────────────────
      saveNovelChapter: (novelId, chapter) => saveChapterChanges(novelId, (novel) => {
        const existing = novel.chapters?.find((item) => item.id === chapter.id);
        if (existing && existing.updatedAt !== chapter.updatedAt) throw new Error('章节已更新，请重新打开后再保存。');
        if (existing && existing.contentStatus && existing.contentStatus !== 'loaded') throw new Error('请等待章节正文加载完成后再保存。');
        if (novel.chapters?.some((item) => item.id !== chapter.id && item.index === chapter.index)) throw new Error('该章号已存在，请重新打开章节目录。');
        return [{ ...chapter, status: 'draft', contentStatus: 'loaded', updatedAt: nowIso() }];
      }),
      appendNovelChapters: (novelId, chapters) => saveChapterChanges(novelId, (novel) => {
        const ids = new Set(novel.chapters?.map((chapter) => chapter.id));
        const indexes = new Set(novel.chapters?.map((chapter) => chapter.index));
        for (const chapter of chapters) {
          if (ids.has(chapter.id) || indexes.has(chapter.index)) throw new Error('章节已存在，请重新打开目录后重试。');
          ids.add(chapter.id); indexes.add(chapter.index);
        }
        return chapters.map((chapter) => ({ ...chapter, contentStatus: 'loaded' }));
      }),
      importNovelText: (novelId, imported) => saveChapterChanges(novelId, (novel) => {
        const legacy = buildLegacyNovelChapters(novelId, get().novelConversations[novelId] ?? [], novel.chapters ?? []);
        const validation = validateNovelTextImport({ imported, existingChapters: novel.chapters,
          generationJobs: novel.novelGenerationJobs, legacyChapters: legacy });
        if (!validation.ok) throw new Error(validation.reason);
        return buildImportedNovelChapters(imported.chapters, novel.chapters ?? []);
      }),
      addNovelChapter: (novelId, chapter) => {
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? markNovelChapterStateStale(
                  { ...novel, chapters: [...(novel.chapters ?? []), chapter], updatedAt: chapter.updatedAt },
                  chapter.index,
                )
              : novel,
          ),
          novelConversationMeta: state.novelConversationMeta[novelId]
            ? { ...state.novelConversationMeta, [novelId]: { ...state.novelConversationMeta[novelId], memoryStale: true } }
            : state.novelConversationMeta,
        }));
        void invalidateNovelDerivedStateInDatabase(novelId, chapter.id).catch((error) => {
          console.error('[novel] chapter invalidation failed', error);
        });
        void persistNovelChapter(novelId, chapter)
          .catch((error) => {
            console.error('[novel] chapter database write failed', error);
          });
      },
      updateNovelChapter: (novelId, chapterId, updates) => {
        const current = useTavernStore.getState().novels.find((novel) => novel.id === novelId);
        const chapter = current?.chapters?.find((item) => item.id === chapterId);
        const timestamp = new Date().toISOString();
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? markNovelChapterStateStale(
                  {
                    ...novel,
                    chapters: (novel.chapters ?? []).map((item) =>
                      item.id === chapterId
                        ? {
                            ...item,
                            ...updates,
                            // Editing accepted canon creates a new draft. The prior
                            // immutable chapter_revision remains the active history
                            // until this draft is explicitly confirmed.
                            status: item.status === 'final' ? 'draft' as const : item.status,
                            updatedAt: timestamp,
                          }
                        : item,
                    ),
                    updatedAt: timestamp,
                  },
                  chapter?.index ?? 1,
                )
              : novel,
          ),
          novelConversationMeta: state.novelConversationMeta[novelId]
            ? { ...state.novelConversationMeta, [novelId]: { ...state.novelConversationMeta[novelId], memoryStale: true } }
            : state.novelConversationMeta,
        }));
        if (chapter) {
          void invalidateNovelDerivedStateInDatabase(novelId, chapter.id).catch((error) => {
            console.error('[novel] chapter invalidation failed', error);
          });
          const nextChapter = useTavernStore.getState().novels
            .find((novel) => novel.id === novelId)
            ?.chapters?.find((item) => item.id === chapterId);
          if (nextChapter) {
            void persistNovelChapter(novelId, nextChapter)
              .catch((error) => {
                console.error('[novel] chapter database write failed', error);
              });
          }
        }
      },
      finalizeNovelChapter: async (novelId, chapterId) => {
        const result = await get().confirmNovelChapter(novelId, chapterId);
        if (!result.committed) {
          throw new Error(`章节未定稿：${result.warnings.join('；') || '验收未通过'}`);
        }
      },
      deleteNovelChapter: (novelId, chapterId) => {
        const current = useTavernStore.getState().novels.find((novel) => novel.id === novelId);
        const chapter = current?.chapters?.find((item) => item.id === chapterId);
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? markNovelChapterStateStale(
                  { ...novel, chapters: (novel.chapters ?? []).filter((item) => item.id !== chapterId), updatedAt: new Date().toISOString() },
                  chapter?.index ?? 1,
                )
              : novel,
          ),
          novelConversationMeta: state.novelConversationMeta[novelId]
            ? { ...state.novelConversationMeta, [novelId]: { ...state.novelConversationMeta[novelId], memoryStale: true } }
            : state.novelConversationMeta,
        }));
        if (chapter) {
          void invalidateNovelDerivedStateInDatabase(novelId, chapter.id).catch((error) => {
            console.error('[novel] chapter invalidation failed', error);
          });
          void removeNovelChapterFromDatabase(novelId, chapter.id).catch((error) => {
            console.error('[novel] chapter database delete failed', error);
          });
        }
      },
      saveNovelChapterAudit: (novelId, audit) =>
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  audits: [
                    {
                      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      createdAt: new Date().toISOString(),
                      ...audit,
                    },
                    ...(novel.audits ?? []),
                  ].slice(0, 200),
                  updatedAt: new Date().toISOString(),
                }
              : novel,
          ),
        })),
      replaceNovelForeshadowings: (novelId, items) =>
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? { ...novel, foreshadowings: items, updatedAt: new Date().toISOString() }
              : novel,
          ),
        })),
      applyNovelStoryImport: (novelId, candidate, selectedIds, baseFingerprint) => {
        const lockOwner = acquireNovelWriteLock(novelId, 'story-import');
        if (!lockOwner) throw new Error('作品正在更新状态，请稍后再写入。');
        let report = { appliedCount: 0, skipped: [] as string[] };
        try {
          set((state) => {
            const novel = state.novels.find((item) => item.id === novelId);
            if (!novel) throw new Error('作品已不存在。');
            if (novel.quickTravel?.config.enabled) throw new Error('请在普通小说中整理资料；快穿世界需在各世界内维护。');
            if (novel.novelGenerationJobs?.some((job) => job.status === 'running')) throw new Error('请等待当前写作任务结束后再写入资料。');
            if (storyImportFingerprint(novel) !== baseFingerprint) throw new Error('作品资料已发生变化，请刷新对照后重新选择。');
            const result = buildStoryImportPatch(novel, candidate, selectedIds);
            if (!result.appliedCount) throw new Error('没有可写入的所选内容，请重新检查选择。');
            report = { appliedCount: result.appliedCount, skipped: result.skipped };
            let updated = { ...novel, ...result.patch, updatedAt: nowIso() };
            if (result.patch.outline) {
              if (novel.outline) updated = appendNovelOutlineVersion(updated, 'novel', novel.outline, 'manual', '粘贴识别前的大纲');
              updated = appendNovelOutlineVersion(updated, 'novel', result.patch.outline, 'manual', '采用粘贴识别的资料');
            }
            return { novels: state.novels.map((item) => item.id === novelId ? updated : item) };
          });
          const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
          if (updated) void persistNovelMetadata(updated).catch((error) => console.error('[novel] failed to persist imported story materials', error));
          return report;
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      saveNovelOutlineAtScope: (novelId, scopeId, outline, reason) => {
        set((state) => ({
          novels: state.novels.map((novel) => {
            if (novel.id !== novelId) return novel;
            const next = replaceNovelOutlineAtScope(novel, scopeId, cloneNovelOutline(outline));
            return next
              ? appendNovelOutlineVersion(next, scopeId, outline, 'manual', reason)
              : novel;
          }),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist outline update', error);
          });
        }
      },
      clearNovelOutlineAtScope: (novelId, scopeId, reason) => {
        set((state) => ({
          novels: state.novels.map((novel) => {
            if (novel.id !== novelId) return novel;
            const previous = getNovelOutlineAtScope(novel, scopeId);
            const cleared = replaceNovelOutlineAtScope(novel, scopeId, undefined);
            if (!cleared) return novel;
            const next = previous
              ? appendNovelOutlineVersion(cleared, scopeId, previous, 'manual', reason ?? '清空前快照')
              : { ...cleared, updatedAt: new Date().toISOString() };
            return {
              ...next,
              outlineProposals: (next.outlineProposals ?? []).map((proposal) =>
                proposal.scopeId === scopeId && proposal.status === 'pending'
                  ? { ...proposal, status: 'conflicted', error: '大纲已被清空，请重新生成提案。', updatedAt: new Date().toISOString() }
                  : proposal,
              ),
            };
          }),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist cleared outline', error);
          });
        }
      },
      saveNovelOutlineProposal: (novelId, input): string | null => {
        const current = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!current) return null;

        const scopeId = input.scopeId ?? 'novel';
        const currentOutline = getNovelOutlineAtScope(current, scopeId);
        const baseOutline = currentOutline ?? {
          summary: '',
          volumes: [],
          updatedAt: new Date(0).toISOString(),
        };
        const baseHash = hashNovelOutline(baseOutline);
        const candidate = cloneNovelOutline(input.candidateOutline);
        const currentVolumeIds = new Set((currentOutline?.volumes ?? []).map((volume) => volume.id));
        const candidateVolume = input.targetVolumeId
          ? candidate.volumes.find((volume) => volume.id === input.targetVolumeId)
          : undefined;
        let patch: NovelOutlinePatch;
        if (
          (input.operation === 'reshape' || (input.operation === 'revise' && !input.targetChapterIndexes?.length))
          && candidateVolume
          && currentOutline?.volumes.some((volume) => volume.id === candidateVolume.id)
        ) {
          // A reshape may add/remove chapters, which can shift every following
          // volume's chapter indexes. Keep the normalized full candidate so the
          // accept step cannot leave duplicate indexes in later volumes.
          patch = { op: 'replace_outline', outline: candidate, beforeHash: baseHash };
        } else if (input.appendVolumes && currentOutline) {
          patch = {
            op: 'append_volumes',
            volumes: candidate.volumes.filter((volume) => !currentVolumeIds.has(volume.id)),
            beforeHash: baseHash,
          };
        } else if (input.operation === 'append' && candidateVolume && currentOutline?.volumes.some((volume) => volume.id === candidateVolume.id)) {
          const currentVolume = currentOutline.volumes.find((volume) => volume.id === candidateVolume.id)!;
          const existingIndexes = new Set(currentVolume.chapters.map((chapter) => chapter.index));
          const chapters = candidateVolume.chapters.filter((chapter) => !existingIndexes.has(chapter.index));
          patch = {
            op: 'append_chapters',
            volumeId: candidateVolume.id,
            chapters,
            beforeHash: baseHash,
          };
        } else if (input.operation === 'revise' && candidateVolume && currentOutline?.volumes.some((volume) => volume.id === candidateVolume.id) && input.targetChapterIndexes?.length) {
          const selected = new Set(input.targetChapterIndexes);
          patch = {
            op: 'update_selected_chapters',
            volumeId: candidateVolume.id,
            chapterIndexes: [...selected],
            chapters: candidateVolume.chapters.filter((chapter) => selected.has(chapter.index)),
            beforeHash: baseHash,
          };
        } else if (input.operation === 'reorder' && candidateVolume && currentOutline?.volumes.some((volume) => volume.id === candidateVolume.id)) {
          patch = {
            op: 'reorder_chapters',
            volumeId: candidateVolume.id,
            chapterIndexes: candidateVolume.chapters.map((chapter) => chapter.index),
            beforeHash: baseHash,
          };
        } else if (candidateVolume && currentOutline?.volumes.some((volume) => volume.id === candidateVolume.id)) {
          patch = {
            op: 'update_volume',
            volumeId: candidateVolume.id,
            volume: candidateVolume,
            beforeHash: baseHash,
          };
        } else {
          patch = { op: 'replace_outline', outline: candidate, beforeHash: baseHash };
        }

        if ((patch.op === 'append_chapters' || patch.op === 'update_selected_chapters') && patch.chapters.length === 0) {
          return null;
        }

        const timestamp = new Date().toISOString();
        const proposalId = makeId('outline-proposal');
        const proposal: NovelOutlineProposal = {
          id: proposalId,
          scopeId,
          operation: input.operation,
          prompt: input.prompt.trim(),
          baseHash,
          baseVersionId: [...(current.outlineVersions ?? [])]
            .reverse()
            .find((version) => version.scopeId === scopeId)?.id,
          patch,
          status: 'pending',
          ...(input.modelId ? { modelId: input.modelId } : {}),
          ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  outlineProposals: [
                    ...(novel.outlineProposals ?? []).map((item) =>
                      item.status === 'pending'
                        ? { ...item, status: 'rejected' as const, error: '已由更新的提案替代。', updatedAt: timestamp }
                        : item,
                    ),
                    proposal,
                  ].slice(-20),
                  updatedAt: timestamp,
                }
              : novel,
          ),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist outline proposal', error);
          });
        }
        return proposalId;
      },
      acceptNovelOutlineProposal: (novelId, proposalId) => {
        const current = useTavernStore.getState().novels.find((item) => item.id === novelId);
        const proposal = current?.outlineProposals?.find((item) => item.id === proposalId);
        if (!current || !proposal) return { ok: false, reason: 'missing' as const };
        if (proposal.status !== 'pending') return { ok: false, reason: 'invalid' as const };

        const currentOutline = getNovelOutlineAtScope(current, proposal.scopeId);
        const currentHash = hashNovelOutline(currentOutline ?? {
          summary: '',
          volumes: [],
          updatedAt: new Date(0).toISOString(),
        });
        if (currentHash !== proposal.baseHash) {
          const timestamp = new Date().toISOString();
          set((state) => ({
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? {
                    ...novel,
                    outlineProposals: (novel.outlineProposals ?? []).map((item) =>
                      item.id === proposalId
                        ? { ...item, status: 'conflicted', error: '大纲在生成提案后发生了变化，请基于最新版本重新生成。', updatedAt: timestamp }
                        : item,
                    ),
                    updatedAt: timestamp,
                  }
              : novel,
            ),
          }));
          const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
          if (updated) {
            void persistNovelMetadata(updated).catch((error) => {
              console.error('[novel] failed to persist conflicted outline proposal', error);
            });
          }
          return { ok: false, reason: 'conflict' as const };
        }

        const nextOutline = applyNovelOutlinePatch(currentOutline, proposal.patch);
        if (!nextOutline) return { ok: false, reason: 'invalid' as const };
        const replaced = replaceNovelOutlineAtScope(current, proposal.scopeId, nextOutline);
        if (!replaced) return { ok: false, reason: 'invalid' as const };
        const versioned = appendNovelOutlineVersion(
          replaced,
          proposal.scopeId,
          nextOutline,
          'ai_accept',
          `采纳大纲提案：${proposal.prompt}`,
          proposal.id,
        );
        const timestamp = new Date().toISOString();
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...versioned,
                  outlineProposals: (versioned.outlineProposals ?? []).map((item) =>
                    item.id === proposalId ? { ...item, status: 'accepted', updatedAt: timestamp } : item,
                  ),
                  updatedAt: timestamp,
                }
              : novel,
          ),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist accepted outline proposal', error);
          });
        }
        return { ok: true as const };
      },
      rejectNovelOutlineProposal: (novelId, proposalId) => {
        const timestamp = new Date().toISOString();
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  outlineProposals: (novel.outlineProposals ?? []).map((item) =>
                    item.id === proposalId && item.status === 'pending'
                      ? { ...item, status: 'rejected', updatedAt: timestamp }
                      : item,
                  ),
                  updatedAt: timestamp,
                }
              : novel,
          ),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist rejected outline proposal', error);
          });
        }
      },
      deleteNovelOutlineProposal: (novelId, proposalId) => {
        const current = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!current?.outlineProposals?.some((proposal) => proposal.id === proposalId)) {
          return;
        }
        const timestamp = new Date().toISOString();
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  outlineProposals: (novel.outlineProposals ?? []).filter((proposal) => proposal.id !== proposalId),
                  updatedAt: timestamp,
                }
              : novel,
          ),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist deleted outline proposal', error);
          });
        }
      },
      deleteNovelOutlineVersion: (novelId, versionId) => {
        const current = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!current?.outlineVersions?.some((version) => version.id === versionId)) {
          return;
        }
        const timestamp = new Date().toISOString();
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  outlineVersions: (novel.outlineVersions ?? []).filter((version) => version.id !== versionId),
                  updatedAt: timestamp,
                }
              : novel,
          ),
        }));
        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist deleted outline version', error);
          });
        }
      },
      updateNovelContinuationSettings: (novelId, updates) =>
        set((state) => ({
          novels: state.novels.map((novel) =>
            novel.id === novelId
              ? {
                  ...novel,
                  continuationSettings: {
                    ...DEFAULT_NOVEL_CONTINUATION_SETTINGS,
                    ...novel.continuationSettings,
                    ...updates,
                  },
                  updatedAt: new Date().toISOString(),
                }
              : novel,
          ),
        })),
      recordNovelContinuationUsage: (novelId, task, tokens) =>
        set((state) => ({
          novels: state.novels.map((novel) => {
            if (novel.id !== novelId) {
              return novel;
            }

            const current = novel.continuationStats?.[task] ?? { calls: 0, tokens: 0 };

            return {
              ...novel,
              continuationStats: {
                ...(novel.continuationStats ?? {}),
                [task]: { calls: current.calls + 1, tokens: current.tokens + tokens },
              },
              updatedAt: new Date().toISOString(),
            };
          }),
        })),
      backupNovelChapter: (novelId, chapterId) =>
        set((state) => ({
          novels: state.novels.map((novel) => {
            if (novel.id !== novelId) {
              return novel;
            }

            const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);
            if (!chapter) {
              return novel;
            }

            const backup: NovelChapterBackup = {
              id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              chapterId,
              title: chapter.title,
              content: chapter.content,
              summary: chapter.summary,
              goal: chapter.goal,
              createdAt: new Date().toISOString(),
            };

            return {
              ...novel,
              chapterBackups: [...(novel.chapterBackups ?? []), backup].slice(-50),
              updatedAt: new Date().toISOString(),
            };
          }),
        })),
      rollbackNovelChapter: async (novelId, chapterId, backupId) => {
        const novel = get().novels.find((item) => item.id === novelId);
        const backup = novel?.chapterBackups?.find(
          (item) => item.id === backupId && item.chapterId === chapterId,
        );
        if (!backup || !novel?.chapters?.some((item) => item.id === chapterId)) return;
        // Use the same draft, invalidation and database path as a manual edit.
        await get().saveNovelChapter(novelId, {
          ...novel.chapters!.find((item) => item.id === chapterId)!,
          title: backup.title,
          content: backup.content,
          ...(typeof backup.summary === 'string' ? { summary: backup.summary } : {}),
          ...(typeof backup.goal === 'string' ? { goal: backup.goal } : {}),
        });
      },
      // ── Novel continuation workbench (async AI orchestrators) ───────────────
      auditNovelChapter: async (novelId, chapterId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);

        if (!chapter) {
          throw new Error('章节不存在。');
        }

        const issues: NovelAuditIssue[] = auditChapterWithRules(chapter);
        const sourceFingerprint = getNovelAuditSourceFingerprint(novel, chapter);

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'review',
        });
        const recentChapters = getFinalChapters(novel)
          .filter((item) => item.index < chapter.index)
          .slice(-3);

        let modelId: string | undefined;
        let factTokens = 0;
        let reportedHooks: Awaited<ReturnType<typeof factCheckChapter>>['foreshadowings'] = [];

        try {
          const fc = await factCheckChapter({ apiSettings, novel, chapter, recentChapters });
          issues.push(...fc.issues);
          modelId = fc.modelId;
          factTokens = fc.tokens;
          reportedHooks = fc.foreshadowings;
        } catch {
          // Utility lane down — keep rule-only results.
        }

        useTavernStore.getState().saveNovelChapterAudit(novelId, {
          chapterId,
          chapterIndex: chapter.index,
          issues,
          passed: issues.length === 0,
          modelId,
          sourceFingerprint,
          stale: (() => {
            const latestNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
            const latestChapter = latestNovel?.chapters?.find((item) => item.id === chapterId);
            return !latestNovel || !latestChapter ||
              getNovelAuditSourceFingerprint(latestNovel, latestChapter) !== sourceFingerprint;
          })(),
        });
        useTavernStore
          .getState()
          .recordNovelContinuationUsage(novelId, 'fact-check', factTokens);

        if (reportedHooks.length > 0) {
          const merged = syncForeshadowings(
            novel.foreshadowings ?? [],
            reportedHooks,
            chapter.index,
          );
          useTavernStore.getState().replaceNovelForeshadowings(novelId, merged);
        }
      },
      generateNovelOutline: async (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'outline',
        });
        const outlineOptions = resolveNovelOutlineOptions(novel, options);
        const nextIndex = outlineOptions.startChapterIndex ?? getNextChapterIndex(novel);
        const { startChapterIndex: _startChapterIndex, ...outlineRequest } = outlineOptions;

        const jobId = makeId('job-outline');
        const startedAt = nowIso();
        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'outline',
          mode: 'continue',
          status: 'running',
          progress: 0,
          currentStep: '规划后续卷章',
          startedAt,
          updatedAt: startedAt,
        });

        try {
          const { outline, tokens } = await generateOutlineInVolumes({
            apiSettings,
            novel,
            nextChapterIndex: nextIndex,
            analysis: novel.novelStoryAnalysis ?? null,
            targetChapterCount: outlineOptions.targetChapterCount ?? 12,
            ...outlineRequest,
            onProgress: (completedChapters, totalChapters, currentVolume) => {
              useTavernStore.getState().upsertNovelGenerationJob(novelId, {
                jobId,
                kind: 'outline',
                mode: 'continue',
                status: 'running',
                progress: totalChapters > 0 ? completedChapters / totalChapters : 0,
                currentStep: `第${currentVolume}卷：已完成 ${completedChapters}/${totalChapters} 章`,
                updatedAt: nowIso(),
              });
            },
          });

          useTavernStore.getState().recordNovelContinuationUsage(novelId, 'outline', tokens);
          const proposalId = useTavernStore.getState().saveNovelOutlineProposal(novelId, {
            scopeId: 'novel',
            operation: novel.outline ? 'revise' : 'create',
            prompt: outlineOptions.userBrief ?? '根据当前项目设定生成全书大纲',
            candidateOutline: outline,
            tokens,
          });

          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'outline',
            mode: 'continue',
            status: 'completed',
            progress: 1,
            currentStep: proposalId ? '大纲提案已生成，等待确认' : '大纲提案生成失败',
            completedAt: nowIso(),
            updatedAt: nowIso(),
          });
        } catch (error) {
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'outline',
            mode: 'continue',
            status: 'failed',
            lastError: error instanceof Error ? error.message : '大纲生成失败',
            updatedAt: nowIso(),
          });
          throw error;
        }
      },
      generateNovelOutlineForPlan: async (novelId, planId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const plan = (novel.novelContinuationPlans ?? []).find(
          (item) => item.planId === planId && item.status === 'active',
        );
        if (!plan) {
          throw new Error('该路线已失效，请重新推演并选择路线。');
        }

        const forecast = (novel.novelForecasts ?? []).find(
          (item) => item.forecastId === plan.forecastId,
        );
        const route = forecast?.routes.find((item) => item.routeId === plan.routeId) ?? null;

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'outline',
        });
        const nextIndex = getNextChapterIndex(novel);
        const outlineOptions = resolveNovelOutlineOptions(novel, options);

        const jobId = makeId('job-outline');
        const startedAt = nowIso();
        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'outline',
          mode: 'continue',
          status: 'running',
          progress: 0,
          currentStep: `依据《${route?.title ?? '所选路线'}》规划大纲`,
          startedAt,
          updatedAt: startedAt,
        });

        try {
          const { outline, tokens } = await generateOutline({
            apiSettings,
            novel,
            nextChapterIndex: nextIndex,
            route,
            analysis: novel.novelStoryAnalysis ?? null,
            ...outlineOptions,
          });

          useTavernStore.getState().recordNovelContinuationUsage(novelId, 'outline', tokens);

          // 合并到现有大纲：追加为新卷（保留既有卷章），编号已从下一章开始连续。
          const existing = novel.outline;
          const merged: NovelOutline = existing
            ? {
                ...existing,
                summary: existing.summary || outline.summary,
                volumes: [...existing.volumes, ...outline.volumes],
                updatedAt: new Date().toISOString(),
              }
            : outline;
          const proposalId = useTavernStore.getState().saveNovelOutlineProposal(novelId, {
            scopeId: 'novel',
            operation: 'append',
            prompt: outlineOptions.userBrief ?? `依据路线《${route?.title ?? '所选路线'}》追加大纲`,
            candidateOutline: merged,
            appendVolumes: true,
            tokens,
          });

          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'outline',
            mode: 'continue',
            status: 'completed',
            progress: 1,
            currentStep: proposalId ? '追加大纲提案已生成，等待确认' : '追加大纲提案生成失败',
            completedAt: nowIso(),
            updatedAt: nowIso(),
          });
        } catch (error) {
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'outline',
            mode: 'continue',
            status: 'failed',
            lastError: error instanceof Error ? error.message : '大纲生成失败',
            updatedAt: nowIso(),
          });
          throw error;
        }
      },
      analyzeNovelStoryState: async (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const finalChapters = getFinalChapters(novel);

        // 历史 bug 自愈：检测到章节编号错位（32 章被记到 62 章）时，
        // 清空受污染的章号敏感数据（保留角色档案增强），触发全量重新分析。
        let existingAnalysis = novel.novelStoryAnalysis ?? null;
        // 人物去重：清掉历史 bug 遗留的「同一人物多 id 重复记录」（如一人记 5 次）。
        if (existingAnalysis) {
          const deduped = dedupeCharactersInAnalysis(existingAnalysis);
          if (deduped !== existingAnalysis) {
            existingAnalysis = deduped;
            set((s) => ({
              novels: s.novels.map((item) =>
                item.id === novelId
                  ? { ...item, novelStoryAnalysis: deduped, updatedAt: nowIso() }
                  : item,
              ),
            }));
          }
        }
        const misaligned = detectMisalignedStoryAnalysis(existingAnalysis, finalChapters.length);

        let baseAnalysis = existingAnalysis;
        if (misaligned && existingAnalysis) {
          const reset = resetMisalignedStoryAnalysis(existingAnalysis);
          baseAnalysis = reset;
          set((s) => ({
            novels: s.novels.map((item) =>
              item.id === novelId
                ? { ...item, novelStoryAnalysis: reset, updatedAt: nowIso() }
                : item,
            ),
          }));
          console.warn(
            `[续写] ${novel.name} 检测到章节编号错位的历史分析数据（${existingAnalysis.chapterSummaries.length} 条摘要，正史 ${finalChapters.length} 章），已自动重置，需重新运行状态分析。`,
          );
        }

        // 指纹未变化且已完整分析且无错位 → 直接复用缓存，不触发模型调用。
        if (!misaligned && isStoryAnalysisFresh(existingAnalysis, finalChapters)) {
          options?.onComplete?.(false, false);
          return { ran: false, paused: false };
        }

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'analysis',
        });
        const completion = buildStoreCompletion(apiSettings);

        const lockOwner = acquireNovelWriteLock(novelId, 'analyze');
        if (!lockOwner) {
          // 若已有同类型的分析任务正在后台运行（例如切页后组件重挂载再次触发），
          // 静默视为已运行，避免 UI 误报「失败 / 点不了」。
          const alreadyRunning = useTavernStore
            .getState()
            .novels.find((item) => item.id === novelId)
            ?.novelGenerationJobs?.some((job) => job.kind === 'analyze' && job.status === 'running');
          if (alreadyRunning) {
            options?.onComplete?.(false, false);
            return { ran: false, paused: false };
          }
          throw new Error('该小说正在执行其他状态任务，请稍后再试。');
        }

        const jobId = makeId('job-analyze');
        const startedAt = nowIso();

        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'analyze',
          mode: 'continue',
          status: 'running',
          progress: 0,
          currentStep: '准备分析',
          startedAt,
          updatedAt: startedAt,
        });

        try {
          const result = await analyzeStoryStateIncrementally({
            novelName: novel.name,
            chapters: finalChapters.map((chapter) => ({
              index: chapter.index,
              title: chapter.title,
              content: chapter.content,
            })),
            existingAnalysis: baseAnalysis,
            completion,
            onProgress: (progress, chapter, status) => {
              useTavernStore.getState().upsertNovelGenerationJob(novelId, {
                jobId,
                kind: 'analyze',
                mode: 'continue',
                status: 'running',
                progress,
                currentStep: `${status}至第${chapter}章`,
                updatedAt: nowIso(),
              });
              options?.onProgress?.(progress, chapter, status);
            },
            // 断点落盘：每批校验通过后立即保存，中途失败重试时从断点继续，而不是从头再来。
            // 落盘前做人物去重归一化，杜绝「同人不同 id」在批次间积累重复。
            onCheckpoint: (analysis) => {
              const deduped = dedupeCharactersInAnalysis(analysis);
              set((s) => ({
                novels: s.novels.map((item) =>
                  item.id === novelId
                    ? { ...item, novelStoryAnalysis: deduped, updatedAt: nowIso() }
                    : item,
                ),
              }));
            },
            shouldCancel: () => false,
          });

          const timestamp = nowIso();
          const finalAnalysis = dedupeCharactersInAnalysis(result.analysis);
          set((s) => ({
            novels: s.novels.map((item) =>
              item.id === novelId
                ? { ...item, novelStoryAnalysis: finalAnalysis, updatedAt: timestamp }
                : item,
            ),
          }));

          // 分析完成（非暂停）后自动把角色/正史/关系同步到知识库三件套。
          if (result.ran && !result.paused) {
            try {
              useTavernStore.getState().syncNovelKnowledgeBase(novelId);
            } catch (error) {
              // 知识库同步失败不阻断分析任务；静默记录。
              console.warn('同步知识库失败', error);
            }
          }

          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'analyze',
            mode: 'continue',
            status: result.paused ? 'paused' : 'completed',
            progress: result.paused ? result.analysis.manifest.progress : 1,
            currentStep: result.paused ? '已暂停，可在分析页继续' : '分析完成',
            completedAt: result.paused ? undefined : nowIso(),
            updatedAt: nowIso(),
          });

          options?.onComplete?.(result.ran, result.paused);
          return { ran: result.ran, paused: result.paused };
        } catch (error) {
          const message = error instanceof Error ? error.message : '状态分析失败';
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'analyze',
            mode: 'continue',
            status: 'failed',
            lastError: message,
            updatedAt: nowIso(),
          });
          throw error;
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      syncNovelKnowledgeBase: (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        if (!novel) {
          return { ...EMPTY_SYNC_REPORT };
        }
        const next = syncStoryAnalysisToKnowledgeBase(novel, {
          nsfwEnabled: true,
          refreshGenerated: options?.refreshGenerated,
        });
        const timestamp = nowIso();
        set((s) => ({
          novels: s.novels.map((item) =>
            item.id === novelId
              ? {
                  ...item,
                  cast: next.cast,
                  characterDossiers: next.characterDossiers,
                  loreEntries: next.loreEntries,
                  relationGraphs: [],
                  updatedAt: timestamp,
                }
              : item,
          ),
        }));
        return {
          ...next.report,
          addedNodes: 0,
          addedEdges: 0,
          skippedEdges: 0,
          hasMainGraph: false,
        };
      },
      enrichNovelCharacters: async (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }
        const analysis = novel.novelStoryAnalysis ?? null;
        if (!analysis || analysis.characters.length === 0) {
          throw new Error('请先完成状态分析，再增强角色档案。');
        }

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'character',
        });
        const completion = buildStoreCompletion(apiSettings);

        const lockOwner = acquireNovelWriteLock(novelId, 'enrich');
        if (!lockOwner) {
          const alreadyRunning = useTavernStore
            .getState()
            .novels.find((item) => item.id === novelId)
            ?.novelGenerationJobs?.some((job) => job.kind === 'enrich' && job.status === 'running');
          if (alreadyRunning) {
            return { enriched: 0 };
          }
          throw new Error('该小说正在执行其他状态任务，请稍后再试。');
        }

        const jobId = makeId('job-enrich');
        const startedAt = nowIso();
        const nsfwEnabled = true;

        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'enrich',
          mode: 'continue',
          status: 'running',
          progress: 0,
          currentStep: '准备检索',
          startedAt,
          updatedAt: startedAt,
        });

        try {
          await Promise.all(getFinalChapters(novel).map((chapter) =>
            useTavernStore.getState().hydrateNovelChapterContent(chapter.id),
          ));
          const hydratedNovel = useTavernStore.getState().novels.find((item) => item.id === novelId) ?? novel;
          const finalChapters = getFinalChapters(hydratedNovel);
          if (finalChapters.some((chapter) => chapter.contentStatus === 'loading' || chapter.contentStatus === 'error')) {
            throw new Error('正文尚未加载完成，请稍后再试。');
          }
          const result = await enrichCharactersFromText({
            completion,
            novelName: novel.name,
            chapters: finalChapters.map((chapter) => ({
              index: chapter.index,
              content: chapter.content,
            })),
            characters: analysis.characters,
            nsfwEnabled,
          });

          // 幂等合并：按 id 覆盖非空字段，用户种子（sfwSeed/nsfwSeed）始终保留。
          const enrichedById = new Map(
            result.characters.map((character) => [character.id, character]),
          );
          const nextCharacters = analysis.characters.map((character) => {
            if (character.lockedByUser || character.locked) return character;
            const delta = enrichedById.get(character.id);
            if (!delta) {
              return character;
            }
            const merged: typeof character = { ...character };
            for (const field of [
              'appearance',
              'personality',
              'speechStyle',
              'background',
              'motivation',
              'affiliation',
            ] as const) {
              const value = delta[field];
              if (typeof value === 'string' && value.trim()) {
                merged[field] = value;
              }
            }
            if (Array.isArray(delta.evidence) && delta.evidence.length > 0) {
              merged.evidence = delta.evidence;
            }
            if (delta.privacy && nsfwEnabled) {
              merged.privacy = delta.privacy;
            }
            return merged;
          });

          if (result.characters.length > 0) {
            const timestamp = nowIso();
            set((s) => ({
              novels: s.novels.map((item) =>
                item.id === novelId
                  ? {
                      ...item,
                      novelStoryAnalysis: {
                        ...item.novelStoryAnalysis!,
                        characters: nextCharacters,
                        manifest: {
                          ...item.novelStoryAnalysis!.manifest,
                          updatedAt: timestamp,
                        },
                      },
                      updatedAt: timestamp,
                    }
                  : item,
              ),
            }));
          }

          if (result.promptTokens + result.completionTokens > 0) {
            useTavernStore
              .getState()
              .recordNovelContinuationUsage(novelId, 'enrich', result.promptTokens + result.completionTokens);
          }

          // 增强后刷新知识库角色卡（仅自动生成的卡；用户编辑过的卡不动）。
          try {
            useTavernStore.getState().syncNovelKnowledgeBase(novelId);
          } catch {
            // 知识库同步失败不阻断增强任务。
          }

          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'enrich',
            mode: 'continue',
            status: 'completed',
            progress: 1,
            currentStep: '增强完成',
            completedAt: nowIso(),
            updatedAt: nowIso(),
          });

          options?.onProgress?.('完成');
          return { enriched: result.characters.length };
        } catch (error) {
          const message = error instanceof Error ? error.message : '角色档案增强失败';
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'enrich',
            mode: 'continue',
            status: 'failed',
            lastError: message,
            updatedAt: nowIso(),
          });
          throw error;
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      updateNovelCharacterSeeds: (novelId, characterId, seeds) => {
        const timestamp = nowIso();
        set((s) => ({
          novels: s.novels.map((item) => {
            if (item.id !== novelId || !item.novelStoryAnalysis) {
              return item;
            }
            return {
              ...item,
              novelStoryAnalysis: {
                ...item.novelStoryAnalysis,
                characters: item.novelStoryAnalysis.characters.map((character) =>
                  character.id === characterId
                    ? {
                        ...character,
                        ...(seeds.sfwSeed !== undefined ? { sfwSeed: seeds.sfwSeed } : {}),
                        ...(seeds.nsfwSeed !== undefined ? { nsfwSeed: seeds.nsfwSeed } : {}),
                      }
                    : character,
                ),
                manifest: { ...item.novelStoryAnalysis.manifest, updatedAt: timestamp },
              },
              updatedAt: timestamp,
            };
          }),
        }));
      },
      createNovelForecast: async (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'outline',
        });
        const completion = buildStoreCompletion(apiSettings);

        const lockOwner = acquireNovelWriteLock(novelId, 'forecast');
        if (!lockOwner) {
          // 若已有推演任务正在后台运行，返回空 id（调用方忽略），避免切页回来后误报「失败」。
          const alreadyRunning = useTavernStore
            .getState()
            .novels.find((item) => item.id === novelId)
            ?.novelGenerationJobs?.some((job) => job.kind === 'forecast' && job.status === 'running');
          if (alreadyRunning) {
            return '';
          }
          throw new Error('该小说正在执行其他状态任务，请稍后再试。');
        }

        const finalChapters = getFinalChapters(novel);
        const analysis = novel.novelStoryAnalysis ?? null;
        const divergenceChapter =
          options.divergenceChapter > 0
            ? options.divergenceChapter
            : finalChapters.length;

        if (finalChapters.length === 0) {
          releaseNovelWriteLock(novelId, lockOwner);
          throw new Error('小说还没有正式章节，无法推演路线。');
        }

        const jobId = makeId('job-forecast');
        const startedAt = nowIso();

        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'forecast',
          mode: options.mode,
          status: 'running',
          progress: 0,
          currentStep: '读取正史与用户要求',
          startedAt,
          updatedAt: startedAt,
        });

        try {
          const fingerprint = computeStoryFingerprint(finalChapters);
          const forecasts = await generateForecastRoutes({
            novelName: novel.name,
            mode: options.mode,
            divergenceChapter,
            stateVersion: analysis?.stateVersion ?? 0,
            fingerprint,
            analysis,
            recentChapters: finalChapters.slice(-3),
            userGuide: options.userGuide,
            completion,
          });
          const forecast = forecasts[0];

          const timestamp = nowIso();
          set((s) => ({
            novels: s.novels.map((item) =>
              item.id === novelId
                ? {
                    ...item,
                    novelForecasts: [forecast, ...(item.novelForecasts ?? [])].slice(0, 20),
                    updatedAt: timestamp,
                  }
                : item,
            ),
          }));

          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'forecast',
            mode: options.mode,
            status: 'completed',
            progress: 1,
            currentStep: '路线推演完成',
            completedAt: nowIso(),
            updatedAt: nowIso(),
          });

          return forecast.forecastId;
        } catch (error) {
          const message = error instanceof Error ? error.message : '路线推演失败';
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'forecast',
            mode: options.mode,
            status: 'failed',
            lastError: message,
            updatedAt: nowIso(),
          });
          throw error;
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      selectNovelForecastRoute: (novelId, forecastId, routeId) => {
        const timestamp = nowIso();
        set((s) => {
          const novel = s.novels.find((item) => item.id === novelId);
          const forecast = novel?.novelForecasts?.find((item) => item.forecastId === forecastId);
          if (!forecast) {
            return s;
          }
          const plan: NovelContinuationPlan = {
            planId: makeId('plan'),
            forecastId,
            routeId,
            mode: forecast.mode,
            stateVersion: forecast.stateVersion,
            status: 'active',
            createdAt: timestamp,
          };
          return {
            novels: s.novels.map((item) =>
              item.id === novelId
                ? {
                    ...item,
                    novelContinuationPlans: [plan, ...(item.novelContinuationPlans ?? [])].slice(0, 20),
                    updatedAt: timestamp,
                  }
                : item,
            ),
          };
        });
      },
      rewriteNovelNextChapter: async (novelId, options) => {
        if (isNovelMutationActive(novelId)) throw new Error('当前作品正在保存，请稍后再生成。');
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }

        const settings = resolveContinuationSettings(novel);
        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, { task: 'writing' });

        if (!apiSettings.apiKey.trim()) {
          throw new Error('当前模型未配置 API Key，请先在系统设置中完善模型配置。');
        }

        const resumeJob = options?.resumeJobId
          ? (novel.novelGenerationJobs ?? []).find((item) => item.jobId === options.resumeJobId)
          : undefined;
        if (options?.resumeJobId && (!resumeJob || resumeJob.kind !== 'write')) {
          throw new Error('只能恢复当前章节的写作任务。');
        }
        const effectivePlanId = options?.planId ?? resumeJob?.planId;
        const effectiveBranchId = options?.branchId ?? resumeJob?.branchId;
        const plan = effectivePlanId
          ? (novel.novelContinuationPlans ?? []).find((item) => item.planId === effectivePlanId) ?? null
          : (novel.novelContinuationPlans ?? [])[0] ?? null;
        const forecast = plan
          ? (novel.novelForecasts ?? []).find((item) => item.forecastId === plan.forecastId) ?? null
          : null;
        const initialFinalChapters = getFinalChapters(novel);
        const hydrationCount = settings.lookbackChapters === 0 ? initialFinalChapters.length : Math.max(1, settings.lookbackChapters);
        await Promise.all(initialFinalChapters.slice(-hydrationCount).map((chapter) =>
          useTavernStore.getState().hydrateNovelChapterContent(chapter.id),
        ));
        const hydratedNovel = useTavernStore.getState().novels.find((item) => item.id === novelId) ?? novel;
        const finalChapters = getFinalChapters(hydratedNovel);
        const branch = effectiveBranchId
          ? (novel.novelBranches ?? []).find((item) => item.branchId === effectiveBranchId) ?? null
          : null;

        // 分支模式：正文基线 = 分歧章前的正史 + 分支内已确认章节。
        const branchBase = branch
          ? finalChapters.slice(0, branch.divergenceChapter)
          : finalChapters;
        const branchChapters = branch ? (branch.chapters ?? []) : [];
        const baseChapters = [...branchBase, ...branchChapters];
        const lastChapter = baseChapters[baseChapters.length - 1] ?? null;
        const nextIndex = options?.targetChapterIndex ?? resumeJob?.chapterIndex ?? (lastChapter ? lastChapter.index + 1 : 1);

        // 幂等生成：先清理与 nextIndex 相同的旧草稿（「重新生成」/ 失败重试会留下重复章节，
        // 旧版无此清理导致章节列表无限膨胀）。
        const existingTargetDraft = (hydratedNovel.chapters ?? []).find(
          (chapter) => chapter.status === 'draft' && chapter.index === nextIndex,
        );
        const existingTargetFinal = (hydratedNovel.chapters ?? []).find(
          (chapter) => chapter.status === 'final' && chapter.index === nextIndex,
        );
        if (existingTargetFinal && !resumeJob) {
          throw new Error(`第${nextIndex}章已经定稿，不能重复写入。`);
        }
        if (existingTargetDraft && !resumeJob && existingTargetDraft.content.trim()) {
          throw new Error(`第${nextIndex}章已有未定稿草稿，请先处理后再重试。`);
        }
        if (!resumeJob) set((s) => ({
          novels: s.novels.map((item) =>
            item.id === novelId
              ? {
                  ...item,
                  chapters: (item.chapters ?? []).filter(
                    (chapter) => !(chapter.status === 'draft' && chapter.index === nextIndex),
                  ),
                  updatedAt: nowIso(),
                }
              : item,
          ),
        }));

        const userGuide = options?.userGuide ?? forecast?.userGuide ?? {
          endingPreference: '',
          targetLength: '',
          mustKeep: '',
          mustAvoid: '',
        };
        const rawInstruction = options?.userInstruction?.trim() ?? resumeJob?.userInstruction ?? '';
        const planning = normalizeChapterPlanning(options?.planning ?? resumeJob?.chapterPlanning);
        const outlineGoal = novel.outline?.volumes
          .flatMap((volume) => volume.chapters)
          .find((chapter) => chapter.index === nextIndex)?.goal ?? '';
        const instruction = buildChapterInstruction(rawInstruction || outlineGoal, planning);
        const targetWords = resolveChapterTargetWords(
          options?.targetWords ?? resumeJob?.targetWords ?? existingTargetDraft?.targetWords,
          rawInstruction || outlineGoal,
          settings.targetWords,
        );

        let activeProjectionFacts = hydratedNovel.novelStoryFacts ?? [];
        if (Platform.OS !== 'web') {
          const projectionDb = await getAppDatabase();
          activeProjectionFacts = (await listActiveStoryFacts(projectionDb, novelId, { limit: 1000 }))
            .map((fact) => ({
              id: fact.id,
              factType: fact.factType,
              subjectId: fact.subjectId,
              contentJson: fact.contentJson,
              sourceEventId: fact.sourceEventId,
              stateVersion: fact.stateVersion,
              confidence: fact.confidence,
              locked: fact.locked === 1,
              stale: fact.stale === 1,
            }));
        }
        const missionBundle = buildChapterMission({
          novelId,
          chapterIndex: nextIndex,
          canonRevision: novel.canonRevision ?? 0,
          goal: instruction || outlineGoal || lastChapter?.goal || '',
          sceneHint: lastChapter?.content.slice(-1200) ?? '',
          userInstruction: instruction,
          analysis: novel.novelStoryAnalysis ?? null,
          storyFacts: activeProjectionFacts,
          now: nowIso(),
          budgetTokens: resolveContextTokenBudget(apiSettings),
        });
        if (Platform.OS !== 'web') {
          const missionDb = await getAppDatabase();
          await saveChapterMission(missionDb, missionBundle);
        }
        if (!missionBundle.feasibility.feasible) {
          throw new Error(`本章任务约束不可行：${missionBundle.feasibility.conflicts.join('；')}`);
        }

        // Request a complete chapter once. A short result pauses for an
        // explicit same-chapter supplement; legacy checkpoints remain usable.
        const segments = (resumeJob?.segmentIndex ?? 0) + 1;

        const context = buildRewriteContext({
          novelName: novel.name,
          novelSystemPrompt: hydratedNovel.systemPrompt,
          chapterIndex: nextIndex,
          characterContext: buildNovelCharacterContext(hydratedNovel, `第${nextIndex}章\n${instruction || outlineGoal}`, lastChapter?.content.slice(-1200) ?? ''),
          analysis: novel.novelStoryAnalysis ?? null,
          storyFacts: activeProjectionFacts,
          mission: missionBundle.mission,
          characterRedLines: missionBundle.redLines,
          hookTasks: missionBundle.hookTasks,
          plan,
          forecast,
          lastChapter,
          recentChapters: settings.lookbackChapters === 0
            ? baseChapters
            : baseChapters.slice(-settings.lookbackChapters),
          userGuide,
          targetWords,
          maxContextChars: settings.maxContextChars,
          apiSettings,
        });
        if (Platform.OS !== 'web') {
          const missionDb = await getAppDatabase();
          await markChapterMissionUsed(missionDb, missionBundle.mission.missionId, nowIso());
        }

        const existingDraft = resumeJob?.chapterId
          ? (hydratedNovel.chapters ?? []).find((item) => item.id === resumeJob.chapterId)
          : undefined;
        const draft: NovelChapter = existingDraft ?? {
          id: makeId('chapter'),
          index: nextIndex,
          title: `第${nextIndex}章`,
          summary: '',
          goal: rawInstruction || outlineGoal,
          planning,
          targetWords,
          content: '',
          status: 'draft',
          aiGenerated: true,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        if (!existingDraft) useTavernStore.getState().addNovelChapter(novelId, draft);
        else if (existingDraft.targetWords !== targetWords) useTavernStore.getState().updateNovelChapter(novelId, draft.id, { targetWords });

        const jobId = resumeJob?.jobId ?? makeId('job-write');
        const startedAt = resumeJob?.startedAt ?? nowIso();
        useTavernStore.getState().upsertNovelGenerationJob(novelId, {
          jobId,
          kind: 'write',
          mode: effectiveBranchId ? 'ending' : (plan?.mode ?? 'continue'),
          status: 'running',
          progress: (resumeJob?.segmentIndex ?? 0) / segments,
          currentStep: resumeJob ? `补写第${nextIndex}章` : `起草第${nextIndex}章`,
          startedAt,
          updatedAt: startedAt,
          chapterIndex: nextIndex,
          ...(options?.targetChapterIndex !== undefined ? { targetChapterIndex: options.targetChapterIndex } : {}),
          chapterId: draft.id,
          segmentIndex: resumeJob?.segmentIndex ?? 0,
          totalSegments: segments,
          promptFingerprint: simpleFingerprint(`${context.systemPrompt}\n${context.userPrompt}\n${instruction}`),
          accumulatedContent: resumeJob?.accumulatedContent ?? existingDraft?.content ?? '',
          retryCount: resumeJob?.retryCount ?? 0,
          contextTokens: context.contextPack.contextManifest.estimatedTokens,
          userInstruction: rawInstruction,
          chapterPlanning: planning,
          targetWords,
          planId: effectivePlanId,
          branchId: effectiveBranchId,
        });

        let accumulated = resumeJob?.accumulatedContent ?? existingDraft?.content ?? '';
        let streamedSegment = '';
        let checkpointChars = 0;
        let lastCheckpointAt = Date.now();
        beginNovelStream(novelId, draft.id, accumulated);
        const completion = buildStoreCompletion(apiSettings, (delta) => {
          appendNovelStreamDelta(novelId, draft.id, delta);
          streamedSegment += delta;
          checkpointChars += delta.length;
          options?.onDelta?.(delta);
          if (checkpointChars >= 600 || Date.now() - lastCheckpointAt >= 1500) {
            const partial = `${accumulated}${accumulated && streamedSegment ? '\n\n' : ''}${streamedSegment}`;
            useTavernStore.getState().updateNovelChapter(novelId, draft.id, { content: partial });
            useTavernStore.getState().upsertNovelGenerationJob(novelId, {
              jobId, kind: 'write', mode: effectiveBranchId ? 'ending' : (plan?.mode ?? 'continue'),
              status: 'running', accumulatedContent: partial, updatedAt: nowIso(),
              retryCount: resumeJob?.retryCount ?? 0,
            });
            checkpointChars = 0;
            lastCheckpointAt = Date.now();
          }
        });
        let latestTokens: { promptTokens?: number; completionTokens?: number; modelId?: string } = {};
        let completedSegments = resumeJob?.segmentIndex ?? 0;

        try {
          for (let segment = (resumeJob?.segmentIndex ?? 0) + 1; segment <= segments; segment += 1) {
            streamedSegment = '';
            checkpointChars = 0;
            const segmentWords = Math.max(200, targetWords - countChapterWords(accumulated));

            let messages: { role: 'system' | 'user'; content: string }[];
            if (segment === 1 && !accumulated.trim()) {
              messages = [
                { role: 'system', content: context.systemPrompt },
                {
                  role: 'user',
                  content: `${context.userPrompt}${instruction ? `\n\n【本章补充要求】${instruction}` : ''}\n\n请生成完整本章，目标约 ${targetWords} 字，最低 ${Math.ceil(targetWords * 0.9)} 字。`,
                },
              ];
            } else {
              messages = [
                { role: 'system', content: context.systemPrompt },
                {
                  role: 'user',
                  content: `以下是本章已写正文：\n\n${accumulated}\n\n【补写当前章】本章总目标 ${targetWords} 字，目前已有 ${countChapterWords(accumulated)} 字。遵循小说主提示词和作者要求的格式，承接已有情节补足当前章，不要重复已写内容或开始下一章，本次目标约 ${segmentWords} 字，并为本章自然收束。${instruction ? `\n\n【本章补充要求】${instruction}` : ''}`,
                },
              ];
            }

            const result = await completion(messages, 'rewrite-write');
            streamedSegment = '';
            checkpointChars = 0;
            latestTokens = {
              modelId: result.modelId,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
            };

            accumulated = `${accumulated}${accumulated ? '\n\n' : ''}${result.content.trim()}`;
            completedSegments = segment;
            useTavernStore.getState().updateNovelChapter(novelId, draft.id, {
              content: accumulated,
            });
            useTavernStore
              .getState()
              .recordNovelContinuationUsage(novelId, 'rewrite-write', result.completionTokens ?? 0);

            useTavernStore.getState().upsertNovelGenerationJob(novelId, {
              jobId,
              kind: 'write',
              mode: effectiveBranchId ? 'ending' : (plan?.mode ?? 'continue'),
              status: 'running',
              progress: segment / segments,
              currentStep: `检查第${nextIndex}章字数`,
              updatedAt: nowIso(),
              chapterIndex: nextIndex,
              chapterId: draft.id,
              segmentIndex: segment,
              totalSegments: segments,
              promptFingerprint: simpleFingerprint(`${context.systemPrompt}\n${context.userPrompt}\n${instruction}`),
              accumulatedContent: accumulated,
              retryCount: 0,
              contextTokens: context.contextPack.contextManifest.estimatedTokens,
            });
          }

          assertChapterLength(accumulated, targetWords);
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'write',
            mode: effectiveBranchId ? 'ending' : (plan?.mode ?? 'continue'),
            status: 'completed',
            progress: 1,
            currentStep: `第${nextIndex}章草稿完成 · ${countChapterWords(accumulated)}/${targetWords} 字`,
            completedAt: nowIso(),
            updatedAt: nowIso(),
            modelId: latestTokens.modelId,
            promptTokens: latestTokens.promptTokens,
            completionTokens: latestTokens.completionTokens,
            chapterIndex: nextIndex,
            chapterId: draft.id,
            segmentIndex: segments,
            totalSegments: segments,
            promptFingerprint: simpleFingerprint(`${context.systemPrompt}\n${context.userPrompt}\n${instruction}`),
            accumulatedContent: accumulated,
            retryCount: 0,
            contextTokens: context.contextPack.contextManifest.estimatedTokens,
            durationMs: Date.now() - Date.parse(startedAt),
          });
          clearNovelStream(novelId, draft.id);

          return draft.id;
        } catch (error) {
          accumulated = `${accumulated}${accumulated && streamedSegment ? '\n\n' : ''}${streamedSegment}`;
          // 生成失败：已写出部分正文则保留草稿供参考；空草稿（首段即失败）直接删除。
          if (accumulated.trim()) {
            useTavernStore.getState().updateNovelChapter(novelId, draft.id, {
              content: accumulated,
            });
          } else {
            useTavernStore.getState().deleteNovelChapter(novelId, draft.id);
          }
          useTavernStore.getState().upsertNovelGenerationJob(novelId, {
            jobId,
            kind: 'write',
            mode: effectiveBranchId ? 'ending' : (plan?.mode ?? 'continue'),
            status: 'paused',
            progress: Math.min(0.99, countChapterWords(accumulated) / targetWords),
            currentStep: checkChapterLength(accumulated, targetWords).passed ? '生成中断，可恢复' : '字数不足，待补写',
            lastError: error instanceof Error ? error.message : '生成中断',
            updatedAt: nowIso(),
            chapterIndex: nextIndex,
            chapterId: draft.id,
            totalSegments: segments,
            accumulatedContent: accumulated,
            segmentIndex: completedSegments,
            retryCount: (resumeJob?.retryCount ?? 0) + 1,
          });
          clearNovelStream(novelId, draft.id);
          throw error;
        }
      },
      resumeNovelGenerationJob: async (novelId, jobId) => {
        const job = get().novels.find((item) => item.id === novelId)
          ?.novelGenerationJobs?.find((item) => item.jobId === jobId);
        if (!job) throw new Error('任务不存在。');
        if (job.status !== 'paused' && job.status !== 'failed') throw new Error('只有暂停或失败的任务可以恢复。');
        if (job.kind !== 'write') {
          if (job.kind === 'batch') get().abandonNovelGenerationJob(novelId, jobId);
          throw new Error(job.kind === 'batch' ? '批量写作已移除，请在章节页面逐章创作。' : '此任务不支持章节生成恢复。');
        }
        return get().rewriteNovelNextChapter(novelId, { resumeJobId: jobId });
      },
      abandonNovelGenerationJob: (novelId, jobId) => {
        const job = get().novels.find((item) => item.id === novelId)
          ?.novelGenerationJobs?.find((item) => item.jobId === jobId);
        if (!job) return;
        get().upsertNovelGenerationJob(novelId, {
          jobId, kind: job.kind, mode: job.mode, status: 'cancelled',
          currentStep: '用户已放弃任务（已生成草稿仍保留）', updatedAt: nowIso(), completedAt: nowIso(),
        });
      },
      retryNovelGenerationJob: async (novelId, jobId) => {
        const job = get().novels.find((item) => item.id === novelId)
          ?.novelGenerationJobs?.find((item) => item.jobId === jobId);
        if (!job) throw new Error('任务不存在。');
        if (job.status !== 'paused' && job.status !== 'failed') throw new Error('只有暂停或失败的任务可以重试。');
        if (job.kind !== 'write') {
          if (job.kind === 'batch') get().abandonNovelGenerationJob(novelId, jobId);
          throw new Error(job.kind === 'batch' ? '批量写作已移除，请在章节页面逐章创作。' : '此任务不支持章节生成恢复。');
        }
        const retryDraft = job.chapterId
          ? get().novels.find((item) => item.id === novelId)?.chapters?.find((item) => item.id === job.chapterId)
          : undefined;
        if (retryDraft?.content.trim()) {
          throw new Error(`第${retryDraft.index}章已有未定稿草稿，请先处理后再重试。`);
        }
        if (job.chapterId) get().deleteNovelChapter(novelId, job.chapterId);
        get().abandonNovelGenerationJob(novelId, jobId);
        return get().rewriteNovelNextChapter(novelId, {
          planId: job.planId, branchId: job.branchId, userInstruction: job.userInstruction,
          planning: job.chapterPlanning, targetChapterIndex: job.targetChapterIndex, targetWords: job.targetWords,
        });
      },
      auditRewriteChapter: async (novelId, chapterId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }
        const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);
        if (!chapter) {
          throw new Error('章节不存在。');
        }
        const sourceFingerprint = getNovelAuditSourceFingerprint(novel, chapter);

        const plan = (novel.novelContinuationPlans ?? [])[0] ?? null;
        const forecast = plan
          ? (novel.novelForecasts ?? []).find((item) => item.forecastId === plan.forecastId) ?? null
          : null;

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'review',
        });
        const completion = buildStoreCompletion(apiSettings);
        const result = await auditRewriteChapter({
          novelName: novel.name,
          novelSystemPrompt: novel.systemPrompt,
          chapter,
          characterContext: buildNovelCharacterContext(novel, `第${chapter.index}章\n${chapter.goal}`, chapter.content.slice(-1200)),
          analysis: novel.novelStoryAnalysis ?? null,
          plan,
          forecast,
          recentChapters: getFinalChapters(novel),
          userGuide: forecast?.userGuide ?? {
            endingPreference: '',
            targetLength: '',
            mustKeep: '',
            mustAvoid: '',
          },
          completion,
        });

        const audit: NovelRewriteAudit = {
          auditId: makeId('rewrite-audit'),
          chapterId,
          chapterIndex: chapter.index,
          issues: result.issues,
          score: result.score,
          passed: result.passed,
          createdAt: nowIso(),
          modelId: result.modelId,
          sourceFingerprint,
          stale: (() => {
            const latestNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
            const latestChapter = latestNovel?.chapters?.find((item) => item.id === chapterId);
            return !latestNovel || !latestChapter ||
              getNovelAuditSourceFingerprint(latestNovel, latestChapter) !== sourceFingerprint;
          })(),
        };

        useTavernStore
          .getState()
          .recordNovelContinuationUsage(novelId, 'rewrite-audit', result.tokens);

        set((s) => ({
          novels: s.novels.map((item) =>
            item.id === novelId
              ? {
                  ...item,
                  novelRewriteAudits: [audit, ...(item.novelRewriteAudits ?? [])].slice(0, 100),
                  updatedAt: nowIso(),
                }
              : item,
          ),
        }));
      },
      reviseNovelChapter: async (novelId, chapterId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }
        const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);
        if (!chapter || chapter.status !== 'draft') {
          throw new Error('只有草稿章节可以修订。');
        }
        const audit = (novel.novelRewriteAudits ?? []).find((item) =>
          isNovelRewriteAuditCurrent(item, chapterId, getNovelAuditSourceFingerprint(novel, chapter)),
        );
        if (!audit) {
          throw new Error('请先审查本章，再使用 AI 修订。');
        }

        const plan = (novel.novelContinuationPlans ?? [])[0] ?? null;
        const forecast = plan
          ? (novel.novelForecasts ?? []).find((item) => item.forecastId === plan.forecastId) ?? null
          : null;

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'review',
        });
        const completion = buildStoreCompletion(apiSettings);

        // 1) 修订（仅 local 问题；结构性默认跳过）。
        const revised = await reviseRewriteChapter({
          novelName: novel.name,
          novelSystemPrompt: novel.systemPrompt,
          chapter,
          audit,
          completion,
          allowStructural: options?.allowStructural,
        });

        // 2) 修订后重新审查，避免“修一个问题引入新问题”。
        const reAudit = await auditRewriteChapter({
          novelName: novel.name,
          novelSystemPrompt: novel.systemPrompt,
          chapter: { ...chapter, content: revised.content },
          characterContext: buildNovelCharacterContext(novel, `第${chapter.index}章\n${chapter.goal}`, revised.content.slice(-1200)),
          analysis: novel.novelStoryAnalysis ?? null,
          plan,
          forecast,
          recentChapters: getFinalChapters(novel),
          userGuide: forecast?.userGuide ?? {
            endingPreference: '',
            targetLength: '',
            mustKeep: '',
            mustAvoid: '',
          },
          completion,
        });

        // 3) 保留更好版本：修订版明确更优才采用，否则保留原稿。
        const adopted = shouldAdoptRevision({
          originalScore: audit.score,
          revisedScore: reAudit.score,
          originalPassed: audit.passed,
          revisedPassed: reAudit.passed,
        });
        const timestamp = nowIso();

        useTavernStore
          .getState()
          .recordNovelContinuationUsage(novelId, 'rewrite-revise', revised.tokens + reAudit.tokens);
        const latestNovel = get().novels.find((item) => item.id === novelId);
        const latestChapter = latestNovel?.chapters?.find((item) => item.id === chapterId);
        if (!latestChapter || (['updatedAt', 'status', 'title', 'content', 'summary', 'goal'] as const)
          .some((key) => latestChapter[key] !== chapter[key])) {
          throw new Error('修订期间章节已被修改或删除，本次结果未覆盖你的内容。请重新审查后再修订。');
        }
        if (!latestNovel || getNovelAuditSourceFingerprint(latestNovel, latestChapter) !== getNovelAuditSourceFingerprint(novel, chapter)) {
          throw new Error('修订期间作品设定或前文已变化，本次结果未覆盖原稿，请重新审查后再修订。');
        }
        if (!adopted) return { adopted: false, score: reAudit.score };

        get().backupNovelChapter(novelId, chapterId);
        await get().saveNovelChapter(novelId, { ...latestChapter, content: revised.content });
        const newAudit: NovelRewriteAudit = {
          auditId: makeId('rewrite-audit'),
          chapterId,
          chapterIndex: chapter.index,
          issues: reAudit.issues,
          score: reAudit.score,
          passed: reAudit.passed,
          createdAt: timestamp,
          modelId: reAudit.modelId,
          sourceFingerprint: getNovelAuditSourceFingerprint(
            get().novels.find((item) => item.id === novelId) ?? novel,
            { ...chapter, content: revised.content },
          ),
          stale: false,
        };

        set((s) => ({
          novels: s.novels.map((item) =>
            item.id === novelId
              ? {
                  ...item,
                  novelRewriteAudits: [newAudit, ...(item.novelRewriteAudits ?? [])].slice(0, 100),
                  updatedAt: timestamp,
                }
              : item,
          ),
        }));

        return { adopted, score: reAudit.score };
      },
      confirmNovelChapter: async (novelId, chapterId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);

        if (!novel) {
          throw new Error('小说不存在。');
        }
        const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);
        if (!chapter) {
          throw new Error('章节不存在。');
        }
        if (chapter.status !== 'draft') {
          throw new Error('只有草稿章节可以确认入库。');
        }
        // Never promote a short generated draft to canon, even after its job
        // was abandoned or an older quality audit had passed.
        assertChapterLength(chapter.content, chapter.targetWords);

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, {
          purpose: 'utility', task: 'analysis',
        });
        const completion = buildStoreCompletion(apiSettings);

        const lockOwner = acquireNovelWriteLock(novelId, 'confirm');
        if (!lockOwner) {
          throw new Error('该小说正在执行其他状态任务，请稍后再试。');
        }

        const analysis = novel.novelStoryAnalysis ?? {
          stateVersion: 0,
          lastAnalyzedChapter: 0,
          manifest: {
            schemaVersion: 1,
            status: 'idle',
            progress: 0,
            totalChapters: getFinalChapters(novel).length,
            updatedAt: nowIso(),
          },
          worldFacts: [],
          characters: [],
          characterStates: [],
          relationships: [],
          timeline: [],
          plotThreads: [],
          hooks: [],
          chapterSummaries: [],
          styleProfile: {
            pointOfView: '',
            sentenceLength: '',
            dialogueRatio: '',
            pacing: '',
            languageFeatures: '',
          },
          checkpoint: undefined,
        };

        try {
          // 1) 从最终正文提取状态增量（LLM + strict 校验）。失败则正文保留草稿，不继续。
          const delta = await extractChapterStateDelta({
            novelName: novel.name,
            chapter,
            analysis,
            completion,
          });
          let missionVerification: NovelMissionVerification | undefined;
          if (Platform.OS !== 'web') {
            const missionDb = await getAppDatabase();
            const storedMission = await loadLatestChapterMission(missionDb, novelId, chapter.index);
            if (storedMission) {
              try {
                missionVerification = verifyChapterMission({
                  mission: JSON.parse(storedMission.missionJson),
                  redLines: JSON.parse(storedMission.redLinesJson),
                  content: chapter.content,
                  delta,
                  now: nowIso(),
                });
              } catch {
                missionVerification = undefined;
              }
            }
          }

          // 硬门禁：任务验收未通过且非 override 时，不写正式稿，保留草稿并落审计问题。
          if (missionVerification && !missionVerification.passed && !options?.override) {
            await recordBlockedMissionVerification({
              novelId,
              chapterId,
              canonRevision: novel.canonRevision ?? 0,
              verification: missionVerification,
              createdAt: nowIso(),
            });
            return { committed: false, warnings: missionVerification.warnings };
          }

          // 2) 更新 StoryState：stateVersion+1。
          const nextAnalysis = applyChapterToStoryState({ analysis, chapter, delta });
          const timestamp = nowIso();
          const snapshotLabel = options?.snapshotLabel ?? `确认第${chapter.index}章`;
          const chapters = (novel.chapters ?? []).map((item) =>
            item.id === chapterId
              ? { ...item, status: 'final' as const, updatedAt: timestamp }
              : item,
          );
          const snapshot: NovelStorySnapshot = {
            snapshotId: makeId('snapshot'),
            label: snapshotLabel,
            stateVersion: nextAnalysis.stateVersion,
            chapters,
            analysis: nextAnalysis,
            createdAt: timestamp,
          };

          let canonRevision = novel.canonRevision ?? 0;
          let needsProjectionRebuild = false;
          const auditBoundaries = resolveNovelAuditBoundaries(chapter.index, novel.outline);
          if (Platform.OS !== 'web') {
            const contentHash = fingerprintChapterContent(chapter.title, chapter.content);
            const commit = await commitNovelChapter({
              novel,
              chapter,
              nextAnalysis,
              delta,
              snapshot,
              idempotencyKey: `${chapter.id}:confirm:${chapter.updatedAt}:${contentHash}`,
              expectedChapterUpdatedAt: chapter.updatedAt,
              createdAt: timestamp,
              missionVerification,
              auditBoundaries,
            });
            canonRevision = commit.canonRevision;
            needsProjectionRebuild = commit.needsProjectionRebuild;
          }
          const committedAnalysis: NovelStoryAnalysis = {
            ...nextAnalysis,
            ...(Platform.OS === 'web' ? {} : { canonRevision }),
          };
          const committedSnapshot: NovelStorySnapshot = {
            ...snapshot,
            ...(Platform.OS === 'web' ? {} : { canonRevision }),
            analysis: committedAnalysis,
          };

          // 3) Native SQLite has committed canon atomically. Zustand is now only
          // the UI projection; Web keeps the compatibility in-memory path.
          set((s) => {
            const target = s.novels.find((item) => item.id === novelId);
            if (!target) {
              return s;
            }
            return {
              novels: s.novels.map((item) =>
                item.id === novelId
                  ? {
                      ...item,
                      chapters,
                      canonRevision,
                      novelStoryAnalysis: committedAnalysis,
                      novelStorySnapshots: [committedSnapshot, ...(item.novelStorySnapshots ?? [])].slice(0, 20),
                      updatedAt: timestamp,
                    }
                  : item,
              ),
            };
          });
          if (needsProjectionRebuild) {
            void processProjectionRebuildJobs()
              .then(async () => {
                const projectionDb = await getAppDatabase();
                const facts = await listActiveStoryFacts(projectionDb, novelId, { limit: 1000 });
                set((state) => ({
                  novels: state.novels.map((item) => item.id === novelId ? {
                    ...item,
                    novelStoryFacts: facts.map((fact) => ({
                      id: fact.id,
                      factType: fact.factType,
                      subjectId: fact.subjectId,
                      contentJson: fact.contentJson,
                      sourceEventId: fact.sourceEventId,
                      stateVersion: fact.stateVersion,
                      confidence: fact.confidence,
                      locked: fact.locked === 1,
                      stale: fact.stale === 1,
                    })),
                  } : item),
                }));
              })
              .catch((error) => {
                console.error('[novel] shadow projection rebuild failed', error);
              });
          }
          if (Platform.OS !== 'web' && (auditBoundaries.scene || auditBoundaries.volume)) {
            void processConsistencyAuditJobs(completion).catch((error) => {
              console.error('[novel] consistency audit drain failed', error);
            });
          }

          return { committed: true, warnings: [] };
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      confirmBranchChapter: async (novelId, branchId, chapterId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        if (!novel) {
          throw new Error('小说不存在。');
        }
        const branch = (novel.novelBranches ?? []).find((item) => item.branchId === branchId);
        if (!branch) {
          throw new Error('分支不存在。');
        }
        const chapter = (novel.chapters ?? []).find((item) => item.id === chapterId);
        if (!chapter || chapter.status !== 'draft') {
          throw new Error('草稿章节不存在或已确认。');
        }
        assertChapterLength(chapter.content, chapter.targetWords);

        const lockOwner = acquireNovelWriteLock(novelId, 'confirm-branch');
        if (!lockOwner) {
          throw new Error('该小说正在执行其他状态任务，请稍后再试。');
        }

        try {
          const timestamp = nowIso();
          set((s) => {
            const target = s.novels.find((item) => item.id === novelId);
            if (!target) {
              return s;
            }
            const finalChapter: NovelChapter = { ...chapter, status: 'final', updatedAt: timestamp };
            return {
              novels: s.novels.map((item) =>
                item.id === novelId
                  ? {
                      ...item,
                      chapters: (item.chapters ?? []).filter((item) => item.id !== chapterId),
                      novelBranches: (item.novelBranches ?? []).map((branchItem) =>
                        branchItem.branchId === branchId
                          ? {
                              ...branchItem,
                              chapters: [...branchItem.chapters, finalChapter],
                              updatedAt: timestamp,
                            }
                          : branchItem,
                      ),
                      updatedAt: timestamp,
                    }
                  : item,
              ),
            };
          });
        } finally {
          releaseNovelWriteLock(novelId, lockOwner);
        }
      },
      upsertNovelGenerationJob: (novelId, job) => {
        const existing = useTavernStore.getState().novels
          .find((item) => item.id === novelId)?.novelGenerationJobs
          ?.find((item) => item.jobId === job.jobId);
        const fullJob: NovelGenerationJob = {
          ...existing,
          jobId: job.jobId,
          kind: job.kind,
          mode: job.mode,
          status: job.status ?? 'running',
          progress: job.progress ?? 0,
          currentStep: job.currentStep ?? '',
          startedAt: job.startedAt ?? nowIso(),
          updatedAt: job.updatedAt ?? nowIso(),
          ...(job.lastError ? { lastError: job.lastError } : {}),
          ...(job.resumeAt ? { resumeAt: job.resumeAt } : {}),
          ...(job.completedAt ? { completedAt: job.completedAt } : {}),
          ...(job.modelId ? { modelId: job.modelId } : {}),
          ...(job.promptTokens ? { promptTokens: job.promptTokens } : {}),
          ...(job.completionTokens ? { completionTokens: job.completionTokens } : {}),
          ...(job.durationMs ? { durationMs: job.durationMs } : {}),
          ...(job.chapterIndex !== undefined ? { chapterIndex: job.chapterIndex } : {}),
          ...(job.targetChapterIndex !== undefined ? { targetChapterIndex: job.targetChapterIndex } : {}),
          ...(job.targetWords !== undefined ? { targetWords: job.targetWords } : {}),
          ...(job.chapterId !== undefined ? { chapterId: job.chapterId } : {}),
          ...(job.segmentIndex !== undefined ? { segmentIndex: job.segmentIndex } : {}),
          ...(job.totalSegments !== undefined ? { totalSegments: job.totalSegments } : {}),
          ...(job.promptFingerprint !== undefined ? { promptFingerprint: job.promptFingerprint } : {}),
          ...(job.accumulatedContent !== undefined ? { accumulatedContent: job.accumulatedContent } : {}),
          ...(job.retryCount !== undefined ? { retryCount: job.retryCount } : {}),
          ...(job.contextTokens !== undefined ? { contextTokens: job.contextTokens } : {}),
          ...(job.userInstruction !== undefined ? { userInstruction: job.userInstruction } : {}),
          ...(job.chapterPlanning !== undefined ? { chapterPlanning: job.chapterPlanning } : {}),
          ...(job.planId !== undefined ? { planId: job.planId } : {}),
          ...(job.branchId !== undefined ? { branchId: job.branchId } : {}),
        };
        return set((s) => ({
          novels: s.novels.map((item) =>
            item.id === novelId
              ? {
                  ...item,
                  novelGenerationJobs: [
                    fullJob,
                    ...(item.novelGenerationJobs ?? []).filter((entry) => entry.jobId !== fullJob.jobId),
                  ].slice(0, 50),
                }
              : item,
          ),
        }));
      },
      updateNovelStoryMemories: async (novelId, updates) => {
        assertSessionStorageReady();
        const release = beginNovelMutation(novelId);
        if (!release) throw new Error('正在生成或保存，请完成后再修改记忆。');
        try {
          invalidateNovelPostTurn(novelId);
          await waitForNovelPostTurn(novelId);
          const state = get();
          const novel = state.novels.find((item) => item.id === novelId);
          if (!novel) throw new Error('小说不存在。');
          const base = state.novelConversationMeta[novelId] ?? createEmptyNovelConversation(novelId, novel.name, nowIso());
          const meta = { ...clearDerivedConversationMemory(base), ...updates,
            midTermMemories: updates.midTermMemories.map((item) => item.trim()).filter(Boolean),
            shortTermMemories: updates.shortTermMemories.map((item) => item.trim()).filter(Boolean),
            memoryStale: false, updatedAt: nowIso() };
          await saveWorkingSession(novel, await completeWorkingMessages(novelId, getNovelWorldId(novel)), meta);
        } finally { release(); }
      },
      updateNovelInjectionToggles: (novelId, toggles) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const novel = state.novels.find((item) => item.id === novelId);
          const base = normalizeNovelConversation(
            state.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel?.name ?? '未命名小说', timestamp),
          );

          return {
            novelConversationMeta: {
              ...state.novelConversationMeta,
              [novelId]: {
                ...base,
                injectionToggles: normalizeNovelInjectionToggles({
                  ...base.injectionToggles,
                  ...toggles,
                }),
                updatedAt: timestamp,
              },
            },
          };
        }),
      updateNovelMemorySystemToggle: (novelId, enabled) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const novel = state.novels.find((item) => item.id === novelId);
          const base = normalizeNovelConversation(
            state.novelConversationMeta[novelId] ??
              createEmptyNovelConversation(novelId, novel?.name ?? '未命名小说', timestamp),
          );

          return {
            novelConversationMeta: {
              ...state.novelConversationMeta,
              [novelId]: {
                ...base,
                memorySystemEnabled: enabled !== false,
                updatedAt: timestamp,
              },
            },
          };
        }),
      generateNovelSupportingCharacters: async (novelId, options) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        if (!novel) {
          throw new Error('小说不存在。');
        }

        const source = options?.source ?? 'current-reply';

        const activeWorld = getActiveQuickTravelWorld(novel);
        const activeWorldCast = activeWorld?.cast ?? novel.cast ?? [];

        const msgs = state.novelConversations[novelId] ?? [];
        // Find the latest assistant reply
        const lastAssistant = [...msgs]
          .reverse()
          .find((m) => m.role === 'assistant' && m.content.trim());
        if (!lastAssistant && source === 'current-reply') {
          throw new Error('没有找到最新的 AI 回复。');
        }

        const finalChapters = getFinalChapters(novel);
        const currentChapterLabel = state.novelConversationMeta[novelId]?.currentChapter?.trim() || '';
        const matchingChapter = currentChapterLabel
          ? finalChapters.find(
              (chapter) =>
                chapter.title.trim() === currentChapterLabel ||
                `第${chapter.index}章` === currentChapterLabel,
            )
          : undefined;
        const fallbackChapter = finalChapters[finalChapters.length - 1];
        const sourceSections =
          source === 'current-reply'
            ? lastAssistant
              ? [{ label: '当前回复', content: lastAssistant.content }]
              : []
            : source === 'current-chapter'
              ? [matchingChapter ?? fallbackChapter]
                  .filter(Boolean)
                  .map((chapter) => ({
                    label: `第${chapter.index}章 ${chapter.title}`.trim(),
                    content: chapter.content,
                  }))
              : finalChapters.map((chapter) => ({
                  label: `第${chapter.index}章 ${chapter.title}`.trim(),
                  content: chapter.content,
                }));

        if (sourceSections.length === 0) {
          if (lastAssistant) {
            sourceSections.push({ label: '当前回复', content: lastAssistant.content });
          } else {
            throw new Error('没有找到可导入的正文。');
          }
        }

        const apiSettings = resolveApiSettings(state.providers, state.generationSettings, { task: 'character' });
        const framework = {
          playerName: novel.playerName,
          playerPersona: novel.playerPersona ?? '',
          playerMotive: novel.playerMotive ?? '',
          playerGender: novel.playerGender ?? '',
          playerAge: novel.playerAge ?? '',
          playerProfession: novel.playerProfession ?? '',
          playerHeight: novel.playerHeight ?? '',
          playerWeight: novel.playerWeight ?? '',
          playerAppearance: novel.playerAppearance ?? '',
          playerPersonality: novel.playerPersonality ?? '',
          playerSpeechStyle: novel.playerSpeechStyle ?? '',
          playerBackground: novel.playerBackground ?? '',
          playerHabits: novel.playerHabits ?? '',
          playerStrengths: novel.playerStrengths ?? '',
          playerWeaknesses: novel.playerWeaknesses ?? '',
          playerSecrets: novel.playerSecrets ?? '',
          worldName: activeWorld?.name ?? novel.worldName ?? '',
          worldEra: activeWorld?.worldEra ?? novel.worldEra ?? '',
          worldConflict: novel.worldConflict ?? '',
          worldTone: novel.worldTone ?? '',
          mainPlot: novel.mainPlot ?? '',
          initialStoryState: novel.initialStoryState ?? '',
          gameRules: activeWorld?.worldRules ?? novel.gameRules ?? '',
        };

        const { generateSupportingCharacters } =
          await import('@/services/novel-create-ai');

        const analysis = novel.novelStoryAnalysis;
        const useAnalysisCandidates =
          source === 'all-text' &&
          analysis &&
          isStoryAnalysisFresh(analysis, finalChapters) &&
          analysis.characters.length > 0;
        const candidateHints = useAnalysisCandidates
          ? analysis.characters
              .filter(
                (character) =>
                  character.name.trim() &&
                  !/主角|主人公/.test(character.role || ''),
              )
              .map((character) => ({
                name: character.name.trim(),
                role: character.role.trim(),
                evidence: [
                  ...analysis.relationships
                    .filter((relation) =>
                      relation.fromCharacter === character.name || relation.toCharacter === character.name)
                    .map((relation) =>
                      `人物关系：${relation.fromCharacter} → ${relation.toCharacter} · ${relation.relation}${relation.description ? `（${relation.description}）` : ''}`),
                  ...(character.evidence ?? []),
                ].slice(0, 3),
                sourceLabel: character.evidence?.length ? '正文分析' : undefined,
              }))
          : undefined;

        const generated = await generateSupportingCharacters({
          apiSettings,
          novelCreateMaxTokens: state.generationSettings.novelCreateMaxTokens,
          novelName: novel.name,
          intro: novel.shortIntro || novel.detailedIntro || '',
          framework,
          existingCast: activeWorldCast,
          recentReplyContent: lastAssistant?.content ?? sourceSections[0]?.content ?? '',
          currentChapter: currentChapterLabel || undefined,
          nsfwEnabled: true,
          styleProfile: novel.novelStoryAnalysis?.styleProfile,
          worldContext: activeWorld ? buildQuickTravelContext(novel) : undefined,
          sourceSections,
          candidateHints,
          onUsage: (usage) => {
            if (usage.completionTokens > 0) {
              useTavernStore
                .getState()
                .recordNovelContinuationUsage(novelId, 'create-supporting', usage.completionTokens);
            }
          },
        });

        if (options?.previewOnly) {
          return generated;
        }

        // Add to novel cast（按姓名去重，避免重复提取同一角色造成空壳堆积）。
        set((s) => {
          const target = s.novels.find((item) => item.id === novelId);
          if (!target) {
            return s;
          }
          const existingCast = target.cast ?? [];
          const existingNames = new Set(
            existingCast.map((c) => c.name.trim().toLowerCase()).filter(Boolean),
          );
          const fresh = generated.filter(
            (c) => !existingNames.has(c.name.trim().toLowerCase()),
          );
          const timestamp = new Date().toISOString();

          const world = getActiveQuickTravelWorld(target);
          const worldCast = world
            ? [...(existingCast.filter((character) => character.isProtagonist)), ...fresh.filter((character) => !character.isProtagonist)]
            : existingCast;
          return {
            novels: s.novels.map((item) =>
              item.id === novelId
                ? {
                    ...item,
                    cast: [...existingCast, ...fresh],
                    quickTravel: item.quickTravel && world
                      ? {
                          ...item.quickTravel,
                          worlds: item.quickTravel.worlds.map((entry) =>
                            entry.id === world.id ? { ...entry, cast: worldCast, updatedAt: timestamp } : entry,
                          ),
                        }
                      : item.quickTravel,
                    updatedAt: timestamp,
                  }
                : item,
            ),
          };
        });

        return generated;
      },
      updateNovelCharacterCardAppearanceId: (novelId, appearanceId) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const nextId = normalizeCharacterCardAppearanceId(appearanceId);

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel({
                    ...novel,
                    characterCardAppearanceId: nextId,
                    updatedAt: timestamp,
                  })
                : novel,
            ),
          };
        }),
      updateNovelCharacterDossiers: (novelId, dossiers) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel({
                    ...novel,
                    characterDossiers: dossiers.map((item) => ({ ...item, stale: false })),
                    updatedAt: timestamp,
                  })
                : novel,
            ),
          };
        }),
      updateNovelLoreEntries: (novelId, entries) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel({
                    ...novel,
                    loreEntries: entries.map((item) => ({ ...item, stale: false })),
                    updatedAt: timestamp,
                  })
                : novel,
            ),
          };
        }),
      updateNovelLoreCollections: (novelId, collections) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            novels: state.novels.map((novel) =>
              novel.id === novelId
                ? normalizeNovel({
                    ...novel,
                    loreCollections: ensureNovelLoreCollections(collections),
                    updatedAt: timestamp,
                  })
                : novel,
            ),
          };
        }),
      updateNovelCastCharacters: (novelId, cast, _options) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const nextCastInput = Array.isArray(cast)
            ? cast
                .map((character) => detachCharacterBiographies(character).character)
            : [];

          return {
            novels: state.novels.map((novel) => {
              if (novel.id !== novelId) {
                return novel;
              }

              const nextDossiers = syncDossiersWithCast(
                nextCastInput,
                novel.characterDossiers ?? [],
                { refreshContentFromCast: true },
              );
              const activeWorld = getActiveQuickTravelWorld(novel);
              const worldCast = activeWorld
                ? [
                    ...nextCastInput.filter((character) => character.isProtagonist),
                    ...nextCastInput.filter((character) => !character.isProtagonist),
                  ]
                : null;

              return normalizeNovel({
                ...novel,
                cast: nextCastInput,
                quickTravel: novel.quickTravel && activeWorld
                  ? {
                      ...novel.quickTravel,
                      worlds: novel.quickTravel.worlds.map((world) =>
                        world.id === activeWorld.id ? { ...world, cast: worldCast ?? world.cast, updatedAt: timestamp } : world,
                      ),
                    }
                  : novel.quickTravel,
                characterDossiers: nextDossiers,
                relationGraphs: [],
                updatedAt: timestamp,
              });
            }),
          };
        }),
      inferNovelCharacterRelations: async (novelId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        if (!novel) {
          throw new Error('小说不存在。');
        }

        const activeWorld = getActiveQuickTravelWorld(novel);
        const cast = activeWorld?.cast ?? novel.cast ?? [];
        if (cast.filter((character) => character.name.trim()).length < 2) {
          throw new Error('至少需要两名已命名角色，才能整理人物关系。');
        }

        const result = await inferNovelCastRelations({
          apiSettings: resolveNovelAgentApiSettings(
            state.providers,
            state.generationSettings,
            'character',
          ),
          novel: {
            name: novel.name,
            worldName: novel.worldName,
            worldEra: novel.worldEra,
            worldConflict: novel.worldConflict,
            worldTone: novel.worldTone,
            mainPlot: novel.mainPlot,
            shortIntro: novel.shortIntro,
            detailedIntro: novel.detailedIntro,
            foundationPrompt: novel.foundationPrompt,
            initialStoryState: novel.initialStoryState,
            gameRules: novel.gameRules,
            cast,
          },
        });
        const applied = applyNovelRelationInference(cast, result.relations);
        if (result.tokens > 0) {
          useTavernStore.getState().recordNovelContinuationUsage(
            novelId,
            'character-agent',
            result.tokens,
          );
        }
        useTavernStore.getState().updateNovelCastCharacters(novelId, applied.cast);
        return applied.report;
      },
      deleteNovelKnowledgeCharacter: (novelId, dossierId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        if (!novel) {
          return false;
        }

        const dossiers = ensureNovelDossiers(novel);
        const target = dossiers.find((item) => item.id === dossierId);
        if (!target) {
          return false;
        }

        const targetNameKey = target.name.trim().toLowerCase();
        const linkedCast = (Array.isArray(novel.cast) ? novel.cast : []).find(
          (item) =>
            (target.castId && item.id === target.castId) ||
            (targetNameKey && item.name.trim().toLowerCase() === targetNameKey),
        );
        const removedSubject = {
          id: target.castId?.trim() || linkedCast?.id || '',
          name: (target.name.trim() || linkedCast?.name || '').trim(),
        };

        let nextCast = (Array.isArray(novel.cast) ? novel.cast : []).filter((item) => {
          if (target.castId && item.id === target.castId) {
            return false;
          }
          if (targetNameKey && item.name.trim().toLowerCase() === targetNameKey) {
            return false;
          }
          return true;
        });
        nextCast = stripCastRelationsToSubject(nextCast, removedSubject);

        // Drop the target (and any duplicates sharing castId / name) before re-sync.
        const remainingDossiers = dossiers.filter((item) => {
          if (item.id === target.id) {
            return false;
          }
          if (target.castId && item.castId === target.castId) {
            return false;
          }
          if (targetNameKey && item.name.trim().toLowerCase() === targetNameKey) {
            return false;
          }
          return true;
        });

        const nextDossiers = syncDossiersWithCast(nextCast, remainingDossiers, {
          refreshContentFromCast: false,
        }).filter((item) => {
          if (item.id === target.id) {
            return false;
          }
          if (target.castId && item.castId === target.castId) {
            return false;
          }
          if (targetNameKey && item.name.trim().toLowerCase() === targetNameKey) {
            return false;
          }
          return true;
        });

        const activeWorld = getActiveQuickTravelWorld(novel);
        const nextWorldCast = activeWorld
          ? stripCastRelationsToSubject(
              (activeWorld.cast ?? []).filter((item) => {
                if (target.castId && item.id === target.castId) {
                  return false;
                }
                if (targetNameKey && item.name.trim().toLowerCase() === targetNameKey) {
                  return false;
                }
                return true;
              }),
              removedSubject,
            )
          : undefined;
        const nextWorldDossiers = activeWorld
          ? (activeWorld.characterDossiers ?? []).filter((item) => {
              if (item.id === target.id) {
                return false;
              }
              if (target.castId && item.castId === target.castId) {
                return false;
              }
              if (targetNameKey && item.name.trim().toLowerCase() === targetNameKey) {
                return false;
              }
              return true;
            })
          : undefined;

        const removedCharacterId = target.castId?.trim() || linkedCast?.id || '';
        const removedNameKey = removedSubject.name.trim().toLocaleLowerCase();
        const timestamp = new Date().toISOString();
        set((current) => {
          const meta = current.novelConversationMeta[novelId];
          const nextMeta = meta
            ? {
                ...normalizeNovelConversation(meta),
                recentSceneDossierIds: (meta.recentSceneDossierIds ?? []).filter(
                  (id) => id !== target.id,
                ),
                updatedAt: timestamp,
              }
            : meta;

          return {
            novels: current.novels.map((item) =>
              item.id === novelId
                ? normalizeNovel({
                    ...item,
                    cast: nextCast,
                    quickTravel: item.quickTravel && activeWorld
                      ? {
                          ...item.quickTravel,
                          worlds: item.quickTravel.worlds.map((world) =>
                            world.id === activeWorld.id
                              ? {
                                  ...world,
                                  cast: nextWorldCast ?? world.cast,
                                  characterDossiers: nextWorldDossiers ?? world.characterDossiers,
                                  updatedAt: timestamp,
                                }
                              : world,
                          ),
                        }
                      : item.quickTravel,
                    characterDossiers: nextDossiers,
                    characterWorkspace: item.characterWorkspace
                      ? {
                          ...item.characterWorkspace,
                          tagsByCharacterId: Object.fromEntries(
                            Object.entries(item.characterWorkspace.tagsByCharacterId)
                              .filter(([characterId]) => characterId !== removedCharacterId),
                          ),
                          arcs: item.characterWorkspace.arcs.filter(
                            (arc) => arc.characterId !== removedCharacterId,
                          ),
                        }
                      : undefined,
                    novelStoryAnalysis: item.novelStoryAnalysis
                      ? {
                          ...item.novelStoryAnalysis,
                          characterStates: item.novelStoryAnalysis.characterStates.filter(
                            (state) => state.characterId !== removedCharacterId,
                          ),
                          relationships: item.novelStoryAnalysis.relationships.filter((relation) =>
                            relation.fromCharacter.trim().toLocaleLowerCase() !== removedNameKey
                            && relation.toCharacter.trim().toLocaleLowerCase() !== removedNameKey,
                          ),
                        }
                      : undefined,
                    relationGraphs: [],
                    updatedAt: timestamp,
                  })
                : item,
            ),
            novelConversationMeta: nextMeta
              ? {
                  ...current.novelConversationMeta,
                  [novelId]: nextMeta,
                }
              : current.novelConversationMeta,
          };
        });

        const updated = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (removedCharacterId) {
          void deleteCharacterBiographyCollection({
            novelId,
            characterId: removedCharacterId,
          }).catch((error) => {
            console.error('[novel] failed to delete character biographies', error);
          });
        }
        if (updated) {
          void persistNovelMetadata(updated).catch((error) => {
            console.error('[novel] failed to persist character deletion', error);
          });
        }

        useTavernStore.getState().syncActiveNovelSlot(novelId);
        return true;
      },
      mergeNovelShortTermMemories: async (novelId) => {
        const state = useTavernStore.getState();
        const novel = state.novels.find((item) => item.id === novelId);
        const timestamp = new Date().toISOString();
        const sessionMeta = normalizeNovelConversation(
          state.novelConversationMeta[novelId] ??
            createEmptyNovelConversation(novelId, novel?.name ?? '未命名小说', timestamp),
        );

        if (
          !novel ||
          (sessionMeta.shortTermMemories.length === 0 && sessionMeta.midTermMemories.length === 0)
        ) {
          return;
        }

        const apiSettings = resolveNovelAgentApiSettings(
          state.providers,
          state.generationSettings,
          'memory',
        );

        const flushed = await mergeShortTermIntoLongTermMemory({
          apiSettings,
          memoryMaxTokens: state.generationSettings.memoryMaxTokens,
          novel,
          longTermMemory: sessionMeta.longTermMemory,
          shortTermMemories: sessionMeta.shortTermMemories,
          midTermMemories: sessionMeta.midTermMemories,
        });
        const rememberedAt = new Date().toISOString();

        set((current) => ({
          novelConversationMeta: {
            ...current.novelConversationMeta,
            [novelId]: {
              ...normalizeNovelConversation(
                current.novelConversationMeta[novelId] ??
                  createEmptyNovelConversation(novelId, novel.name, rememberedAt),
              ),
              longTermMemory: flushed.longTermMemory,
              midTermMemories: flushed.midTermMemories,
              shortTermMemories: flushed.shortTermMemories,
              lastShortTermMemoryMessageId: undefined,
              updatedAt: rememberedAt,
            },
          },
        }));
        useTavernStore.getState().syncActiveNovelSlot(novelId);
      },
      updateSessionContextLength: (kind, sessionId, contextLength) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const nextLength = clampContextLength(contextLength);

          const title = state.novels.find((item) => item.id === sessionId)?.name ?? '未命名小说';

          return {
            novelConversationMeta: {
              ...state.novelConversationMeta,
              [sessionId]: {
                ...normalizeNovelConversation(
                  state.novelConversationMeta[sessionId] ??
                    createEmptyNovelConversation(sessionId, title, timestamp),
                ),
                contextLength: nextLength,
                updatedAt: timestamp,
              },
            },
          };
        }),
      updateSessionCustomConfig: (kind, sessionId, updates) =>
        set((state) => {
          const timestamp = new Date().toISOString();
          const patched: Partial<
            Pick<
              SessionCustomConfig,
              | 'mainPrompt'
              | 'prefix'
              | 'suffix'
              | 'backgroundEnabled'
              | 'bubbleOpacity'
              | 'replyLengthPreset'
              | 'boundGlobalWorldbookIds'
            >
          > = { ...updates };

          if (updates.bubbleOpacity !== undefined) {
            patched.bubbleOpacity = clampBubbleOpacity(updates.bubbleOpacity);
          }
          const title = state.novels.find((item) => item.id === sessionId)?.name ?? '未命名小说';

          return {
            novelConversationMeta: {
              ...state.novelConversationMeta,
              [sessionId]: {
                ...normalizeNovelConversation(
                  state.novelConversationMeta[sessionId] ??
                    createEmptyNovelConversation(sessionId, title, timestamp),
                ),
                ...patched,
                updatedAt: timestamp,
              },
            },
          };
        }),
      buildNovelBackup: (novelId) => buildCompleteNovelBackup(novelId),
      importSessionBundle: async (sourceBundle) => {
        assertSessionStorageReady();
        const state = get();
        const bundle = copyNovelBackup(sourceBundle, state.novels.some((item) => item.id === sourceBundle.sessionId));
          const timestamp = new Date().toISOString();
          const configFields = {
            ...bundle.config,
            contextLength: clampContextLength(bundle.config.contextLength),
            mainPrompt: bundle.config.mainPrompt ?? '',
            prefix: bundle.config.prefix ?? '',
            suffix: bundle.config.suffix ?? '',
            worldbookEntries: Array.isArray(bundle.config.worldbookEntries)
              ? bundle.config.worldbookEntries
              : [],
            boundGlobalWorldbookIds: Array.isArray(bundle.config.boundGlobalWorldbookIds)
              ? bundle.config.boundGlobalWorldbookIds
              : undefined,
            backgroundEnabled: bundle.config.backgroundEnabled ?? true,
            bubbleOpacity: clampBubbleOpacity(bundle.config.bubbleOpacity ?? 1),
            memory: bundle.config.memory ?? '',
          };

          const existingNovel = state.novels.find((item) => item.id === bundle.sessionId);
          const title =
            bundle.novel?.name?.trim() || existingNovel?.name || bundle.title?.trim() || '导入的小说';
          const promptDefaults = state.novelPromptDefaults ?? defaultNovelPromptDefaults;
          const emptyNovel = normalizeNovel(
            {
              id: bundle.sessionId,
              name: title,
              shortIntro: '',
              detailedIntro: '',
              systemPrompt: promptDefaults.systemPrompt,
              writingStyle: '',
              shortTermMemoryPrompt: promptDefaults.shortTermMemoryPrompt,
              midTermMemoryPrompt: promptDefaults.midTermMemoryPrompt,
              longTermMemoryPrompt: promptDefaults.longTermMemoryPrompt,
              playerName: '',
              playerPersona: '',
              playerMotive: '',
              ...EMPTY_PLAYER_PROFILE_FIELDS,
              worldName: '',
              worldEra: '',
              worldConflict: '',
              worldTone: '',
              mainPlot: '',
              initialStoryState: '',
              gameRules: '',
              statusBar: '',
              autoSuggestRoutes: false,
              relationGraphEnabled: false,
              characterCardAppearanceId: DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
              cast: [],
              characterDossiers: [],
              loreEntries: [],
              relationGraphs: [],
              openingMessage: '',
              defaultModelId: '',
              chatBackgroundOpacity: DEFAULT_CHAT_BACKGROUND_OPACITY,
              isDraft: false,
              createStep: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          );
          const importedNovel = bundle.novel
            ? normalizeNovel(
                {
                  ...emptyNovel,
                  ...bundle.novel,
                  id: bundle.sessionId,
                  name: title,
                  createdAt: bundle.novel.createdAt || emptyNovel.createdAt,
                  updatedAt: timestamp,
                },
              )
            : existingNovel ?? emptyNovel;
          const importedMessages = bundle.messages.map((message) => ({
            ...message,
            characterId: bundle.sessionId,
          }));
          const importedMeta = normalizeNovelConversation({
            ...(state.novelConversationMeta[bundle.sessionId] ??
              createEmptyNovelConversation(bundle.sessionId, title, timestamp)),
            ...configFields,
            longTermMemory: bundle.config.longTermMemory ?? '',
            midTermMemories: Array.isArray(bundle.config.midTermMemories)
              ? bundle.config.midTermMemories
              : [],
            shortTermMemories: Array.isArray(bundle.config.shortTermMemories)
              ? bundle.config.shortTermMemories
              : [],
            title,
            lastMessageAt: timestamp,
            updatedAt: timestamp,
          });

        const activeWorldId = getNovelWorldId(importedNovel);
        const worlds = { ...(bundle.worldSessions ?? {}) };
        if (!worlds[activeWorldId]) worlds[activeWorldId] = { messages: importedMessages, meta: importedMeta };
        for (const [worldId, world] of Object.entries(worlds)) {
          world.meta = normalizeNovelConversation({ ...world.meta, novelId: importedNovel.id,
            id: `${importedNovel.id}-conversation`, updatedAt: timestamp,
            activeRequestId: undefined, requestStatus: 'idle', agentStage: undefined, isSuggestingRoutes: false });
          world.messages = world.messages.map((message) => ({ ...message, characterId: importedNovel.id, worldId }));
          world.slotBook ??= ensureNovelSlotBook({ messages: world.messages, meta: world.meta, novelName: title });
        }
        if (Platform.OS !== 'web') {
          await enqueueNovelWrite(importedNovel.id, async () => {
            const db = await getAppDatabase();
            await inDatabaseTransaction(db, (tx) =>
              importNovelSnapshot(tx, importedNovel, worlds, bundle.characterBiographies));
          });
        } else {
          // New namespace: an interrupted import cannot corrupt an existing book.
          await replaceNovelBiographyCollections(importedNovel.id, bundle.characterBiographies);
        }
        const current = get();
        const active = worlds[activeWorldId];
        const slots = { ...current.novelSlotBooks };
        const cachedWorlds = { ...current.novelWorldSessions };
        for (const [worldId, world] of Object.entries(worlds)) {
          const key = worldId === 'legacy' ? importedNovel.id : `${importedNovel.id}::${worldId}`;
          slots[key] = world.slotBook!;
          cachedWorlds[key] = { messages: world.messages, meta: world.meta };
        }
        await publishDurablePatch({
          novels: [importedNovel, ...current.novels],
          novelConversations: { ...current.novelConversations, [importedNovel.id]: active.messages },
          novelConversationMeta: { ...current.novelConversationMeta, [importedNovel.id]: active.meta },
          novelSlotBooks: slots, novelWorldSessions: cachedWorlds,
        });
        await waitForNovelPersistence();
        if (Platform.OS !== 'web') await enqueueNovelWrite(importedNovel.id, async () => acknowledgeNovelImport(await getAppDatabase(), importedNovel.id));
      },
      updateWorldbookEntry: (entryId, updates) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            worldbookEntries: state.worldbookEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    ...updates,
                    updatedAt: timestamp,
                  }
                : entry,
            ),
          };
        }),
      toggleWorldbookEntry: (entryId) =>
        set((state) => {
          const timestamp = new Date().toISOString();

          return {
            worldbookEntries: state.worldbookEntries.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    enabled: !entry.enabled,
                    updatedAt: timestamp,
                  }
                : entry,
            ),
          };
        }),
      hydrateProviderSecrets: async () => {
        const current = get();
        try {
          const [secrets, imageSecrets] = await Promise.all([
            loadProviderSecrets(current.providers),
            loadImageProviderSecrets(current.imageGenerationSettings.providers),
          ]);
          set((state) => ({
            providers: Object.fromEntries(
              Object.values(state.providers).map((provider) => [
                provider.id,
                {
                  ...provider,
                  apiKey: secrets.providerKeys[provider.id] ?? '',
                },
              ]),
            ),
            imageGenerationSettings: {
              ...state.imageGenerationSettings,
              providers: Object.fromEntries(
                Object.values(state.imageGenerationSettings.providers).map((provider) => [
                  provider.id,
                  {
                    ...provider,
                    apiKey: imageSecrets.providerKeys[provider.id] ?? '',
                  },
                ]),
              ),
            },
            providerSecretsWarning: secrets.warning ?? '',
          }));
        } catch {
          // Never reinsert a legacy key into persisted state when SecureStore
          // fails. The UI can still edit a memory-only key for this session.
          set((state) => ({
            providers: Object.fromEntries(
              Object.values(state.providers).map((provider) => [
                provider.id,
                { ...provider, apiKey: '' },
              ]),
            ),
            imageGenerationSettings: {
              ...state.imageGenerationSettings,
              providers: Object.fromEntries(
                Object.values(state.imageGenerationSettings.providers).map((provider) => [
                  provider.id,
                  { ...provider, apiKey: '' },
                ]),
              ),
            },
            providerSecretsWarning:
              'SecureStore 当前不可用；API Key 只保留在本次会话，不会写入导出或 Zustand 持久化数据。',
          }));
        }
      },
      retryDatabaseMigration: async () => {
        useTavernStore.setState({ databaseMode: 'migrating', migrationError: '' });
        try {
          const result = await runMigrationCoordinator();
          useTavernStore.setState({ migrationError: result.errorMessage ?? '' });
          if (result.status === 'web-fallback') {
            useTavernStore.setState({ databaseMode: 'web-fallback' });
          } else {
            const restoreDb = await getAppDatabase();
            const pendingImports = await readPendingNovelImports(restoreDb);
            if (pendingImports.length) useTavernStore.setState((state) => ({ novels: [
              ...pendingImports.filter((novel) => !state.novels.some((item) => item.id === novel.id)).map(normalizeNovel), ...state.novels,
            ] }));
            const hydratedNovels = await Promise.all(
              useTavernStore.getState().novels.map(async (cachedNovel) => {
                const initialDb = await getAppDatabase();
                const databaseSnapshot = await getNovel(initialDb, cachedNovel.id);
                let novel = cachedNovel;
                if (databaseSnapshot && Date.parse(databaseSnapshot.updatedAt) >= Date.parse(cachedNovel.updatedAt)) {
                  const stored = JSON.parse(databaseSnapshot.jsonExtra || '{}') as Partial<Novel>;
                  if (stored.quickTravel) novel = normalizeNovel({ ...cachedNovel, quickTravel: stored.quickTravel });
                }
                const [metadata, factDb, messages, memoryState] = await Promise.all([
                  loadAllNovelChapterMetadata(novel.id),
                  getAppDatabase(),
                  loadNovelConversationForPrompt(novel.id, NOVEL_MESSAGE_PAGE_SIZE, getNovelWorldId(novel)),
                  loadNovelMemoryState(novel.id, getNovelWorldId(novel)),
                ]);
                const [facts, databaseNovel, stateDocuments, durableMeta, slotBook] = await Promise.all([
                  listActiveStoryFacts(factDb, novel.id, { limit: 1000 }),
                  getNovel(factDb, novel.id),
                  loadNovelStateDocuments(factDb, novel.id),
                  readConversationState(factDb, novel.id, getNovelWorldId(novel)),
                  readSlotBook(factDb, novel.id, getNovelWorldId(novel)),
                ]);
                let databaseStoryAnalysis: NovelStoryAnalysis | undefined;
                if (databaseNovel?.storyAnalysisJson) {
                  try {
                    databaseStoryAnalysis = JSON.parse(databaseNovel.storyAnalysisJson);
                  } catch {
                    databaseStoryAnalysis = undefined;
                  }
                }
                let recoveredQuickTravel = novel.quickTravel;
                if (databaseNovel && Date.parse(databaseNovel.updatedAt) >= Date.parse(novel.updatedAt)) {
                  const storedNovel = JSON.parse(databaseNovel.jsonExtra || '{}') as Partial<Novel>;
                  if (storedNovel.quickTravel) recoveredQuickTravel = storedNovel.quickTravel;
                }
                const databaseCanonRevision = Number(databaseNovel?.canonRevision ?? 0);
                const storyAnalysis =
                  databaseStoryAnalysis && databaseCanonRevision >= (novel.canonRevision ?? 0)
                    ? databaseStoryAnalysis
                    : novel.novelStoryAnalysis;
                return {
                  ...novel,
                  ...stateDocuments,
                  quickTravel: recoveredQuickTravel,
                  canonRevision: databaseCanonRevision,
                  novelGenerationJobs: (stateDocuments.novelGenerationJobs ?? []).map(retireBatchGenerationJob).map((job) =>
                    job.status === 'running'
                      ? { ...job, status: 'paused' as const, lastError: '应用重启导致任务暂停，可继续剩余分段', updatedAt: nowIso() }
                      : job,
                  ),
                  novelStoryAnalysis: storyAnalysis,
                  novelStoryFacts: facts.map((fact) => ({
                    id: fact.id,
                    factType: fact.factType,
                    subjectId: fact.subjectId,
                    contentJson: fact.contentJson,
                    sourceEventId: fact.sourceEventId,
                    stateVersion: fact.stateVersion,
                    confidence: fact.confidence,
                    locked: fact.locked === 1,
                    stale: fact.stale === 1,
                  })),
                  chapters: metadata.map((chapter) => ({
                    id: chapter.id,
                    index: chapter.chapterIndex,
                    title: chapter.title,
                    summary: (() => {
                      try {
                        const parsed = JSON.parse(chapter.jsonExtra) as { summary?: unknown };
                        return typeof parsed.summary === 'string' ? parsed.summary : '';
                      } catch {
                        return '';
                      }
                    })(),
                    goal: (() => {
                      try {
                        const parsed = JSON.parse(chapter.jsonExtra) as { goal?: unknown };
                        return typeof parsed.goal === 'string' ? parsed.goal : '';
                      } catch {
                        return '';
                      }
                    })(),
                    content: '',
                    planning: (() => {
                      try {
                        return normalizeChapterPlanning(JSON.parse(chapter.jsonExtra).planning);
                      } catch {
                        return undefined;
                      }
                    })(),
                    targetWords: (() => {
                      try {
                        const value: unknown = JSON.parse(chapter.jsonExtra).targetWords;
                        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
                      } catch {
                        return undefined;
                      }
                    })(),
                    status: chapter.status === 'final' ? ('final' as const) : ('draft' as const),
                    createdAt: chapter.createdAt,
                    updatedAt: chapter.updatedAt,
                  })),
                  hydratedMessages: messages,
                  hydratedMemory: memoryState,
                  hydratedMeta: durableMeta,
                  hydratedSlotBook: slotBook,
                };
              }),
            );
            useTavernStore.setState((state) => ({
              novels: hydratedNovels.map(({ hydratedMessages: _messages, hydratedMemory: _memory, hydratedMeta: _meta, hydratedSlotBook: _slotBook, ...novel }) => novel),
              novelSlotBooks: { ...state.novelSlotBooks, ...Object.fromEntries(hydratedNovels.filter((novel) => novel.hydratedSlotBook).map((novel) => [getNovelSlotBookKey(novel), novel.hydratedSlotBook!])) },
              novelConversations: Object.fromEntries(
                hydratedNovels.map(({ id, hydratedMessages }) => [
                  id,
                  state.novelConversations[id]?.length ? state.novelConversations[id] : hydratedMessages,
                ]),
              ),
              novelConversationMeta: Object.fromEntries(
                hydratedNovels.map(({ id, hydratedMemory, hydratedMeta }) => {
                  const current = normalizeNovelConversation(
                    state.novelConversationMeta[id] ??
                      createEmptyNovelConversation(id, state.novels.find((item) => item.id === id)?.name ?? '未命名小说', nowIso()),
                  );
                  return [
                    id,
                    {
                      ...current,
                      ...chooseDurableConversationMeta(current, hydratedMeta),
                      ...hydratedMemory,
                    },
                  ];
                }),
              ),
            }));
            await Promise.all(hydratedNovels.map(({ id }) =>
              useTavernStore.getState().hydrateRecentNovelChapters(id, { limit: 3 }),
            ));
            const recoverable = await scanNovelRecovery();
            useTavernStore.setState({ novelRecoveryItems: recoverable });
            // Flip to sqlite only after the authoritative state has been read;
            // this prevents the metadata subscriber from overwriting the DB
            // story analysis with the intentionally stripped AsyncStorage copy.
            useTavernStore.setState({ databaseMode: 'sqlite' });
            await waitForNovelPersistence();
            for (const restored of pendingImports) await enqueueNovelWrite(restored.id, () => acknowledgeNovelImport(restoreDb, restored.id));
          }
        } catch (error) {
          const migrationError = error instanceof Error ? error.message : String(error);
          useTavernStore.setState({ databaseMode: 'migration-failed', migrationError });
          throw error;
        }
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'tavern-mobile-store-v1',
      version: 2,
      storage: createJSONStorage(() => gatedAsyncStorage),
      partialize: (state): PersistedTavernState => ({
        novels: state.novels.map((novel) => {
          const withoutBiographies = stripNovelCharacterBiographiesForPersistence(novel);
          return Platform.OS === 'web'
            ? withoutBiographies
            : stripNovelBodyForPersistence(withoutBiographies);
        }),
        novelConversations: Platform.OS === 'web' ? state.novelConversations : undefined,
        novelWorldSessions: Platform.OS === 'web' ? state.novelWorldSessions : {},
        novelInspirationChats: state.novelInspirationChats,
        novelConversationMeta: Object.fromEntries(
          Object.entries(state.novelConversationMeta).map(([novelId, meta]) => [
            novelId,
            Platform.OS === 'web' ? { ...meta, activeRequestId: undefined, requestStatus: 'idle' as const, agentStage: undefined, isSuggestingRoutes: false } : stripConversationForPersistence(meta),
          ]),
        ),
        novelSlotBooks: Object.fromEntries(
          Object.entries(state.novelSlotBooks).map(([novelId, book]) => [
            novelId,
            Platform.OS === 'web' ? book : stripSlotMessagesForPersistence(book),
          ]),
        ),
        worldbookEntries: state.worldbookEntries,
        globalSystemPrompt: state.globalSystemPrompt,
        authorsNote: state.authorsNote,
        jailbreak: state.jailbreak,
        providers: Object.fromEntries(
          Object.values(state.providers).map((provider) => [
            provider.id,
            stripProviderSecret(provider),
          ]),
        ),
        generationSettings: stripGenerationSecret(state.generationSettings),
        imageGenerationSettings: {
          providerId: state.imageGenerationSettings.providerId,
          providers: Object.fromEntries(
            Object.values(state.imageGenerationSettings.providers).map((provider) => [
              provider.id,
              stripImageProviderSecret(provider),
            ]),
          ),
        },
        appearanceSettings: state.appearanceSettings,
        exportSettings: state.exportSettings,
        novelPromptDefaults: state.novelPromptDefaults,
        contentStyleSettings: state.contentStyleSettings,
        writingStyleTemplates: state.writingStyleTemplates,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedTavernState> | undefined;
        const migrated = persisted?.providers
          ? {
              providers: ensureActiveProvider(
                Object.fromEntries(
                  Object.values(persisted.providers).map((provider) => [
                    provider.id,
                    normalizeProvider(provider),
                  ]),
                ),
              ),
              generationSettings: normalizeGenerationSettings({
                ...defaultGenerationSettings,
                ...persisted.generationSettings,
                // Migrate old short defaults that frequently cut off novel replies.
                maxTokens:
                  (persisted.generationSettings?.maxTokens ?? 0) > 0 &&
                  (persisted.generationSettings?.maxTokens ?? 0) <= 2048
                    ? 20000
                    : (persisted.generationSettings?.maxTokens ??
                      defaultGenerationSettings.maxTokens),
              }),
            }
          : persisted?.apiSettings
            ? migrateLegacyApiSettings(persisted.apiSettings)
            : {
                providers: currentState.providers,
                generationSettings: currentState.generationSettings,
              };

        return {
          ...currentState,
          ...persisted,
          providers: migrated.providers,
          generationSettings: normalizeGenerationSettings(migrated.generationSettings),
          imageGenerationSettings: normalizeImageGenerationSettings(
            persisted?.imageGenerationSettings ?? currentState.imageGenerationSettings,
          ),
          appearanceSettings: normalizeAppearanceSettings(
            persisted?.appearanceSettings ?? currentState.appearanceSettings,
          ),
          exportSettings: normalizeExportSettings(
            persisted?.exportSettings ?? currentState.exportSettings,
          ),
          novelPromptDefaults: normalizeNovelPromptDefaults(
            persisted?.novelPromptDefaults ?? currentState.novelPromptDefaults,
          ),
          contentStyleSettings: normalizeContentStyleSettings(
            persisted?.contentStyleSettings ?? currentState.contentStyleSettings,
          ),
          writingStyleTemplates: normalizeWritingStyleTemplates(
            persisted?.writingStyleTemplates ?? currentState.writingStyleTemplates,
          ),
          novels: (persisted?.novels ?? currentState.novels).map((novel) =>
            normalizeNovel(novel),
          ),
          // Full conversation history is restored from SQLite in V2-03.
          novelConversations:
            Platform.OS === 'web'
              ? persisted?.novelConversations ?? currentState.novelConversations
              : currentState.novelConversations,
          novelInspirationChats:
            persisted?.novelInspirationChats ?? currentState.novelInspirationChats,
          novelConversationMeta: Object.fromEntries(
            Object.entries(
              persisted?.novelConversationMeta ?? currentState.novelConversationMeta,
            ).map(([id, meta]) => [id, normalizeNovelConversation(meta)]),
          ),
          novelSlotBooks: migrateNovelSlotBooks({
            novels: (persisted?.novels ?? currentState.novels).map((novel) =>
              normalizeNovel(novel),
            ),
            novelConversations: currentState.novelConversations,
            novelConversationMeta: Object.fromEntries(
              Object.entries(
                persisted?.novelConversationMeta ?? currentState.novelConversationMeta,
              ).map(([id, meta]) => [id, normalizeNovelConversation(meta)]),
            ),
            novelSlotBooks: persisted?.novelSlotBooks ?? currentState.novelSlotBooks,
          }),
          worldbookEntries:
            persisted?.worldbookEntries ?? persisted?.worldbook ?? currentState.worldbookEntries,
          globalSystemPrompt:
            persisted?.globalSystemPrompt ??
            currentState.globalSystemPrompt ??
            defaultContextSettings.globalSystemPrompt,
          authorsNote:
            persisted?.authorsNote ?? currentState.authorsNote ?? defaultContextSettings.authorsNote,
          jailbreak: persisted?.jailbreak ?? currentState.jailbreak ?? defaultContextSettings.jailbreak,
          hasHydrated: false,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          void state.hydrateProviderSecrets().finally(() => {
            state.setHasHydrated(true);
          });
          void state.retryDatabaseMigration().catch((error) => {
            console.error('[migration-coordinator]', error);
          });
        }
        // 应用重启后，上一会话遗留的 running 任务必然已中断（JS 进程已死）。
        // 将其标记为 failed，避免 UI 因残留 running 任务永久显示「生成中」而无法再次操作。
        const now = nowIso();
        const novels = state?.novels;
        if (novels) {
          const nextNovels = novels.map((novel) => {
            const jobs = novel.novelGenerationJobs ?? [];
            if (!jobs.some((job) => job.status === 'running')) {
              return novel;
            }
            return {
              ...novel,
              novelGenerationJobs: jobs.map((job) =>
                job.status === 'running'
                  ? {
                      ...job,
                      status: 'paused' as const,
                      lastError: '应用重启导致任务暂停，可继续剩余分段',
                      updatedAt: now,
                    }
                  : job,
              ),
            };
          });
          if (nextNovels !== novels) {
            useTavernStore.setState({ novels: nextNovels });
          }
        }
      },
    },
  ),
);


// Explicit changes reserve the conversation before any awaited I/O. Native
// replacements commit messages, memory and checkpoints in a single transaction.


async function switchNovelWorld(novelId: string, worldId: string): Promise<boolean> {
  assertSessionStorageReady();
  const release = beginNovelMutation(novelId);
  if (!release) throw new Error('正在生成或保存，请完成后再切换世界。');
  try {
    await waitForNovelPostTurn(novelId);
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    if (!novel) return false;
    const archive = ensureQuickTravelArchive(novel);
    const target = archive.worlds.find((world) => world.id === worldId);
    if (!target) return false;
    if (getNovelWorldId(novel) === worldId) return true;
    const oldMeta = state.novelConversationMeta[novelId];
    const oldMessages = state.novelConversations[novelId] ?? [];
    const nextNovel = normalizeNovel({ ...novel, cast: target.cast ?? [],
      characterDossiers: target.characterDossiers ?? [],
      quickTravel: { ...archive, activeWorldId: worldId }, updatedAt: nowIso() });
    const key = getNovelSlotBookKey(nextNovel);
    let messages = state.novelWorldSessions[key]?.messages ?? [];
    let meta = state.novelWorldSessions[key]?.meta ?? createEmptyNovelConversation(novelId, novel.name, nowIso());
    let book = state.novelSlotBooks[key];
    if (Platform.OS !== 'web') {
      await enqueueNovelWrite(novelId, async () => {
        const db = await getAppDatabase();
        const [targetMessages, storedMeta, memory, storedBook] = await Promise.all([
          loadNovelConversationForPrompt(novelId, NOVEL_MESSAGE_PAGE_SIZE, worldId),
          readConversationState(db, novelId, worldId),
          loadNovelMemoryState(novelId, worldId),
          readSlotBook(db, novelId, worldId),
        ]);
        messages = targetMessages;
        meta = normalizeNovelConversation({ ...(storedMeta ?? meta), ...memory });
        book = storedBook ?? book;
        await inDatabaseTransaction(db, async (tx) => {
          if (oldMeta) await writeConversationState(tx, novelId, getNovelWorldId(novel), oldMeta);
          await writeNovelMetadataInDatabase(tx, nextNovel);
        });
      });
    }
    invalidateNovelPostTurn(novelId);
    const current = useTavernStore.getState();
    await publishDurablePatch({
      novels: current.novels.map((item) => item.id === novelId ? nextNovel : item),
      novelConversations: { ...current.novelConversations, [novelId]: messages },
      novelConversationMeta: { ...current.novelConversationMeta, [novelId]: meta },
      novelWorldSessions: { ...current.novelWorldSessions,
        ...(oldMeta ? { [getNovelSlotBookKey(novel)]: { messages: oldMessages, meta: oldMeta } } : {}) },
      ...(book ? { novelSlotBooks: { ...current.novelSlotBooks, [key]: book } } : {}),
      novelConversationRevisions: { ...current.novelConversationRevisions,
        [novelId]: (current.novelConversationRevisions[novelId] ?? 0) + 1 },
    });
    return true;
  } finally { release(); }
}

async function buildCompleteNovelBackup(novelId: string): Promise<ChatSessionExportBundle> {
  assertSessionStorageReady();
  const release = beginNovelMutation(novelId);
  if (!release) throw new Error('正在生成或保存，请完成后再导出备份。');
  try {
    await waitForNovelPostTurn(novelId);
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    const meta = state.novelConversationMeta[novelId];
    if (!novel || !meta) throw new Error('小说或会话不存在。');
    const activeWorldId = getNovelWorldId(novel);
    const worlds: NonNullable<ChatSessionExportBundle['worldSessions']> = {};
    let completeNovel = novel;
    let biographies: NonNullable<ChatSessionExportBundle['characterBiographies']> = {};
    if (Platform.OS === 'web') {
      for (const [key, session] of Object.entries(state.novelWorldSessions)) {
        if (key === novelId || key.startsWith(`${novelId}::`)) {
          const worldId = key === novelId ? 'legacy' : key.slice(novelId.length + 2);
          worlds[worldId] = { ...session, slotBook: state.novelSlotBooks[key] };
        }
      }
      worlds[activeWorldId] = {
        messages: state.novelConversations[novelId] ?? [], meta,
        slotBook: state.novelSlotBooks[getNovelSlotBookKey(novel)],
      };
      biographies = await loadNovelBiographyCollections(novelId, [...new Set([
        ...novel.cast.map((character) => character.id),
        ...(novel.quickTravel?.worlds ?? []).flatMap((world) => world.cast.map((character) => character.id)),
      ])]);
    } else {
      await enqueueNovelWrite(novelId, async () => {
        const db = await getAppDatabase();
        await inDatabaseTransaction(db, async (tx) => {
          const messages = await readAllSessionMessages(tx, novelId);
          const knownWorlds = await tx.getAllAsync<{ worldId: string }>(
            'SELECT world_id AS worldId FROM novel_conversation_state WHERE novel_id = ? UNION SELECT world_id AS worldId FROM novel_slot_books WHERE novel_id = ?',
            novelId, novelId,
          );
          const worldIds = new Set([activeWorldId, ...messages.map((message) => message.worldId ?? 'legacy'), ...knownWorlds.map((row) => row.worldId)]);
          for (const worldId of worldIds) {
            const storedMeta = await readConversationState(tx, novelId, worldId);
            const worldMeta = worldId === activeWorldId ? meta
              : storedMeta ?? createEmptyNovelConversation(novelId, novel.name, nowIso());
            const aggregates = await tx.getAllAsync<{ type: string; content: string }>(
              "SELECT memory_type AS type, content FROM memories WHERE novel_id = ? AND world_id = ? AND stale = 0 ORDER BY memory_type",
              novelId, worldId,
            );
            const indexed = (prefix: string) => aggregates.filter((row) => row.type.startsWith(prefix))
              .sort((a, b) => Number(a.type.split('_').at(-1)) - Number(b.type.split('_').at(-1)))
              .map((row) => row.content);
            worlds[worldId] = {
              messages: messages.filter((message) => (message.worldId ?? 'legacy') === worldId),
              meta: { ...worldMeta,
                longTermMemory: aggregates.find((row) => row.type === 'long_term')?.content ?? '',
                midTermMemories: indexed('mid_term_'), shortTermMemories: indexed('short_term_') },
              slotBook: await readSlotBook(tx, novelId, worldId) ?? undefined,
            };
          }
          const chapters = await tx.getAllAsync<{
            id: string; index: number; title: string; content: string; status: string;
            createdAt: string; updatedAt: string; metadata: string;
          }>('SELECT id, chapter_index AS "index", title, content, status, created_at AS createdAt, updated_at AS updatedAt, json_extra AS metadata FROM chapters WHERE novel_id = ? ORDER BY chapter_index', novelId);
          completeNovel = { ...novel, chapters: chapters.map(({ metadata, status, ...chapter }) => ({
            ...JSON.parse(metadata || '{}'), ...chapter, status: status === 'final' ? 'final' as const : 'draft' as const,
            contentStatus: 'loaded' as const,
          })) };
          const rows = await tx.getAllAsync<import('@/types/tavern').NovelCharacterBiography & { characterId: string }>(
            'SELECT id, character_id AS characterId, title, request, content, created_at AS createdAt, updated_at AS updatedAt FROM character_biographies WHERE novel_id = ? ORDER BY sort_order',
            novelId,
          );
          for (const { characterId, ...entry } of rows) (biographies[characterId] ??= []).push(entry);
        });
      });
    }
    for (const [worldId, world] of Object.entries(worlds)) {
      world.slotBook = flushActiveSlot(ensureNovelSlotBook({
        book: world.slotBook, messages: world.messages, meta: world.meta, novelName: novel.name,
      }), world.messages, world.meta, novel.quickTravel?.worlds.find((item) => item.id === worldId)?.runtime.currentChapter);
      world.messages = world.messages.map((message) => ({ ...message, worldId }));
    }
    return buildChatSessionExportBundle({
      kind: 'novel', sessionId: novelId, title: novel.name, novel: completeNovel,
      config: worlds[activeWorldId].meta, messages: worlds[activeWorldId].messages,
      worldSessions: worlds, characterBiographies: biographies,
    });
  } finally { release(); }
}

/** Reserve the book, save all bodies atomically, then expose the saved version. */
async function saveChapterChanges(novelId: string, build: (novel: Novel) => NovelChapter[]) {
  assertSessionStorageReady();
  const release = beginNovelMutation(novelId);
  if (!release) throw new Error('当前作品正在保存或生成，请稍后重试。');
  try {
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    if (!novel) throw new Error('作品不存在。');
    if (novel.novelGenerationJobs?.some((job) => job.status === 'running')) throw new Error('当前作品正在生成，请稍后重试。');
    const chapters = build(novel);
    if (!chapters.length) return;
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const updatedAt = nowIso();
    const applyChanges = (current: Novel) => markNovelChapterStateStale({
      ...current,
      chapters: [
        ...(current.chapters ?? []).map((chapter) => byId.get(chapter.id) ?? chapter),
        ...chapters.filter((chapter) => !current.chapters?.some((item) => item.id === chapter.id)),
      ],
      updatedAt,
    }, Math.min(...chapters.map((chapter) => chapter.index)));
    await persistNovelChapterChanges(applyChanges(novel), chapters);
    const latest = useTavernStore.getState();
    const meta = latest.novelConversationMeta[novelId];
    await publishDurablePatch({
      novels: latest.novels.map((item) => item.id === novelId ? applyChanges(item) : item),
      ...(meta ? { novelConversationMeta: { ...latest.novelConversationMeta, [novelId]: { ...meta, memoryStale: true } } } : {}),
    }, applyChanges);
  } finally { release(); }
}

let webPublicationQueue: Promise<void> = Promise.resolve();
async function publishDurablePatch(patch: Partial<TavernState>, rebaseSavedNovel?: (current: Novel) => Novel) {
  if (Platform.OS !== 'web') {
    useTavernStore.setState(patch);
    return;
  }
  const base = useTavernStore.getState();
  // Publish only changed entities, so simultaneous saves in different books
  // cannot replace each other's maps with an older copy.
  const rebase = (): Partial<TavernState> => {
    const latest = useTavernStore.getState();
    const rebased = { ...patch };
    for (const key of ['novelConversations', 'novelConversationMeta', 'novelSlotBooks', 'novelWorldSessions', 'novelConversationRevisions'] as const) {
      const values = patch[key];
      if (!values) continue;
      const changed = Object.fromEntries(Object.entries(values).filter(([id, value]) => value !== base[key][id]));
      Object.assign(rebased, { [key]: { ...latest[key], ...changed } });
    }
    if (patch.novels) {
      const changed = new Map(patch.novels.filter((novel) => base.novels.find((item) => item.id === novel.id) !== novel).map((novel) => [novel.id, novel]));
      rebased.novels = [
        ...[...changed.values()].filter((novel) => !latest.novels.some((item) => item.id === novel.id)),
        ...latest.novels.map((novel) => changed.has(novel.id) ? (rebaseSavedNovel?.(novel) ?? changed.get(novel.id)!) : novel),
      ];
    }
    return rebased;
  };
  const operation = webPublicationQueue.catch(() => undefined).then(async () => {
    const options = useTavernStore.persist.getOptions();
    const candidate = { ...useTavernStore.getState(), ...rebase() };
    await commitNovelPersistence(durableStateStorage, 'tavern-mobile-store-v1', JSON.stringify({
      state: options.partialize!(candidate), version: options.version,
    }));
    useTavernStore.setState(rebase());
  });
  webPublicationQueue = operation;
  return operation;
}

function chooseDurableConversationMeta(current: NovelConversation, stored: NovelConversation | null) {
  if (!stored) return current;
  const currentTime = Date.parse(current.updatedAt);
  const storedTime = Date.parse(stored.updatedAt);
  return !Number.isFinite(currentTime) || (Number.isFinite(storedTime) && storedTime >= currentTime)
    ? stored : { ...current, memory: stored.memory };
}

function assertSessionStorageReady() {
  if (Platform.OS !== 'web' && useTavernStore.getState().databaseMode !== 'sqlite') {
    throw new Error('数据库尚未就绪，请等待加载完成后重试。');
  }
}

async function completeWorkingMessages(novelId: string, worldId: string) {
  if (Platform.OS === 'web') return useTavernStore.getState().novelConversations[novelId] ?? [];
  return readAllSessionMessages(await getAppDatabase(), novelId, worldId);
}

async function saveWorkingSession(
  novel: Novel,
  messages: Message[],
  meta: NovelConversation,
  book?: NovelSlotBook,
  worldChapter?: number,
) {
  const worldId = getNovelWorldId(novel);
  const restoredNovel = worldChapter !== undefined && novel.quickTravel
    ? { ...novel, updatedAt: nowIso(), quickTravel: { ...novel.quickTravel,
        worlds: novel.quickTravel.worlds.map((world) => world.id === worldId
          ? { ...world, runtime: { ...world.runtime, currentChapter: worldChapter } } : world) } }
    : novel;
  if (Platform.OS !== 'web') {
    await enqueueNovelWrite(novel.id, async () => {
      const db = await getAppDatabase();
      await inDatabaseTransaction(db, async (tx) => {
        await ensureNovelExists(tx, novel.id);
        await replaceSessionMessages(tx, novel.id, worldId, messages);
        await writeConversationState(tx, novel.id, worldId, meta);
        if (restoredNovel !== novel) await writeNovelMetadataInDatabase(tx, restoredNovel);
        if (book) await writeSlotBook(tx, novel.id, worldId, book);
      });
    });
  }
  const current = useTavernStore.getState();
  await publishDurablePatch({
    ...(restoredNovel !== novel ? { novels: current.novels.map((item) => item.id === novel.id ? restoredNovel : item) } : {}),
    novelConversations: { ...current.novelConversations, [novel.id]: messages },
    novelConversationMeta: { ...current.novelConversationMeta, [novel.id]: meta },
    novelConversationRevisions: {
      ...current.novelConversationRevisions,
      [novel.id]: (current.novelConversationRevisions[novel.id] ?? 0) + 1,
    },
    ...(book ? { novelSlotBooks: { ...current.novelSlotBooks, [getNovelSlotBookKey(novel)]: book } } : {}),
  });
}

function clearDerivedConversationMemory(meta: NovelConversation): NovelConversation {
  return {
    ...meta, longTermMemory: '', midTermMemories: [], shortTermMemories: [],
    agentSummary: undefined, lastShortTermMemoryMessageId: undefined,
    lastAgentSummaryMessageId: undefined, lastAgentSummarySnapshot: undefined,
    lastExperienceDraftMessageId: undefined, lastExperienceDraftSnapshot: undefined,
    lastExperienceDraftRecentIdsSnapshot: undefined, recentSceneDossierIds: [],
    suggestedRoutes: [], regressionEcho: undefined, memoryStale: true,
    updatedAt: nowIso(),
  };
}

async function mutateNovelMessage(novelId: string, messageId: string, content?: string) {
  if (content !== undefined && !content.trim()) return;
  assertSessionStorageReady();
  const release = beginNovelMutation(novelId);
  if (!release) throw new Error('正在生成或保存，请完成后再编辑消息。');
  try {
    invalidateNovelPostTurn(novelId);
    await waitForNovelPostTurn(novelId);
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    const meta = state.novelConversationMeta[novelId];
    if (!novel || !meta) throw new Error('会话不存在。');
    const messages = await completeWorkingMessages(novelId, getNovelWorldId(novel));
    const target = messages.find((message) => message.id === messageId);
    if (!target) throw new Error('消息不存在，请刷新会话后重试。');
    if (target.status === 'streaming') throw new Error('请先停止生成。');
    const next = content === undefined ? messages.filter((message) => message.id !== messageId)
      : messages.map((message) => message.id === messageId
        ? { ...message, content: content.trim(), updatedAt: nowIso() } : message);
    await saveWorkingSession(novel, next, clearDerivedConversationMemory(meta));
  } finally { release(); }
}

async function mutateNovelSlot(
  novelId: string,
  operation: 'create' | 'switch' | 'rename' | 'delete' | 'rollback',
  slotId?: string,
  name?: string,
  withEcho = false,
): Promise<NovelSlotOpResult> {
  assertSessionStorageReady();
  const release = beginNovelMutation(novelId);
  if (!release) return { ok: false, reason: 'streaming' };
  try {
    await waitForNovelPostTurn(novelId);
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    const meta = state.novelConversationMeta[novelId];
    if (!novel || !meta) return { ok: false, reason: 'missing' };
    const worldId = getNovelWorldId(novel);
    const messages = await completeWorkingMessages(novelId, worldId);
    if (messages.some((message) => message.status === 'streaming')) return { ok: false, reason: 'streaming' };
    const stored = Platform.OS === 'web' ? null : await readSlotBook(await getAppDatabase(), novelId, worldId);
    let book = ensureNovelSlotBook({
      book: stored ?? state.novelSlotBooks[getNovelSlotBookKey(novel)],
      messages, meta, novelName: novel.name,
    });
    const worldChapter = getActiveQuickTravelWorld(novel)?.runtime.currentChapter;
    book = flushActiveSlot(book, messages, meta, worldChapter);
    book = { ...book, slots: book.slots.map((slot) =>
      slot.id === book.activeSlotId ? { ...slot, worldId } : slot) };
    let applied: { messages: Message[]; meta: NovelConversation } | undefined;
    let restoredChapter: number | undefined;
    if (operation === 'create') {
      if (book.slots.length >= MAX_NOVEL_SAVE_SLOTS) return { ok: false, reason: 'full' };
      slotId = createNovelSaveSlotId();
      book = { ...book, slots: [...book.slots, snapshotWorkingToSlot({
        slotId, name: name?.trim() || `记忆点 ${book.slots.length}`,
        createdAt: nowIso(), messages, meta, worldId, worldChapter,
      })] };
    } else if (operation === 'rename') {
      if (!name?.trim()) return { ok: false, reason: 'missing' };
      if (!book.slots.some((slot) => slot.id === slotId)) return { ok: false, reason: 'not_found' };
      book = { ...book, slots: book.slots.map((slot) => slot.id === slotId
        ? { ...slot, name: name.trim(), updatedAt: nowIso() } : slot) };
    } else {
      const target = operation === 'rollback' ? book.previousSnapshot
        : operation === 'delete' && slotId === book.activeSlotId
          ? book.slots.find((slot) => slot.id !== slotId)
          : book.slots.find((slot) => slot.id === slotId);
      if (!target) return { ok: false, reason: operation === 'rollback' ? 'no_rollback' : 'not_found' };
      if (operation === 'delete' && book.slots.length <= 1) return { ok: false, reason: 'last_slot' };
      const changesWorking = operation !== 'delete' || slotId === book.activeSlotId;
      if (changesWorking) {
        // Pre-v15 native persistence stripped snapshot bodies. Do not silently
        // replace live history with an unrecoverable empty checkpoint.
        if ((!target.snapshotVersion && target.messages.length === 0) ||
            (target.worldId && target.worldId !== worldId)) {
          return { ok: false, reason: 'unavailable' };
        }
        applied = applySlotToWorking(target, novelId, novel.name);
        restoredChapter = target.worldChapter;
        applied.meta.regressionEcho = operation === 'switch' && withEcho
          ? buildRegressionEchoFromWorking({ messages, shortTermMemories: meta.shortTermMemories }) || undefined
          : undefined;
        invalidateNovelPostTurn(novelId);
      }
      if (operation === 'delete') {
        book = { ...book, activeSlotId: changesWorking ? target.id : book.activeSlotId,
          slots: book.slots.filter((slot) => slot.id !== slotId),
          previousSnapshot: book.previousSnapshot?.id === slotId ? null : book.previousSnapshot };
      } else if (operation === 'rollback') {
        book = { ...book, activeSlotId: target.id, previousSnapshot: null,
          slots: book.slots.some((slot) => slot.id === target.id)
            ? book.slots.map((slot) => slot.id === target.id ? target : slot)
            : [...book.slots.slice(0, MAX_NOVEL_SAVE_SLOTS - 1), target] };
      } else if (target.id !== book.activeSlotId) {
        book = { ...book, activeSlotId: target.id,
          previousSnapshot: book.slots.find((slot) => slot.id === book.activeSlotId) ?? null };
      }
      slotId = target.id;
    }
    if (applied) {
      await saveWorkingSession(novel, applied.messages, applied.meta, book, restoredChapter);
    } else {
      if (Platform.OS !== 'web') await enqueueNovelWrite(novelId, async () => {
        const db = await getAppDatabase();
        await inDatabaseTransaction(db, async (tx) => {
          await ensureNovelExists(tx, novelId);
          await writeSlotBook(tx, novelId, worldId, book);
        });
      });
      await publishDurablePatch({ novelSlotBooks: {
        ...useTavernStore.getState().novelSlotBooks, [getNovelSlotBookKey(novel)]: book,
      } });
    }
    return { ok: true, slotId };
  } finally { release(); }
}

// Novel metadata and StoryState updates are spread across many store actions.
// Persist changed novel entities centrally so analysis survives app restarts
// without serializing full message history into AsyncStorage.
let previousNovelRefs = new Map<string, Novel>();
useTavernStore.subscribe((state) => {
  if (Platform.OS === 'web') return;
  if (state.databaseMode !== 'sqlite') return;
  const nextRefs = new Map(state.novels.map((novel) => [novel.id, novel]));
  for (const novel of state.novels) {
    if (previousNovelRefs.get(novel.id) !== novel) {
      void persistNovelMetadata(novel).catch((error) => {
        console.error('[novel] failed to persist changed novel metadata', error);
      });
    }
  }
  for (const novelId of previousNovelRefs.keys()) {
    if (!nextRefs.has(novelId)) {
      void removeNovelFromDatabase(novelId).catch((error) => {
        console.error('[novel] failed to remove deleted novel metadata', error);
      });
    }
  }
  previousNovelRefs = nextRefs;
});

let previousConversationState: Pick<TavernState, 'novelConversationMeta' | 'novels'> | undefined;
useTavernStore.subscribe((state) => {
  const previous = previousConversationState;
  previousConversationState = state;
  if (Platform.OS === 'web' || state.databaseMode !== 'sqlite') return;
  for (const novel of state.novels) {
    const meta = state.novelConversationMeta[novel.id];
    if (!meta || previous?.novelConversationMeta[novel.id] === meta || isNovelMutationActive(novel.id) || !state.novelConversations[novel.id]?.length) continue;
    const oldNovel = previous?.novels.find((item) => item.id === novel.id);
    // World selection sets an empty shell until hydrate completes; never write
    // that shell over the target world's persisted memory.
    if (oldNovel && getNovelWorldId(oldNovel) !== getNovelWorldId(novel)) continue;
    void enqueueNovelWrite(novel.id, async () => {
      const db = await getAppDatabase();
      await inDatabaseTransaction(db, async (tx) => {
        await ensureNovelExists(tx, novel.id);
        await writeConversationState(tx, novel.id, getNovelWorldId(novel), meta);
      });
    }).catch((error) => console.error('[novel] failed to persist conversation metadata', error));
  }
});
