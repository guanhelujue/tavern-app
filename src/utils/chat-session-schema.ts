import type { ChatSessionKind } from '@/constants/session-config';
import type { ChatSessionExportBundle } from '@/utils/chat-session-io';
import type {
  Message,
  Novel,
  NovelCharacterBiography,
  NovelConversation,
  NovelSaveSlot,
  NovelSlotBook,
} from '@/types/tavern';

export const CHAT_IMPORT_LIMITS = {
  maxBytes: 12 * 1024 * 1024,
  maxMessages: 20_000,
  maxMessageChars: 500_000,
  maxMemoryItems: 2_000,
  maxMemoryChars: 100_000,
  maxConfigChars: 200_000,
  maxWorldbookEntries: 2_000,
  maxBiographyCharacters: 2_000,
  maxBiographiesPerCharacter: 10_000,
  maxBiographyChars: 500_000,
} as const;

const CHAT_KINDS: readonly ChatSessionKind[] = ['novel'];
const MESSAGE_ROLES = new Set(['user', 'assistant']);
const MESSAGE_STATUSES = new Set(['complete', 'streaming', 'cancelled', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxChars: number = CHAT_IMPORT_LIMITS.maxConfigChars,
  allowEmpty = false,
) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`导入文件字段「${field}」无效。`);
  }
  if (value.length > maxChars) {
    throw new Error(`导入文件字段「${field}」超过长度限制。`);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxChars: number = CHAT_IMPORT_LIMITS.maxConfigChars,
) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maxChars) {
    throw new Error(`导入文件字段「${field}」无效或过长。`);
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`导入文件字段「${field}」必须是数组。`);
  }
  if (value.length > maxItems) {
    throw new Error(`导入文件字段「${field}」条目过多。`);
  }
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (strings.some((item) => item.length > maxChars)) {
    throw new Error(`导入文件字段「${field}」包含过长条目。`);
  }
  return strings;
}

function validateWorldbookEntries(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > CHAT_IMPORT_LIMITS.maxWorldbookEntries) {
    throw new Error('导入文件世界书条目数量无效。');
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    if (
      typeof entry.id !== 'string' ||
      typeof entry.keys !== 'string' ||
      typeof entry.content !== 'string' ||
      typeof entry.enabled !== 'boolean'
    ) {
      return [];
    }
    if (entry.id.length > 512 || entry.keys.length > CHAT_IMPORT_LIMITS.maxConfigChars || entry.content.length > CHAT_IMPORT_LIMITS.maxConfigChars) {
      throw new Error('导入文件世界书条目过长。');
    }
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 32)
      : [];
    const maxInjectionTokens =
      typeof entry.maxInjectionTokens === 'number' && Number.isFinite(entry.maxInjectionTokens)
        ? Math.min(100_000, Math.max(256, Math.round(entry.maxInjectionTokens)))
        : undefined;
    return [
      {
        id: entry.id,
        keys: entry.keys,
        content: entry.content,
        enabled: entry.enabled,
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(typeof entry.priority === 'number' && Number.isFinite(entry.priority)
          ? { priority: Math.round(entry.priority) }
          : {}),
        ...(typeof entry.combinationKey === 'string' && entry.combinationKey.trim()
          ? { combinationKey: entry.combinationKey.trim().slice(0, 256) }
          : {}),
        ...(maxInjectionTokens ? { maxInjectionTokens } : {}),
        ...(entry.stale === true ? { stale: true } : {}),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
      },
    ];
  });
}

