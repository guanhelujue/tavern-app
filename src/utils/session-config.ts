import {
  clampBubbleOpacity,
  clampContextLength,
  createDefaultSessionConfigFields,
} from '@/constants/session-config';
import { normalizeNovelInjectionToggles } from '@/constants/session-injection';
import {
  normalizeReplyLengthPreset,
  type ReplyLengthPreset,
} from '@/constants/reply-length';
import type {
  NovelCharacterBrief,
  NovelConversation,
  NovelDirectPlan,
  NovelEditorReview,
  WorldbookEntry,
} from '@/types/tavern';
import { asString } from '@/utils/helpers';

function normalizeSessionReplyLengthPreset(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeReplyLengthPreset(value);
}

function normalizeWorldbookEntries(entries: WorldbookEntry[] | undefined): WorldbookEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry) => ({
    id: entry.id || `worldbook-${Math.random().toString(36).slice(2, 8)}`,
    keys: entry.keys ?? '',
    content: entry.content ?? '',
    enabled: entry.enabled !== false,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  }));
}

function normalizeBoundGlobalWorldbookIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

type SessionConfigDefaults = {
  contextLength: number;
  mainPrompt: string;
  prefix: string;
  suffix: string;
  worldbookEntries: WorldbookEntry[];
  boundGlobalWorldbookIds?: string[];
  backgroundEnabled: boolean;
  bubbleOpacity: number;
  replyLengthPreset: ReplyLengthPreset | null;
  memory: string;
};

function applySessionConfigDefaults(
  conversation: Record<string, unknown>,
): SessionConfigDefaults {
  const defaults = createDefaultSessionConfigFields();
  return {
    ...defaults,
    ...conversation,
    contextLength: clampContextLength(
      (conversation.contextLength as number | undefined) ?? defaults.contextLength,
    ),
    mainPrompt: asString(conversation.mainPrompt),
    prefix: asString(conversation.prefix),
    suffix: asString(conversation.suffix),
    worldbookEntries: normalizeWorldbookEntries(
      conversation.worldbookEntries as WorldbookEntry[] | undefined,
    ),
    boundGlobalWorldbookIds: normalizeBoundGlobalWorldbookIds(
      conversation.boundGlobalWorldbookIds,
    ),
    backgroundEnabled:
      (conversation.backgroundEnabled as boolean | undefined) ?? defaults.backgroundEnabled,
    bubbleOpacity: clampBubbleOpacity(
      (conversation.bubbleOpacity as number | undefined) ?? defaults.bubbleOpacity,
    ),
    replyLengthPreset: normalizeSessionReplyLengthPreset(conversation.replyLengthPreset),
    memory: asString(conversation.memory),
  };
}

function trimOptionalString(value: unknown): string | undefined {
  const s = asString(value);
  return s || undefined;
}

function normalizeStringIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = (value as unknown[])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function normalizeStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
}

function normalizeDirectPlan(value: unknown): NovelDirectPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const list = (candidate: unknown) => Array.isArray(candidate)
    ? candidate
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const plan: NovelDirectPlan = {
    objective: asString(source.objective),
    scene: asString(source.scene),
    participants: list(source.participants),
    beats: list(source.beats),
    constraints: list(source.constraints),
    endingHook: asString(source.endingHook),
  };

  return plan.objective || plan.scene || plan.participants.length || plan.beats.length || plan.constraints.length || plan.endingHook
    ? plan
    : undefined;
}

function normalizeCharacterBrief(value: unknown): NovelCharacterBrief | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const list = (candidate: unknown, limit = 12) => Array.isArray(candidate)
    ? candidate
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
  const characters = Array.isArray(source.characters)
    ? source.characters
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .slice(0, 8)
        .map((item) => ({
          characterId: trimOptionalString(item.characterId),
          name: asString(item.name),
          objective: asString(item.objective),
          emotionalState: asString(item.emotionalState),
          behavior: asString(item.behavior),
          voice: asString(item.voice),
          relationshipChanges: list(item.relationshipChanges, 6),
        }))
        .filter((item) => item.name || item.characterId || item.objective || item.emotionalState || item.behavior || item.voice || item.relationshipChanges.length > 0)
    : [];
  const brief: NovelCharacterBrief = {
    activeCharacterIds: list(source.activeCharacterIds, 8),
    characters,
    continuityWarnings: list(source.continuityWarnings, 8),
  };

  return brief.activeCharacterIds.length || brief.characters.length || brief.continuityWarnings.length
    ? brief
    : undefined;
}

