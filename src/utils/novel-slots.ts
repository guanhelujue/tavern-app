import { createNovelSaveSlotId, MAX_NOVEL_SAVE_SLOTS } from '@/constants/novel-slots';
import { createDefaultSessionConfigFields } from '@/constants/session-config';
import type { Message, NovelConversation, NovelSaveSlot, NovelSlotBook } from '@/types/tavern';
import { normalizeNovelConversation } from '@/utils/session-config';

function pickSessionConfig(meta: NovelConversation) {
  return {
    contextLength: meta.contextLength,
    mainPrompt: meta.mainPrompt,
    prefix: meta.prefix,
    suffix: meta.suffix,
    worldbookEntries: meta.worldbookEntries,
    boundGlobalWorldbookIds: meta.boundGlobalWorldbookIds,
    backgroundEnabled: meta.backgroundEnabled,
    bubbleOpacity: meta.bubbleOpacity,
    replyLengthPreset: meta.replyLengthPreset ?? null,
  };
}

export function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({ ...message }));
}

export function snapshotWorkingToSlot(input: {
  slotId: string;
  name: string;
  createdAt: string;
  messages: Message[];
  meta: NovelConversation;
  updatedAt?: string;
  worldId?: string;
  worldChapter?: number;
}): NovelSaveSlot {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const normalized = normalizeNovelConversation(input.meta);

  return {
    id: input.slotId,
    snapshotVersion: 1,
    worldId: input.worldId,
    worldChapter: input.worldChapter,
    currentChapter: normalized.currentChapter,
    memorySystemEnabled: normalized.memorySystemEnabled,
    name: input.name.trim() || '未命名存档',
    createdAt: input.createdAt,
    updatedAt,
    messages: cloneMessages(input.messages),
    memory: normalized.memory ?? '',
    agentSummary: normalized.agentSummary,
    longTermMemory: normalized.longTermMemory ?? '',
    midTermMemories: [...(normalized.midTermMemories ?? [])],
    shortTermMemories: [...(normalized.shortTermMemories ?? [])],
    memoryStale: normalized.memoryStale === true,
    lastMessageAt: normalized.lastMessageAt || updatedAt,
    title: normalized.title,
    suggestedRoutes: [...(normalized.suggestedRoutes ?? [])],
    injectionToggles: normalized.injectionToggles
      ? { ...normalized.injectionToggles }
      : undefined,
    lastShortTermMemoryMessageId: normalized.lastShortTermMemoryMessageId,
    lastAgentSummaryMessageId: normalized.lastAgentSummaryMessageId,
    lastAgentSummarySnapshot: normalized.lastAgentSummarySnapshot,
    lastExperienceDraftMessageId: normalized.lastExperienceDraftMessageId,
    lastExperienceDraftSnapshot: normalized.lastExperienceDraftSnapshot
      ? { ...normalized.lastExperienceDraftSnapshot }
      : undefined,
    lastExperienceDraftRecentIdsSnapshot: Array.isArray(
      normalized.lastExperienceDraftRecentIdsSnapshot,
    )
      ? [...normalized.lastExperienceDraftRecentIdsSnapshot]
      : undefined,
    recentSceneDossierIds: [...(normalized.recentSceneDossierIds ?? [])],
    regressionEcho: normalized.regressionEcho,
    ...pickSessionConfig(normalized),
  };
}

