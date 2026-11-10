import { modelCapabilities, modelIdsEqual } from '../constants/provider-capabilities';
import { catalogEntry, createEmptyProvider, DEFAULT_PROVIDERS } from '../constants/providers';
import { normalizeReplyLengthPreset } from '../constants/reply-length';
import { AI_TASK_IDS, AI_TASKS } from '../constants/ai-tasks';
import type {
  AgentModelBinding,
  ApiSettings,
  GenerationSettings,
  LlmProvider,
  NovelAgentId,
  AiTaskId,
} from '../types/tavern';

const DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS = 32_000;

export function normalizeProvider(provider: Partial<LlmProvider> & Pick<LlmProvider, 'id'>): LlmProvider {
  const contextWindowTokens =
    typeof provider.contextWindowTokens === 'number' && Number.isFinite(provider.contextWindowTokens)
      ? Math.min(200_000, Math.max(4_096, Math.round(provider.contextWindowTokens)))
      : 32_000;
  // 目录身份字段：按 id 补齐 logo/accent/protocol/auth 等品牌信息，
  // 让旧持久化数据也能展示厂商 logo；用户已改的 name/baseUrl/model 不受影响。
  const catalog = catalogEntry(provider.id);
  return {
    id: provider.id,
    name: provider.name || '未命名厂商',
    apiKey: provider.apiKey ?? '',
    baseUrl: provider.baseUrl ?? '',
    selectedModel: provider.selectedModel ?? '',
    fetchedModels: Array.isArray(provider.fetchedModels) ? provider.fetchedModels : [],
    ...(provider.fetchedModelsSource === 'remote' ? { fetchedModelsSource: 'remote' as const } : {}),
    modelSettings:
      provider.modelSettings && typeof provider.modelSettings === 'object'
        ? Object.fromEntries(
            Object.entries(provider.modelSettings)
              .filter(([, value]) => value && typeof value === 'object')
              .map(([modelId, value]) => {
                const row = value as { streamingEnabled?: unknown; thinkingEnabled?: unknown; thinkingParameter?: unknown };
                return [
                  modelId,
                  {
                    ...(typeof row.streamingEnabled === 'boolean'
                      ? { streamingEnabled: row.streamingEnabled }
                      : {}),
                    ...(typeof row.thinkingEnabled === 'boolean'
                      ? { thinkingEnabled: row.thinkingEnabled }
                      : {}),
                    ...(['auto', 'thinking', 'enable_thinking', 'reasoning_effort', 'none'].includes(String(row.thinkingParameter))
                      ? { thinkingParameter: row.thinkingParameter as NonNullable<LlmProvider['modelSettings']>[string]['thinkingParameter'] }
                      : {}),
                  },
                ];
              }),
          )
        : {},
    isActive: Boolean(provider.isActive),
    contextWindowTokens,
    protocol: provider.protocol ?? catalog?.protocol,
    auth: provider.auth ?? catalog?.auth,
    logoMark: provider.logoMark ?? catalog?.logoMark,
    accent: provider.accent ?? catalog?.accent,
    defaultBaseUrl: provider.defaultBaseUrl ?? catalog?.defaultBaseUrl,
  };
}

export function ensureActiveProvider(providers: Record<string, LlmProvider>) {
  const entries = Object.values(providers);

  if (entries.length === 0) {
    return { ...DEFAULT_PROVIDERS };
  }

  const activeCount = entries.filter((provider) => provider.isActive).length;

  if (activeCount === 1) {
    return providers;
  }

  const preferredId = entries.find((provider) => provider.isActive)?.id ?? entries[0].id;

  return Object.fromEntries(
    entries.map((provider) => [
      provider.id,
      {
        ...provider,
        isActive: provider.id === preferredId,
      },
    ]),
  );
}

export function getActiveProvider(providers: Record<string, LlmProvider>) {
  return Object.values(providers).find((provider) => provider.isActive) ?? Object.values(providers)[0];
}