function normalizeEditorReview(value: unknown): NovelEditorReview | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const issues = Array.isArray(source.issues)
    ? source.issues
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const severity = source.severity === 'major' || source.severity === 'minor' ? source.severity : 'none';
  const approved = typeof source.approved === 'boolean'
    ? source.approved
    : severity === 'none' && issues.length === 0;
  const review: NovelEditorReview = {
    approved,
    severity,
    issues,
    revisionInstructions: asString(source.revisionInstructions),
  };

  return typeof source.approved === 'boolean' || review.issues.length || review.revisionInstructions || review.severity !== 'none'
    ? review
    : undefined;
}

function normalizeRequestStatus(value: unknown): NovelConversation['requestStatus'] {
  return value === 'streaming' || value === 'cancelling' || value === 'error'
    ? value
    : 'idle';
}

function normalizeExperienceDraftSnapshot(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const id = key.trim();
    if (!id || typeof val !== 'string') {
      continue;
    }
    next[id] = val;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeNovelConversation(conversation: NovelConversation): NovelConversation {
  const defaults = createDefaultSessionConfigFields();
  const shared = applySessionConfigDefaults(conversation as unknown as Record<string, unknown>);

  return {
    ...defaults,
    ...conversation,
    ...shared,
    longTermMemory: asString(conversation.longTermMemory),
    agentSummary: trimOptionalString(conversation.agentSummary)?.slice(0, 2400) as string | undefined,
    midTermMemories: Array.isArray(conversation.midTermMemories)
      ? conversation.midTermMemories.filter((item) => item.trim())
      : [],
    shortTermMemories: Array.isArray(conversation.shortTermMemories)
      ? conversation.shortTermMemories.filter((item) => item.trim())
      : [],
    memoryStale: conversation.memoryStale === true,
    suggestedRoutes: Array.isArray(conversation.suggestedRoutes)
      ? conversation.suggestedRoutes
          .filter((route): route is string => typeof route === 'string')
          .map((route) => route.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [],
    isSuggestingRoutes: Boolean(conversation.isSuggestingRoutes),
    injectionToggles: normalizeNovelInjectionToggles(conversation.injectionToggles),
    lastMemoryError: trimOptionalString(conversation.lastMemoryError),
    activeRequestId: trimOptionalString(conversation.activeRequestId),
    requestStatus: normalizeRequestStatus(conversation.requestStatus),
    lastRequestError: trimOptionalString(conversation.lastRequestError),
    agentStage:
      conversation.agentStage === 'memory-context' ||
      conversation.agentStage === 'direct' ||
      conversation.agentStage === 'character' ||
      conversation.agentStage === 'narrator' ||
      conversation.agentStage === 'editor' ||
      conversation.agentStage === 'repair' ||
      conversation.agentStage === 'memory'
        ? conversation.agentStage
        : undefined,
    lastDirectPlan: normalizeDirectPlan(conversation.lastDirectPlan),
    lastDirectAgentError: trimOptionalString(conversation.lastDirectAgentError),
    lastCharacterBrief: normalizeCharacterBrief(conversation.lastCharacterBrief),
    lastCharacterAgentError: trimOptionalString(conversation.lastCharacterAgentError),
    lastEditorReview: normalizeEditorReview(conversation.lastEditorReview),
    lastEditorAgentError: trimOptionalString(conversation.lastEditorAgentError),
    lastShortTermMemoryMessageId: trimOptionalString(conversation.lastShortTermMemoryMessageId),
    lastAgentSummaryMessageId: trimOptionalString(conversation.lastAgentSummaryMessageId),
    lastAgentSummarySnapshot: trimOptionalString(conversation.lastAgentSummarySnapshot)?.slice(0, 2400) as string | undefined,
    lastExperienceDraftMessageId: trimOptionalString(conversation.lastExperienceDraftMessageId),
    lastExperienceDraftSnapshot: normalizeExperienceDraftSnapshot(
      conversation.lastExperienceDraftSnapshot,
    ),
    lastExperienceDraftRecentIdsSnapshot: normalizeStringIdList(
      conversation.lastExperienceDraftRecentIdsSnapshot,
    ),
    recentSceneDossierIds: normalizeStringIdArray(conversation.recentSceneDossierIds),
    regressionEcho: trimOptionalString(conversation.regressionEcho)?.slice(0, 400) as string | undefined,
    currentChapter: trimOptionalString(conversation.currentChapter)?.slice(0, 100) as string | undefined,
    memorySystemEnabled: conversation.memorySystemEnabled !== false,
  };
}