export function applySlotToWorking(
  slot: NovelSaveSlot,
  novelId: string,
  fallbackTitle: string,
): { messages: Message[]; meta: NovelConversation } {
  const timestamp = new Date().toISOString();
  const defaults = createDefaultSessionConfigFields();

  return {
    messages: cloneMessages(slot.messages ?? []),
    meta: normalizeNovelConversation({
      id: `${novelId}-conversation`,
      novelId,
      title: slot.title || fallbackTitle,
      currentChapter: slot.currentChapter,
      memorySystemEnabled: slot.memorySystemEnabled,
      boundGlobalWorldbookIds: slot.boundGlobalWorldbookIds,
      memory: slot.memory ?? '',
      agentSummary: slot.agentSummary,
      longTermMemory: slot.longTermMemory ?? '',
      midTermMemories: Array.isArray(slot.midTermMemories) ? [...slot.midTermMemories] : [],
      shortTermMemories: Array.isArray(slot.shortTermMemories) ? [...slot.shortTermMemories] : [],
      memoryStale: slot.memoryStale === true,
      lastMessageAt: slot.lastMessageAt || timestamp,
      createdAt: slot.createdAt || timestamp,
      updatedAt: timestamp,
      suggestedRoutes: Array.isArray(slot.suggestedRoutes) ? [...slot.suggestedRoutes] : [],
      isSuggestingRoutes: false,
      injectionToggles: slot.injectionToggles ? { ...slot.injectionToggles } : undefined,
      lastShortTermMemoryMessageId: slot.lastShortTermMemoryMessageId,
      lastAgentSummaryMessageId: slot.lastAgentSummaryMessageId,
      lastAgentSummarySnapshot: slot.lastAgentSummarySnapshot,
      lastExperienceDraftMessageId: slot.lastExperienceDraftMessageId,
      lastExperienceDraftSnapshot: slot.lastExperienceDraftSnapshot
        ? { ...slot.lastExperienceDraftSnapshot }
        : undefined,
      lastExperienceDraftRecentIdsSnapshot: Array.isArray(
        slot.lastExperienceDraftRecentIdsSnapshot,
      )
        ? [...slot.lastExperienceDraftRecentIdsSnapshot]
        : undefined,
      recentSceneDossierIds: Array.isArray(slot.recentSceneDossierIds)
        ? [...slot.recentSceneDossierIds]
        : [],
      regressionEcho: slot.regressionEcho,
      contextLength: slot.contextLength ?? defaults.contextLength,
      mainPrompt: slot.mainPrompt ?? '',
      prefix: slot.prefix ?? '',
      suffix: slot.suffix ?? '',
      worldbookEntries: slot.worldbookEntries ?? [],
      backgroundEnabled: slot.backgroundEnabled ?? defaults.backgroundEnabled,
      bubbleOpacity: slot.bubbleOpacity ?? defaults.bubbleOpacity,
      replyLengthPreset: slot.replyLengthPreset ?? null,
    }),
  };
}