function validateMessage(value: unknown, index: number, sessionId: string): Message {
  if (!isRecord(value)) {
    throw new Error(`导入文件第 ${index + 1} 条消息不是对象。`);
  }
  const id = requiredString(value.id, `messages[${index}].id`, 512);
  const role = value.role;
  if (typeof value.content !== 'string') {
    throw new Error(`导入文件第 ${index + 1} 条消息内容无效。`);
  }
  const content = value.content;
  const status = value.status;
  if (!MESSAGE_ROLES.has(String(role)) || !MESSAGE_STATUSES.has(String(status))) {
    throw new Error(`导入文件第 ${index + 1} 条消息的角色或状态无效。`);
  }
  if (content.length > CHAT_IMPORT_LIMITS.maxMessageChars) {
    throw new Error(`导入文件第 ${index + 1} 条消息内容过长。`);
  }
  const createdAt = requiredString(value.createdAt, `messages[${index}].createdAt`, 128);
  const updatedAt = requiredString(value.updatedAt, `messages[${index}].updatedAt`, 128);
  const optionalNumber = (field: string) => {
    const candidate = value[field];
    if (candidate === undefined || candidate === null) {
      return undefined;
    }
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
      throw new Error(`导入文件第 ${index + 1} 条消息的 ${field} 无效。`);
    }
    return candidate;
  };

  return {
    id,
    characterId: typeof value.characterId === 'string' && value.characterId ? value.characterId : sessionId,
    worldId: typeof value.worldId === 'string' && value.worldId ? value.worldId : undefined,
    role: role as 'user' | 'assistant',
    content,
    reasoningContent: optionalString(
      value.reasoningContent,
      `messages[${index}].reasoningContent`,
      CHAT_IMPORT_LIMITS.maxMessageChars,
    ),
    status: status as Message['status'],
    swipes: stringArray(value.swipes, `messages[${index}].swipes`, 32, CHAT_IMPORT_LIMITS.maxMessageChars),
    swipeIndex: optionalNumber('swipeIndex'),
    isGreeting: typeof value.isGreeting === 'boolean' ? value.isGreeting : undefined,
    promptTokens: optionalNumber('promptTokens'),
    completionTokens: optionalNumber('completionTokens'),
    modelId: optionalString(value.modelId, `messages[${index}].modelId`, 512),
    createdAt,
    updatedAt,
  };
}

function validateNovelBackup(value: unknown): Novel {
  if (!isRecord(value)) {
    throw new Error('导入文件的 novel 字段无效。');
  }

  const id = requiredString(value.id, 'novel.id', 256);
  const name = requiredString(value.name, 'novel.name', 1_000);
  const createdAt = requiredString(value.createdAt, 'novel.createdAt', 128);
  const updatedAt = requiredString(value.updatedAt, 'novel.updatedAt', 128);

  for (const field of ['cast', 'characterDossiers', 'loreEntries', 'chapters']) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new Error(`导入文件的 novel.${field} 必须是数组。`);
    }
  }

  if (value.outline !== undefined && !isRecord(value.outline)) {
    throw new Error('导入文件的 novel.outline 无效。');
  }

  return {
    ...value,
    id,
    name,
    createdAt,
    updatedAt,
  } as Novel;
}

function validateCharacterBiographies(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new Error('导入文件的 characterBiographies 字段无效。');
  }
  const rows = Object.entries(value);
  if (rows.length > CHAT_IMPORT_LIMITS.maxBiographyCharacters) {
    throw new Error('导入文件中的小传角色数量过多。');
  }
  const result: Record<string, NovelCharacterBiography[]> = {};
  for (const [characterId, entries] of rows) {
    if (!characterId.trim() || !Array.isArray(entries)) {
      throw new Error('导入文件中的人物小传集合无效。');
    }
    if (entries.length > CHAT_IMPORT_LIMITS.maxBiographiesPerCharacter) {
      throw new Error(`角色 ${characterId} 的人物小传数量过多。`);
    }
    result[characterId] = entries.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`角色 ${characterId} 的第 ${index + 1} 篇小传无效。`);
      }
      return {
        id: requiredString(entry.id, 'biography.id', 512),
        title: requiredString(entry.title, 'biography.title', 10_000),
        request: requiredString(
          entry.request,
          'biography.request',
          CHAT_IMPORT_LIMITS.maxBiographyChars,
          true,
        ),
        content: requiredString(
          entry.content,
          'biography.content',
          CHAT_IMPORT_LIMITS.maxBiographyChars,
        ),
        createdAt: requiredString(entry.createdAt, 'biography.createdAt', 128),
        updatedAt: requiredString(entry.updatedAt, 'biography.updatedAt', 128),
      };
    });
  }
  return result;
}

const RUNTIME_METADATA = new Set(['activeRequestId', 'requestStatus', 'agentStage', 'isSuggestingRoutes']);

function validateMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error('导入文件配置元数据嵌套过深。');
  if (typeof value === 'string') {
    if (value.length > CHAT_IMPORT_LIMITS.maxConfigChars) throw new Error('导入文件配置元数据过长。');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > CHAT_IMPORT_LIMITS.maxMemoryItems) throw new Error('导入文件配置元数据条目过多。');
    return value.map((item) => validateMetadataValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > CHAT_IMPORT_LIMITS.maxMemoryItems) throw new Error('导入文件配置元数据字段过多。');
    return Object.fromEntries(entries.map(([key, item]) => [key, validateMetadataValue(item, depth + 1)]));
  }
  throw new Error('导入文件配置元数据无效。');
}

function validateConversationMetadata(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (RUNTIME_METADATA.has(key) || ['contextLength', 'mainPrompt', 'prefix', 'suffix', 'worldbookEntries', 'backgroundEnabled', 'bubbleOpacity', 'memory'].includes(key)) continue;
    if (candidate !== undefined) result[key] = validateMetadataValue(candidate);
  }
  return result;
}