export const defaultGenerationSettings: GenerationSettings = {
  temperature: 0.8,
  /** Higher default to reduce mid-reply cutoffs for novel turns. */
  maxTokens: 20000,
  /** Preserve the current behavior by default; users can opt out of hidden reasoning. */
  thinkingDisabled: false,
  /** Framework / cast AI on create screen — independent from dialogue maxTokens. */
  novelCreateMaxTokens: 8000,
  /** Short/long-term Memory-agent compress / merge requests (capped further in novel-memory). */
  memoryMaxTokens: 512,
  /** Novel txt budget for writing-style extraction (stratified sample). */
  writingStyleSampleMaxChars: 12000,
  /** Empty = use the writing lane's provider/model for background tasks. */
  utilityProviderId: '',
  utilityModelId: '',
  /** Empty = collaboration agents fall back to the background lane. */
  collaborationProviderId: '',
  collaborationModelId: '',
  taskModelBindings: {},
  agentModelBindings: {},
  contextWindowMessages: 20,
  streamingEnabled: true,
  requestTimeoutSeconds: 180,
  requestRetryCount: 1,
  debugPromptInspectorEnabled: true,
  replyLengthPreset: 'normal',
  continuationOnTruncation: false,
};

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeGenerationSettings(
  settings?: Partial<GenerationSettings> | null,
): GenerationSettings {
  const maxTokens =
    typeof settings?.maxTokens === 'number' && settings.maxTokens > 0
      ? Math.round(settings.maxTokens)
      : defaultGenerationSettings.maxTokens;
  const novelCreateMaxTokens =
    typeof settings?.novelCreateMaxTokens === 'number' && settings.novelCreateMaxTokens > 0
      ? Math.round(settings.novelCreateMaxTokens)
      : defaultGenerationSettings.novelCreateMaxTokens;
  const memoryMaxTokens =
    typeof settings?.memoryMaxTokens === 'number' && settings.memoryMaxTokens > 0
      ? Math.round(settings.memoryMaxTokens)
      : defaultGenerationSettings.memoryMaxTokens;
  const writingStyleSampleMaxChars = clampInt(
    settings?.writingStyleSampleMaxChars,
    defaultGenerationSettings.writingStyleSampleMaxChars,
    2000,
    100_000,
  );
  const legacyAgentModelBindings = normalizeAgentModelBindings(settings?.agentModelBindings);
  const legacyCollaborationBinding =
    legacyAgentModelBindings.direct ??
    legacyAgentModelBindings.character ??
    legacyAgentModelBindings.editor;
  const legacyBackgroundBinding = legacyAgentModelBindings.memory;
  const collaborationProviderId =
    normalizeLaneId(settings?.collaborationProviderId) || legacyCollaborationBinding?.providerId || '';
  const collaborationModelId =
    normalizeLaneId(settings?.collaborationModelId) || legacyCollaborationBinding?.modelId || '';
  const utilityProviderId =
    normalizeLaneId(settings?.utilityProviderId) || legacyBackgroundBinding?.providerId || '';
  const utilityModelId =
    normalizeLaneId(settings?.utilityModelId) || legacyBackgroundBinding?.modelId || '';
  const taskModelBindings = normalizeTaskModelBindings(settings?.taskModelBindings);

  return {
    temperature:
      typeof settings?.temperature === 'number' && Number.isFinite(settings.temperature)
        ? settings.temperature
        : defaultGenerationSettings.temperature,
    maxTokens,
    thinkingDisabled:
      typeof settings?.thinkingDisabled === 'boolean'
        ? settings.thinkingDisabled
        : defaultGenerationSettings.thinkingDisabled,
    novelCreateMaxTokens,
    memoryMaxTokens,
    writingStyleSampleMaxChars,
    utilityProviderId,
    utilityModelId,
    collaborationProviderId,
    collaborationModelId,
    taskModelBindings,
    // Legacy per-agent assignments are deliberately normalized away; task routes
    // are stored separately in taskModelBindings.
    agentModelBindings: {},
    contextWindowMessages:
      typeof settings?.contextWindowMessages === 'number' && settings.contextWindowMessages > 0
        ? Math.round(settings.contextWindowMessages)
        : defaultGenerationSettings.contextWindowMessages,
    streamingEnabled:
      typeof settings?.streamingEnabled === 'boolean'
        ? settings.streamingEnabled
        : defaultGenerationSettings.streamingEnabled,
    requestTimeoutSeconds: clampInt(
      settings?.requestTimeoutSeconds,
      defaultGenerationSettings.requestTimeoutSeconds,
      15,
      600,
    ),
    requestRetryCount: clampInt(
      settings?.requestRetryCount,
      defaultGenerationSettings.requestRetryCount,
      0,
      5,
    ),
    debugPromptInspectorEnabled:
      typeof settings?.debugPromptInspectorEnabled === 'boolean'
        ? settings.debugPromptInspectorEnabled
        : defaultGenerationSettings.debugPromptInspectorEnabled,
    replyLengthPreset: normalizeReplyLengthPreset(
      settings?.replyLengthPreset ?? defaultGenerationSettings.replyLengthPreset,
    ),
    continuationOnTruncation:
      typeof settings?.continuationOnTruncation === 'boolean'
        ? settings.continuationOnTruncation
        : defaultGenerationSettings.continuationOnTruncation,
  };
}