export function normalizeNovelSaveSlot(raw: Partial<NovelSaveSlot> | null | undefined): NovelSaveSlot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createNovelSaveSlotId();
  const timestamp = new Date().toISOString();
  const defaults = createDefaultSessionConfigFields();

  return {
    id,
    snapshotVersion: raw.snapshotVersion === 1 ? 1 : undefined,
    worldId: typeof raw.worldId === 'string' ? raw.worldId : undefined,
    worldChapter: typeof raw.worldChapter === 'number' && Number.isFinite(raw.worldChapter) ? raw.worldChapter : undefined,
    currentChapter: raw.currentChapter,
    memorySystemEnabled: raw.memorySystemEnabled,
    boundGlobalWorldbookIds: raw.boundGlobalWorldbookIds,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名记忆点',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : timestamp,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : timestamp,
    messages: Array.isArray(raw.messages) ? cloneMessages(raw.messages as Message[]) : [],
    memory: typeof raw.memory === 'string' ? raw.memory : '',
    agentSummary:
      typeof raw.agentSummary === 'string' && raw.agentSummary.trim()
        ? raw.agentSummary.trim().slice(0, 2400)
        : undefined,
    longTermMemory: typeof raw.longTermMemory === 'string' ? raw.longTermMemory : '',
    midTermMemories: Array.isArray(raw.midTermMemories)
      ? raw.midTermMemories.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    shortTermMemories: Array.isArray(raw.shortTermMemories)
      ? raw.shortTermMemories.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    memoryStale: raw.memoryStale === true,
    lastMessageAt:
      typeof raw.lastMessageAt === 'string' && raw.lastMessageAt ? raw.lastMessageAt : timestamp,
    title: typeof raw.title === 'string' ? raw.title : '未命名小说',
    suggestedRoutes: Array.isArray(raw.suggestedRoutes)
      ? raw.suggestedRoutes
          .filter((route): route is string => typeof route === 'string')
          .map((route) => route.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [],
    injectionToggles: raw.injectionToggles ? { ...raw.injectionToggles } : undefined,
    lastShortTermMemoryMessageId:
      typeof raw.lastShortTermMemoryMessageId === 'string' && raw.lastShortTermMemoryMessageId.trim()
        ? raw.lastShortTermMemoryMessageId.trim()
        : undefined,
    lastAgentSummaryMessageId:
      typeof raw.lastAgentSummaryMessageId === 'string' && raw.lastAgentSummaryMessageId.trim()
        ? raw.lastAgentSummaryMessageId.trim()
        : undefined,
    lastAgentSummarySnapshot:
      typeof raw.lastAgentSummarySnapshot === 'string' && raw.lastAgentSummarySnapshot.trim()
        ? raw.lastAgentSummarySnapshot.trim().slice(0, 2400)
        : undefined,
    lastExperienceDraftMessageId:
      typeof raw.lastExperienceDraftMessageId === 'string' && raw.lastExperienceDraftMessageId.trim()
        ? raw.lastExperienceDraftMessageId.trim()
        : undefined,
    lastExperienceDraftSnapshot: (() => {
      const rawSnap = raw.lastExperienceDraftSnapshot;
      if (!rawSnap || typeof rawSnap !== 'object' || Array.isArray(rawSnap)) {
        return undefined;
      }
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawSnap)) {
        const id = key.trim();
        if (!id || typeof value !== 'string') {
          continue;
        }
        next[id] = value;
      }
      return Object.keys(next).length > 0 ? next : undefined;
    })(),
    lastExperienceDraftRecentIdsSnapshot: Array.isArray(raw.lastExperienceDraftRecentIdsSnapshot)
      ? raw.lastExperienceDraftRecentIdsSnapshot
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined,
    recentSceneDossierIds: Array.isArray(raw.recentSceneDossierIds)
      ? raw.recentSceneDossierIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
    regressionEcho:
      typeof raw.regressionEcho === 'string' && raw.regressionEcho.trim()
        ? raw.regressionEcho.trim().slice(0, 400)
        : undefined,
    contextLength: raw.contextLength ?? defaults.contextLength,
    mainPrompt: typeof raw.mainPrompt === 'string' ? raw.mainPrompt : '',
    prefix: typeof raw.prefix === 'string' ? raw.prefix : '',
    suffix: typeof raw.suffix === 'string' ? raw.suffix : '',
    worldbookEntries: Array.isArray(raw.worldbookEntries) ? raw.worldbookEntries : [],
    backgroundEnabled: raw.backgroundEnabled ?? defaults.backgroundEnabled,
    bubbleOpacity: raw.bubbleOpacity ?? defaults.bubbleOpacity,
    replyLengthPreset: raw.replyLengthPreset ?? null,
  };
}

export function normalizeNovelSlotBook(raw: Partial<NovelSlotBook> | null | undefined): NovelSlotBook | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.slots)) {
    return null;
  }

  const slots = raw.slots
    .map((slot) => normalizeNovelSaveSlot(slot))
    .filter((slot): slot is NovelSaveSlot => Boolean(slot))
    .slice(0, MAX_NOVEL_SAVE_SLOTS);

  if (slots.length === 0) {
    return null;
  }

  const activeSlotId =
    typeof raw.activeSlotId === 'string' && slots.some((slot) => slot.id === raw.activeSlotId)
      ? raw.activeSlotId
      : slots[0].id;

  return {
    activeSlotId,
    slots,
    previousSnapshot: normalizeNovelSaveSlot(raw.previousSnapshot),
  };
}

/** Build a default single-slot book from the current working conversation. */
export function createSlotBookFromWorking(input: {
  messages: Message[];
  meta: NovelConversation;
  name?: string;
}): NovelSlotBook {
  const timestamp = new Date().toISOString();
  const slot = snapshotWorkingToSlot({
    slotId: createNovelSaveSlotId(),
    name: input.name ?? '主线',
    createdAt: timestamp,
    messages: input.messages,
    meta: input.meta,
    updatedAt: timestamp,
  });

  return {
    activeSlotId: slot.id,
    slots: [slot],
    previousSnapshot: null,
  };
}