function validateSlotBook(value: unknown, sessionId: string): NovelSlotBook {
  if (!isRecord(value) || typeof value.activeSlotId !== 'string' || !Array.isArray(value.slots)) {
    throw new Error('导入文件 worldSessions.slotBook 无效。');
  }
  if (value.slots.length === 0) throw new Error('导入文件存档槽不能为空。');
  if (value.slots.length > CHAT_IMPORT_LIMITS.maxMemoryItems) throw new Error('导入文件存档槽数量过多。');
  const slotIds = new Set<string>();
  const validateSlot = (slot: unknown): NovelSaveSlot => {
    if (!isRecord(slot) || typeof slot.id !== 'string' || typeof slot.name !== 'string' || !Array.isArray(slot.messages)) {
      throw new Error('导入文件存档槽无效。');
    }
    if (slotIds.has(slot.id)) throw new Error(`导入文件存档槽 ID 重复：${slot.id}。`);
    slotIds.add(slot.id);
    if (slot.snapshotVersion !== undefined && slot.snapshotVersion !== 1) {
      throw new Error('导入文件存档槽版本无效。');
    }
    const messages = validateMessages(slot.messages, sessionId);
    const parsed = parseChatSessionExportBundle({
      version: 5,
      kind: 'novel',
      sessionId,
      exportedAt: String(slot.updatedAt ?? ''),
      title: slot.name,
      config: slot,
      messages: [],
    });
    return { ...slot, ...parsed.config, id: slot.id, name: slot.name, messages } as NovelSaveSlot;
  };
  if (!value.slots.some((slot) => isRecord(slot) && slot.id === value.activeSlotId)) {
    throw new Error('导入文件当前存档槽无效。');
  }
  return {
    ...value,
    activeSlotId: value.activeSlotId,
    slots: value.slots.map(validateSlot),
    previousSnapshot: value.previousSnapshot === null || value.previousSnapshot === undefined
      ? null
      : validateSlot(value.previousSnapshot),
  } as NovelSlotBook;
}

function validateMessages(value: unknown[], sessionId: string, worldId?: string): Message[] {
  if (value.length > CHAT_IMPORT_LIMITS.maxMessages) throw new Error('导入文件消息数量超过限制。');
  const ids = new Set<string>();
  return value.map((message, index) => {
    const parsed = validateMessage(message, index, sessionId);
    if (ids.has(parsed.id)) throw new Error(`导入文件消息 ID 重复：${parsed.id}。`);
    ids.add(parsed.id);
    if (worldId && parsed.worldId && parsed.worldId !== worldId) throw new Error('导入文件消息所属世界无效。');
    return parsed;
  });
}