export function normalizeTaskModelBindings(
  bindings?: Partial<Record<AiTaskId, AgentModelBinding>> | null,
): Partial<Record<AiTaskId, AgentModelBinding>> {
  const result: Partial<Record<AiTaskId, AgentModelBinding>> = {};
  for (const task of AI_TASK_IDS) {
    const value = bindings?.[task];
    if (value && typeof value.providerId === 'string' && value.providerId.trim() && typeof value.modelId === 'string' && value.modelId.trim()) {
      result[task] = { providerId: value.providerId.trim(), modelId: value.modelId.trim() };
    }
  }
  return result;
}

function normalizeLaneId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentModelBindings(
  bindings?: Partial<Record<NovelAgentId, AgentModelBinding>> | null,
): Partial<Record<NovelAgentId, AgentModelBinding>> {
  if (!bindings || typeof bindings !== 'object') return {};

  const allowed: NovelAgentId[] = ['direct', 'character', 'narrator', 'editor', 'memory'];
  return Object.fromEntries(
    allowed.flatMap((agentId) => {
      const value = bindings[agentId];
      if (!value || typeof value !== 'object') return [];
      const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
      const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
      if (!providerId && !modelId) return [];
      return [[agentId, { providerId, modelId } satisfies AgentModelBinding]];
    }),
  ) as Partial<Record<NovelAgentId, AgentModelBinding>>;
}

export function resolveApiSettings(
  providers: Record<string, LlmProvider>,
  generationSettings: GenerationSettings,
  preference?: {
    preferredModelId?: string;
    preferredProviderId?: string;
    /** utility = create AI / suggested routes (background lane). */
    purpose?: 'chat' | 'utility' | 'collaboration' | 'agent';
    task?: AiTaskId;
  },
): ApiSettings {
  const normalized = normalizeGenerationSettings(generationSettings);

  const activeProvider = getActiveProvider(providers);

  if (!activeProvider) {
    throw new Error('请先在系统设置中添加至少一个模型厂商。');
  }

  let preferredModelId = preference?.preferredModelId?.trim() || '';
  let preferredProviderId = preference?.preferredProviderId?.trim() || '';

  const taskBinding = preference?.task ? normalized.taskModelBindings?.[preference.task] : undefined;

  if (
    preference?.purpose === 'utility' ||
    preference?.purpose === 'collaboration' ||
    preference?.purpose === 'agent'
  ) {
    const lane =
      preference.purpose === 'collaboration'
        ? {
            providerId: normalized.collaborationProviderId,
            modelId: normalized.collaborationModelId,
          }
        : {
            providerId: normalized.utilityProviderId,
            modelId: normalized.utilityModelId,
          };
    const fallbackLane =
      preference.purpose === 'collaboration'
        ? {
            providerId: normalized.utilityProviderId,
            modelId: normalized.utilityModelId,
          }
        : undefined;
    const selectedLane = lane.modelId || lane.providerId ? lane : fallbackLane;
    if (selectedLane && (selectedLane.modelId || selectedLane.providerId)) {
      preferredModelId = selectedLane.modelId || preferredModelId;
      preferredProviderId = selectedLane.providerId || preferredProviderId;
    }
  }

  // A function-specific route always wins over the shared purpose lane.
  if (taskBinding) {
    if (!providers[taskBinding.providerId]) {
      throw new Error(`“${AI_TASKS[preference!.task!].label}”绑定的模型厂商已不存在，请重新选择模型。`);
    }
    preferredProviderId = taskBinding.providerId;
    preferredModelId = taskBinding.modelId;
  }

  const preferredProvider =
    (preferredProviderId ? providers[preferredProviderId] : undefined) ??
    (preferredModelId
      ? Object.values(providers).find(
          (provider) =>
            provider.fetchedModels.some((model) => modelIdsEqual(model, preferredModelId)) ||
            modelIdsEqual(provider.selectedModel, preferredModelId),
        )
      : undefined);

  const resolvedProvider = preferredProvider ?? activeProvider;
  const resolvedModel =
    preferredModelId || resolvedProvider.selectedModel || activeProvider.selectedModel;
  const capability = modelCapabilities(resolvedProvider.id, resolvedModel);
  const modelPreference = Object.entries(resolvedProvider.modelSettings ?? {}).find(([modelId]) =>
    modelIdsEqual(modelId, resolvedModel),
  )?.[1];
  const streamingEnabled =
    capability.streaming === 'unsupported'
      ? false
      : preference?.purpose === 'chat'
        ? true
        : modelPreference?.streamingEnabled ?? normalized.streamingEnabled;
  const thinkingConfigured = typeof modelPreference?.thinkingEnabled === 'boolean';
  const backgroundPurpose = preference?.purpose === 'utility' ||
    preference?.purpose === 'collaboration' || preference?.purpose === 'agent';
  const thinkingDisabled = thinkingConfigured
    ? !modelPreference.thinkingEnabled
    : backgroundPurpose
      ? true
      : capability.reasoning === 'always'
        ? false
        : normalized.thinkingDisabled;

  return {
    baseUrl: resolvedProvider.baseUrl,
    apiKey: resolvedProvider.apiKey,
    model: resolvedModel,
    providerId: resolvedProvider.id,
    providerName: resolvedProvider.name,
    protocol: resolvedProvider.protocol,
    auth: resolvedProvider.auth,
    modelCapability: capability,
    temperature: normalized.temperature,
    maxTokens: normalized.maxTokens,
    contextWindowTokens:
      resolvedProvider.contextWindowTokens ?? DEFAULT_PROVIDER_CONTEXT_WINDOW_TOKENS,
    contextWindowMessages: normalized.contextWindowMessages,
    streamingEnabled,
    requestTimeoutMs: normalized.requestTimeoutSeconds * 1000,
    requestRetryCount: normalized.requestRetryCount,
    debugPromptInspectorEnabled: normalized.debugPromptInspectorEnabled,
    replyLengthPreset: normalized.replyLengthPreset,
    continuationOnTruncation: normalized.continuationOnTruncation,
    // Side jobs default to plain output; an explicit model setting can override that default.
    thinkingDisabled,
    thinkingConfigured,
    thinkingParameter: modelPreference?.thinkingParameter,
  };
}