export function ensureNovelSlotBook(input: {
  book?: NovelSlotBook | null;
  messages?: Message[];
  meta?: NovelConversation | null;
  novelName: string;
}): NovelSlotBook {
  const normalized = normalizeNovelSlotBook(input.book ?? undefined);
  if (normalized) {
    return normalized;
  }

  const timestamp = new Date().toISOString();
  const meta =
    input.meta ??
    normalizeNovelConversation({
      id: 'pending-conversation',
      novelId: 'pending',
      title: input.novelName,
      memory: '',
      longTermMemory: '',
      midTermMemories: [],
      shortTermMemories: [],
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...createDefaultSessionConfigFields(),
    });

  return createSlotBookFromWorking({
    messages: input.messages ?? [],
    meta,
    name: '主线',
  });
}

export function flushActiveSlot(
  book: NovelSlotBook,
  messages: Message[],
  meta: NovelConversation,
  worldChapter?: number,
): NovelSlotBook {
  const timestamp = new Date().toISOString();
  const active = book.slots.find((slot) => slot.id === book.activeSlotId) ?? book.slots[0];

  if (!active) {
    return createSlotBookFromWorking({ messages, meta, name: '主线' });
  }

  const flushed = snapshotWorkingToSlot({
    slotId: active.id,
    worldId: active.worldId,
    worldChapter: worldChapter ?? active.worldChapter,
    name: active.name,
    createdAt: active.createdAt,
    messages,
    meta,
    updatedAt: timestamp,
  });

  return {
    ...book,
    activeSlotId: flushed.id,
    slots: book.slots.map((slot) => (slot.id === flushed.id ? flushed : slot)),
  };
}

/** Migrate missing slot books for every novel that already has a conversation. */
export function migrateNovelSlotBooks(input: {
  novels: { id: string; name: string }[];
  novelConversations: Record<string, Message[]>;
  novelConversationMeta: Record<string, NovelConversation>;
  novelSlotBooks?: Record<string, NovelSlotBook> | null;
}): Record<string, NovelSlotBook> {
  const next: Record<string, NovelSlotBook> = {};
  const existing = input.novelSlotBooks ?? {};

  for (const [novelId, book] of Object.entries(existing)) {
    const normalized = normalizeNovelSlotBook(book);
    if (normalized) {
      next[novelId] = normalized;
    }
  }

  const novelIds = new Set<string>([
    ...input.novels.map((novel) => novel.id),
    ...Object.keys(input.novelConversations),
    ...Object.keys(input.novelConversationMeta),
  ]);

  for (const novelId of novelIds) {
    if (next[novelId]) {
      continue;
    }

    const messages = input.novelConversations[novelId];
    const meta = input.novelConversationMeta[novelId];
    if (!messages && !meta) {
      continue;
    }

    const novelName =
      input.novels.find((novel) => novel.id === novelId)?.name ?? meta?.title ?? '未命名小说';

    next[novelId] = ensureNovelSlotBook({
      messages: messages ?? [],
      meta: meta ?? null,
      novelName,
    });
  }

  return next;
}

export function formatSlotPreview(slot: NovelSaveSlot) {
  const count = slot.messages?.length ?? 0;
  const updated = slot.updatedAt ? new Date(slot.updatedAt) : null;
  const timeLabel =
    updated && !Number.isNaN(updated.getTime())
      ? `${updated.getMonth() + 1}/${updated.getDate()} ${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}`
      : '—';

  return { messageCount: count, timeLabel };
}

const REGRESSION_ECHO_MAX_CHARS = 360;

/**
 * Build a short Re:0-style echo from the live line about to be left behind.
 * Rule-based (no LLM) so load never depends on another model call.
 */
export function buildRegressionEchoFromWorking(input: {
  messages: Message[];
  shortTermMemories?: string[];
}): string {
  const shorts = (input.shortTermMemories ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-3);
  const recentUser = [...input.messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim())?.content.trim();

  const parts: string[] = [];
  if (shorts.length > 0) {
    parts.push(shorts.map((item, index) => `${index + 1}. ${item}`).join('\n'));
  }
  if (recentUser) {
    const clipped =
      recentUser.length > 80 ? `${recentUser.slice(0, 80)}…` : recentUser;
    parts.push(`最近行动：${clipped}`);
  }

  if (parts.length === 0) {
    return '';
  }

  const body = parts.join('\n');
  return body.length <= REGRESSION_ECHO_MAX_CHARS
    ? body
    : `${body.slice(0, REGRESSION_ECHO_MAX_CHARS - 1)}…`;
}