export function parseChatSessionExportBundle(raw: unknown): ChatSessionExportBundle {
  if (!isRecord(raw)) {
    throw new Error('导入文件必须是 JSON 对象。');
  }
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5) {
    throw new Error('导入文件版本无效，仅支持 v1/v2/v3/v4/v5。');
  }
  if (!CHAT_KINDS.includes(raw.kind as ChatSessionKind)) {
    throw new Error('导入文件会话类型无效。');
  }

  const sessionId = requiredString(raw.sessionId, 'sessionId', 256);
  const title = requiredString(raw.title, 'title', 1_000);
  const exportedAt = requiredString(raw.exportedAt, 'exportedAt', 128);
  if (!Array.isArray(raw.messages)) {
    throw new Error('导入文件字段「messages」必须是数组。');
  }
  if (raw.messages.length > CHAT_IMPORT_LIMITS.maxMessages) {
    throw new Error('导入文件消息数量超过限制。');
  }
  if (!isRecord(raw.config)) {
    throw new Error('导入文件缺少有效的 config 配置。');
  }

  const config = raw.config;
  const contextLength = config.contextLength;
  if (typeof contextLength !== 'number' || !Number.isFinite(contextLength)) {
    throw new Error('导入文件配置的 contextLength 无效。');
  }
  const mainPrompt = requiredString(config.mainPrompt, 'config.mainPrompt', CHAT_IMPORT_LIMITS.maxConfigChars, true);
  const prefix = requiredString(config.prefix, 'config.prefix', CHAT_IMPORT_LIMITS.maxConfigChars, true);
  const suffix = requiredString(config.suffix, 'config.suffix', CHAT_IMPORT_LIMITS.maxConfigChars, true);
  const memory = requiredString(config.memory, 'config.memory', CHAT_IMPORT_LIMITS.maxMemoryChars, true);
  if (!Array.isArray(config.worldbookEntries)) {
    throw new Error('导入文件字段「config.worldbookEntries」必须是数组。');
  }
  const worldbookEntries = validateWorldbookEntries(config.worldbookEntries);
  const boundGlobalWorldbookIds =
    config.boundGlobalWorldbookIds === undefined
      ? undefined
      : stringArray(
          config.boundGlobalWorldbookIds,
          'config.boundGlobalWorldbookIds',
          CHAT_IMPORT_LIMITS.maxWorldbookEntries,
          512,
        );
  const midTermMemories = stringArray(
    config.midTermMemories,
    'config.midTermMemories',
    CHAT_IMPORT_LIMITS.maxMemoryItems,
    CHAT_IMPORT_LIMITS.maxMemoryChars,
  );
  const shortTermMemories = stringArray(
    config.shortTermMemories,
    'config.shortTermMemories',
    CHAT_IMPORT_LIMITS.maxMemoryItems,
    CHAT_IMPORT_LIMITS.maxMemoryChars,
  );

  if (typeof config.backgroundEnabled !== 'boolean' || typeof config.bubbleOpacity !== 'number') {
    throw new Error('导入文件配置字段类型无效。');
  }

  return {
    version: raw.version,
    kind: raw.kind as ChatSessionKind,
    sessionId,
    exportedAt,
    title,
    config: {
      ...validateConversationMetadata(config),
      contextLength,
      mainPrompt,
      prefix,
      suffix,
      worldbookEntries,
      ...(boundGlobalWorldbookIds === undefined ? {} : { boundGlobalWorldbookIds }),
      backgroundEnabled: config.backgroundEnabled,
      bubbleOpacity: config.bubbleOpacity,
      memory,
      longTermMemory: optionalString(config.longTermMemory, 'config.longTermMemory'),
      midTermMemories,
      shortTermMemories,
    },
    messages: validateMessages(raw.messages, sessionId),
    ...((raw.version === 3 || raw.version === 4 || raw.version === 5) && raw.novel !== undefined
      ? { novel: validateNovelBackup(raw.novel) }
      : {}),
    ...((raw.version === 4 || raw.version === 5)
      ? { characterBiographies: validateCharacterBiographies(raw.characterBiographies) ?? {} }
      : {}),
    ...(raw.version === 5 && raw.worldSessions !== undefined
      ? {
          worldSessions: validateWorldSessions(raw.worldSessions, sessionId),
        }
      : {}),
  };
}

function validateWorldSessions(value: unknown, sessionId: string) {
  if (!isRecord(value)) throw new Error('导入文件 worldSessions 字段无效。');
  const rows = Object.entries(value);
  if (rows.length > CHAT_IMPORT_LIMITS.maxBiographyCharacters) throw new Error('导入文件世界会话数量过多。');
  const result: NonNullable<ChatSessionExportBundle['worldSessions']> = {};
  for (const [worldId, rawSession] of rows) {
    if (!worldId.trim() || !isRecord(rawSession) || !Array.isArray(rawSession.messages) || !isRecord(rawSession.meta)) {
      throw new Error(`导入文件世界会话「${worldId}」无效。`);
    }
    const messages = validateMessages(rawSession.messages, sessionId, worldId);
    const parsedMeta = parseChatSessionExportBundle({
      version: 5,
      kind: 'novel',
      sessionId,
      exportedAt: String(rawSession.meta.updatedAt ?? ''),
      title: typeof rawSession.meta.title === 'string' ? rawSession.meta.title : '',
      config: rawSession.meta,
      messages: [],
    }).config;
    const meta = parsedMeta as unknown as NovelConversation;
    if (
      typeof rawSession.meta.id !== 'string' ||
      typeof rawSession.meta.novelId !== 'string' ||
      typeof rawSession.meta.title !== 'string' ||
      typeof rawSession.meta.createdAt !== 'string' ||
      typeof rawSession.meta.updatedAt !== 'string' ||
      typeof rawSession.meta.memory !== 'string' ||
      typeof rawSession.meta.longTermMemory !== 'string' ||
      !Array.isArray(rawSession.meta.midTermMemories) ||
      !Array.isArray(rawSession.meta.shortTermMemories) ||
      typeof rawSession.meta.lastMessageAt !== 'string'
    ) {
      throw new Error(`导入文件世界会话「${worldId}」元数据无效。`);
    }
    result[worldId] = {
      messages,
      meta: meta as NovelConversation,
      ...(rawSession.slotBook === undefined ? {} : { slotBook: validateSlotBook(rawSession.slotBook, sessionId) }),
    };
  }
  return result;
}