/**
 * Resolve the actual Provider/model used by one novel workflow agent.
 * Each agent uses its function's fixed model when configured. Without a task
 * binding, Narrator follows the writing default, Direct/Character/Editor use
 * collaboration, and Memory uses the background default. Legacy per-agent
 * assignments are migrated by normalizeGenerationSettings.
 */
export function resolveAgentApiSettings(
  providers: Record<string, LlmProvider>,
  generationSettings: GenerationSettings,
  agentId: NovelAgentId,
  _legacyNovelPreference?: {
    preferredModelId?: string;
    preferredProviderId?: string;
  },
): ApiSettings {
  const normalized = normalizeGenerationSettings(generationSettings);
  const isNarrator = agentId === 'narrator';
  const isCollaborationAgent =
    agentId === 'direct' || agentId === 'character' || agentId === 'editor';

  return resolveApiSettings(providers, normalized, {
    purpose: isNarrator ? 'chat' : isCollaborationAgent ? 'collaboration' : 'utility',
    task: isNarrator ? 'chat' : agentId === 'memory' ? 'memory' : agentId === 'character' ? 'character' : agentId === 'editor' ? 'review' : 'outline',
  });
}

export function migrateLegacyApiSettings(legacy: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowMessages?: number;
  streamingEnabled?: boolean;
}): {
  providers: Record<string, LlmProvider>;
  generationSettings: GenerationSettings;
} {
  const providerId = legacy.provider?.trim() || 'deepseek';
  const seed = DEFAULT_PROVIDERS[providerId] ?? createEmptyProvider({ id: providerId, name: providerId });
  const providers = ensureActiveProvider({
    ...DEFAULT_PROVIDERS,
    [providerId]: {
      ...seed,
      id: providerId,
      name: seed.name || providerId,
      apiKey: legacy.apiKey ?? '',
      baseUrl: legacy.baseUrl || seed.baseUrl,
      selectedModel: legacy.model || seed.selectedModel,
      fetchedModels: seed.fetchedModels,
      ...(seed.fetchedModelsSource === 'remote' ? { fetchedModelsSource: 'remote' as const } : {}),
      isActive: true,
    },
  });

  return {
    providers,
    generationSettings: normalizeGenerationSettings({
      temperature: legacy.temperature ?? defaultGenerationSettings.temperature,
      maxTokens: legacy.maxTokens ?? defaultGenerationSettings.maxTokens,
      contextWindowMessages:
        legacy.contextWindowMessages ?? defaultGenerationSettings.contextWindowMessages,
      streamingEnabled: legacy.streamingEnabled ?? defaultGenerationSettings.streamingEnabled,
    }),
  };
}
