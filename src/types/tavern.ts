import type { ContentBanFlags } from '@/constants/content-bans';
import type { ContentScalePreset } from '@/constants/content-scale';
import type { NovelLoreCollection, NovelLoreTypeId } from '@/constants/novel-lore';
import type { ReplyLengthPreset } from '@/constants/reply-length';
import type { ModelCapability } from '@/constants/provider-capabilities';
import type { CharacterAiSummary, CharacterDossierV2 } from '@/types/character-dossier-v2';
import type {
  QuickTravelArchive,
} from './quick-travel';

export type { ContentBanFlags, ContentScalePreset, NovelLoreCollection, NovelLoreTypeId, ReplyLengthPreset };
export type {
  OriginalPlot,
  OriginalPlotBeat,
  QuickTravelArchive,
  QuickTravelConfig,
  WorldDeviation,
  WorldPack,
  WorldRuntimeState,
  WorldSettlement,
} from './quick-travel';

export type ISODateString = string;

export type EntityTimestamps = {
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type WorldbookEntry = {
  id: string;
  keys: string | string[];
  content: string;
  enabled: boolean;
  aliases?: string[];
  priority?: number;
  combinationKey?: string;
  maxInjectionTokens?: number;
  stale?: boolean;
  lastMatchReason?: string;
} & EntityTimestamps;

export type CreateWorldbookEntryInput = Pick<WorldbookEntry, 'keys' | 'content' | 'enabled'>;

export type ContextSettings = {
  globalSystemPrompt: string;
  authorsNote: string;
  jailbreak: string;
};

export type ChatRole = 'user' | 'assistant';

export type MessageStatus = 'complete' | 'streaming' | 'cancelled' | 'error';

export type Message = {
  id: string;
  characterId: string;
  /** Origin world, retained in portable backups and full-history reads. */
  worldId?: string;
  role: ChatRole;
  content: string;
  /** Provider-returned thinking trace, stored separately and excluded from story context. */
  reasoningContent?: string;
  status: MessageStatus;
  /** Alternate assistant (or greeting) versions; active slot is swipeIndex. */
  swipes?: string[];
  /** Index into swipes; defaults to last. */
  swipeIndex?: number;
  /** True for the opening greeting message. */
  isGreeting?: boolean;
  /** Prompt / input tokens reported by the model usage object. */
  promptTokens?: number;
  /** Completion / output tokens reported by the model usage object. */
  completionTokens?: number;
  /** Model id that produced this assistant reply (for per-model usage). */
  modelId?: string;
} & EntityTimestamps;

export type ChatMessage = Message;

/** Per-session custom prompt / worldbook / memory window. */
export type SessionCustomConfig = {
  /** Sliding history size (message count), typically 2–20. */
  contextLength: number;
  mainPrompt: string;
  prefix: string;
  suffix: string;
  worldbookEntries: WorldbookEntry[];
  /**
   * Optional bind to global worldbook entry ids.
   * - undefined: use all global entries (legacy)
   * - []: disable global worldbook for this session
   * - non-empty: only these global ids
   */
  boundGlobalWorldbookIds?: string[];
  backgroundEnabled: boolean;
  bubbleOpacity: number;
  /**
   * @deprecated Legacy short/normal/long setting kept for old imports only.
   */
  replyLengthPreset?: ReplyLengthPreset | null;
};

/** Per-novel-session toggles for optional core-memory blocks (P2). */
export type NovelInjectionToggles = {
  systemPrompt: boolean;
  writingStyle: boolean;
  gameRules: boolean;
  /** Inject protagonist and character-card details into the writing context. */
  characterCards: boolean;
  /** Inject world setting, lore cards, and global worldbook matches. */
  worldCards: boolean;
};

export type NovelConversation = {
  id: string;
  novelId: string;
  title: string;
  memory: string;
  /** Accumulated long-term story summary (8-5-1 top tier). */
  longTermMemory: string;
  /** Hidden summary supplied only to Direct / Character agents. */
  agentSummary?: string;
  /** Mid-term (过往) memory entries; cleared after merge into long-term. */
  midTermMemories: string[];
  /** Recent short-term (近期) memory entries; cleared after merge into mid-term. */
  shortTermMemories: string[];
  /** Derived memories require regeneration after their source chapter changes. */
  memoryStale?: boolean;
  lastMessageAt: ISODateString;
  /** Up to 4 next-route suggestions parsed from the latest assistant reply (when novel.autoSuggestRoutes). */
  suggestedRoutes?: string[];
  /** @deprecated Routes come from the main reply; kept for session IO compatibility. */
  isSuggestingRoutes?: boolean;
  /** Which optional core blocks to inject this session (default all on). */
  injectionToggles?: NovelInjectionToggles;
  /** Last failed auto memory-compress reason (cleared on success). */
  lastMemoryError?: string;
  /**
   * Assistant message id that produced the latest short-term memory entry.
   * Used to roll back that entry when regenerating / resubmitting the same turn.
   */
  lastShortTermMemoryMessageId?: string;
  /** Assistant message id that produced the latest hidden agent summary. */
  lastAgentSummaryMessageId?: string;
  /** Summary value from before the latest summarized turn, for regeneration rollback. */
  lastAgentSummarySnapshot?: string;
  /**
   * Assistant message id that last overwrote character 本幕草稿.
   * Paired with lastExperienceDraftSnapshot for regenerate rollback.
   */
  lastExperienceDraftMessageId?: string;
  /**
   * Pre-turn experienceDraft values for dossiers touched by the last post-turn update.
   * Keyed by dossier id; empty string means the draft was empty before that turn.
   */
  lastExperienceDraftSnapshot?: Record<string, string>;
  /** recentSceneDossierIds before the last post-turn experience update. */
  lastExperienceDraftRecentIdsSnapshot?: string[];
  /**
   * Dossier ids mentioned during the current scene (knowledge base only).
   * Cleared when the scene ends (keyword or manual「本幕结束」).
   */
  recentSceneDossierIds?: string[];
  /**
   * Optional Re:0-style meta knowledge carried when loading a memory point with echo.
   * Injected as【回归残响】; not shared across novels; cleared on plain load.
   */
  regressionEcho?: string;
  /**
   * Current chapter title auto-detected from user input (e.g.「第5章：远征军出发」).
   * Injected into the system prompt so the model stays on the right chapter.
   */
  currentChapter?: string;
  /**
   * When false: skip 8-5-1 memory compress & memory injection entirely.
   * Default true. Users can toggle off for extras / non-canon side stories.
   */
  memorySystemEnabled?: boolean;
  /** Runtime-only state for the active generation request. */
  activeRequestId?: string;
  requestStatus?: 'idle' | 'streaming' | 'cancelling' | 'error';
  requestCommitStatus?: 'idle' | 'pending' | 'committed' | 'commit_failed';
  lastCommitError?: string;
  /** Current stage of an optional multi-agent collaboration run. */
  agentStage?: NovelAgentStage;
  /** Latest planner hand-off, kept for transparency and troubleshooting. */
  lastDirectPlan?: NovelDirectPlan;
  /** Non-fatal planner failure; Narrator may continue without the hand-off. */
  lastDirectAgentError?: string;
  /** Latest character-role brief, kept for transparency and troubleshooting. */
  lastCharacterBrief?: NovelCharacterBrief;
  /** Non-fatal character-agent failure; Narrator may continue without the brief. */
  lastCharacterAgentError?: string;
  /** Latest Editor review, kept for transparency and troubleshooting. */
  lastEditorReview?: NovelEditorReview;
  /** Non-fatal Editor failure; the original Narrator draft remains usable. */
  lastEditorAgentError?: string;
  contextStateVersion?: number;
  contextManifest?: {
    budgetTokens: number;
    estimatedTokens: number;
    selected: string[];
    clipped: string[];
    staleExcluded: string[];
  };
  lastRequestError?: string;
} & SessionCustomConfig &
  EntityTimestamps;

/**
 * Hard memory-point snapshot for a novel.
 * World/cast settings stay on Novel; chat progress + per-line memory live here.
 */
export type NovelSaveSlot = {
  id: string;
  /** Version 1 snapshots contain the complete conversation, including empty starts. */
  snapshotVersion?: 1;
  worldId?: string;
  worldChapter?: number;
  name: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  messages: Message[];
  memory: string;
  longTermMemory: string;
  /** Hidden Direct / Character context snapshot. */
  agentSummary?: string;
  midTermMemories: string[];
  shortTermMemories: string[];
  memoryStale?: boolean;
  lastMessageAt: ISODateString;
  title: string;
  suggestedRoutes?: string[];
  injectionToggles?: NovelInjectionToggles;
  lastShortTermMemoryMessageId?: string;
  lastAgentSummaryMessageId?: string;
  lastAgentSummarySnapshot?: string;
  /** Mirrors NovelConversation — regenerate rollback for 本幕草稿. */
  lastExperienceDraftMessageId?: string;
  lastExperienceDraftSnapshot?: Record<string, string>;
  lastExperienceDraftRecentIdsSnapshot?: string[];
  /** Scene-scoped recent dossiers (mirrors NovelConversation). */
  recentSceneDossierIds?: string[];
  /** Frozen echo if this checkpoint was saved while an echo was active. */
  regressionEcho?: string;
  /** Mirrors NovelConversation — current chapter for prompt injection. */
  currentChapter?: string;
  /** Mirrors NovelConversation — memory system on/off flag. */
  memorySystemEnabled?: boolean;
} & SessionCustomConfig;

/** Per-novel memory-point book: live line + frozen checkpoints + one-step undo. */
export type NovelSlotBook = {
  activeSlotId: string;
  slots: NovelSaveSlot[];
  /** Snapshot of the live line taken before the last load; enables one-step 撤销读取. */
  previousSnapshot: NovelSaveSlot | null;
};

export type LlmProvider = {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  selectedModel: string;
  fetchedModels: string[];
  /** Indicates that fetchedModels came from the provider's remote model API. */
  fetchedModelsSource?: 'remote';
  isActive: boolean;
  /** Approximate model context capacity used for prompt budgeting. */
  contextWindowTokens?: number;
  /** 请求协议（默认 openai-compatible）。 */
  protocol?: 'openai-compatible' | 'openai-responses' | 'anthropic-messages' | 'google-generate-content';
  /** 鉴权方式。 */
  auth?: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  /** 品牌标记（短字母缩写，展示为 logo 徽标）。 */
  logoMark?: string;
  /** 品牌主色（十六进制）。 */
  accent?: string;
  /** 目录默认 Base URL（新增厂商时的参考）。 */
  defaultBaseUrl?: string;
  /** Per-model transport controls. Kept separate from the global defaults. */
  modelSettings?: Record<string, ProviderModelSettings>;
};

export type ProviderModelSettings = {
  /** Explicit stream preference for this model; omitted = use global default. */
  streamingEnabled?: boolean;
  /** User choice, including models absent from the built-in capability catalog. */
  thinkingEnabled?: boolean;
  /** Request parameter used by an OpenAI-compatible proxy. */
  thinkingParameter?: 'auto' | 'thinking' | 'enable_thinking' | 'reasoning_effort' | 'none';
};

/** User-defined writing styles managed in system settings. */
export type WritingStyleTemplate = {
  id: string;
  name: string;
  prompt: string;
};

/** Optional NSFW-only body / kink notes on a cast card. */
export type NovelCastCharacterPrivacy = {
  /** 性器官（阴茎/阴蒂/阴道，及口腔、后庭等；旧 penis/clitoris 会迁移合并至此） */
  genitals?: string;
  /** 胸部 */
  chest?: string;
  /** 敏感带 */
  erogenousZones?: string;
  /** 气味 */
  scent?: string;
  /** 性癖 / XP */
  xp?: string;
  /** 自慰习惯 */
  masturbationHabits?: string;
  /** 禁忌 / 雷点 */
  taboo?: string;
};

export type WritingMod = {
  id: string;
  name: string;
  content: string;
  /** Missing only in legacy single-selection saves. */
  enabled?: boolean;
};

/** Global writing defaults and independent prompt extensions. */
export type ContentStyleSettings = {
  /** Prefill for new novels; empty = leave writing style blank. */
  defaultWritingStyle: string;
  /** @deprecated Read only when migrating old writing settings. */
  nsfwEnabled?: boolean;
  /** @deprecated Migrated to jailbreakPrompt; retained only for old saves. */
  nsfwPrompt?: string;
  /** Independent optional writing blocks; private dossiers are always available. */
  jailbreakEnabled?: boolean;
  jailbreakPrompt?: string;
  /** Legacy compatibility summary; individual MOD enabled flags are authoritative. */
  modEnabled?: boolean;
  modPrompt?: string;
  modLibrary?: WritingMod[];
  /** Legacy single-selection migration only. */
  selectedModId?: string;
  /** Used only for extracting a MOD, never injected into story generation. */
  modExtractionPrompt?: string;
  /**
   * Legacy soft scale preset — kept for persist migrate only; ignored by UI/prompts.
   * @deprecated
   */
  contentScalePreset: ContentScalePreset;
  /**
   * Legacy ban flags — kept for persist migrate only; ignored by UI/prompts.
   * @deprecated
   */
  bans: ContentBanFlags;
};

/** Wire protocols supported by the independent image-generation client. */
export type ImageProviderProtocol =
  | 'auto'
  | 'google-generate-content'
  | 'openai-compatible'
  | 'openai-images'
  | 'openai-responses-image';

/** Authentication modes supported by the independent image-generation client. */
export type ImageProviderAuth = 'auto' | 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

/** Independent image-generation provider/model selection. */
export type ImageProviderConfig = {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  protocol?: ImageProviderProtocol;
  auth?: ImageProviderAuth;
  logoMark?: string;
  accent?: string;
};

/** Independent image-provider credentials and model selection. */
export type ImageGenerationSettings = {
  providerId: string;
  providers: Record<string, ImageProviderConfig>;
};

export type GenerationSettings = {
  temperature: number;
  /** Chat / novel dialogue completion budget. */
  maxTokens: number;
  /** Whether the main chat should disable DeepSeek V4-class thinking. */
  thinkingDisabled: boolean;
  /** Novel create-page「AI 创作」JSON generation budget (separate from chat). */
  novelCreateMaxTokens: number;
  /** Budget for short/long-term memory compress/merge (Memory agent lane). */
  memoryMaxTokens: number;
  /**
   * Max chars of novel txt sent when extracting【文风】from a sample
   * (stratified windows within this budget). Clamped ~2k–100k.
   */
  writingStyleSampleMaxChars: number;
  /**
   * Optional provider for background tasks (Memory / create AI / suggested routes).
   * Empty = fall back to the global default provider.
   */
  utilityProviderId: string;
  /**
   * Optional background model id. Empty = fall back to that provider's
   * (or the global default's) selected model.
   */
  utilityModelId: string;
  /**
   * Optional provider for the shared collaboration lane (Direct / Character / Editor).
   * Empty = fall back to the background lane.
   */
  collaborationProviderId: string;
  /**
   * Optional model for the shared collaboration lane.
   * Empty = fall back to the selected background model.
   */
  collaborationModelId: string;
  /**
   * @deprecated Kept only so older persisted settings can be migrated. New code
   * should use the three shared model lanes instead of per-agent bindings.
   */
  agentModelBindings?: Partial<Record<NovelAgentId, AgentModelBinding>>;
  contextWindowMessages: number;
  streamingEnabled: boolean;
  /** Request timeout in seconds (P7). */
  requestTimeoutSeconds: number;
  /** Extra attempts after the first failure (0–5). */
  requestRetryCount: number;
  /**
   * When true: full outgoing messages dump to Metro/Expo terminal +「查看上次请求」snapshot.
   * When false: one-line digest only in the terminal.
   */
  debugPromptInspectorEnabled: boolean;
  /** @deprecated Legacy short/normal/long setting retained for old persisted data only. */
  replyLengthPreset: ReplyLengthPreset;
  /** When a writing-model response hits a provider length limit, auto-continue once and append. */
  continuationOnTruncation: boolean;
};

/** Agents that can participate in the novel writing workflow. */
export type NovelAgentId =
  | 'direct'
  | 'character'
  | 'narrator'
  | 'editor'
  | 'memory';

/** Provider/model selection for one novel workflow agent. */
export type AgentModelBinding = {
  providerId: string;
  modelId: string;
};

/** Resolved request config used by the LLM client. */
export type ApiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Resolved provider id. */
  providerId?: string;
  /** Resolved provider display name. */
  providerName?: string;
  /** Resolved wire protocol and authentication mode for the selected provider. */
  protocol?: LlmProvider['protocol'];
  auth?: LlmProvider['auth'];
  /** Static capability metadata for the resolved model. */
  modelCapability?: ModelCapability;
  temperature: number;
  maxTokens: number;
  /** Provider context capacity, excluding output budget and safety reserve. */
  contextWindowTokens?: number;
  contextWindowMessages: number;
  streamingEnabled: boolean;
  requestTimeoutMs: number;
  requestRetryCount: number;
  debugPromptInspectorEnabled: boolean;
  replyLengthPreset: ReplyLengthPreset;
  /** Propagated from generation settings; applies to writing-model requests. */
  continuationOnTruncation: boolean;
  /**
   * When true, DeepSeek V4-class models skip chain-of-thought
   * (`thinking: { type: "disabled" }`). Memory / utility side jobs set this.
   */
  thinkingDisabled?: boolean;
  /** Preserves an explicit user choice for models unknown to the capability catalog. */
  thinkingConfigured?: boolean;
  thinkingParameter?: ProviderModelSettings['thinkingParameter'];
};

export type OpenAIChatRole = 'system' | 'user' | 'assistant';

export type OpenAIChatMessage = {
  role: OpenAIChatRole;
  content: string;
};

/** Character belonging to a novel (protagonist or supporting). Limit from novel settings. */
/** Directed key relationship from this cast card to another person. */
export type NovelCastRelation = {
  id: string;
  /** Counterpart name — may invent off-cast people (室友陈砚 / 父亲xxx); need not exist in cast. */
  targetName: string;
  /** Optional link when the counterpart already has a cast card. */
  targetCastId?: string;
  /** Short label, e.g. 青梅竹马 / 宿敌 / 师生. */
  label: string;
  /** One-line status, e.g. 已决裂但仍互相牵挂. */
  note?: string;
  /** manual = user; ai = future leap / scene-end upsert. */
  source?: 'manual' | 'ai';
  updatedAt?: number;
};

/** Human-only character side story. Never injected into novel generation. */
export type NovelCharacterBiography = {
  id: string;
  title: string;
  /** The author's one-off request that produced this piece. */
  request: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type NovelCharacterArcPlan = {
  characterId: string;
  startingPoint: string;
  stageGoal: string;
  keyTurn: string;
  progress: string;
  nextMove: string;
  status: 'planned' | 'active' | 'completed' | 'paused';
  updatedAt: string;
};

/** Author-owned organization and arc planning; separate from permanent cards and AI story state. */
export type NovelCharacterWorkspace = {
  version: 1;
  tagsByCharacterId: Record<string, string[]>;
  arcs: NovelCharacterArcPlan[];
};

export type NovelCastCharacter = {
  id: string;
  name: string;
  /** Alternate names/titles used to retrieve this character from recent text. */
  aliases?: string[];
  profession: string;
  age: string;
  gender: string;
  /** 身高 */
  height: string;
  /** 体重 */
  weight: string;
  /** 出生地 / 籍贯 */
  birthplace?: string;
  /** 阵营 / 所属（门派、势力、组织等） */
  affiliation?: string;
  appearance: string;
  personality: string;
  speechStyle: string;
  background: string;
  /** When true, always injected as【主角】; may have multiple (e.g. 男女主). */
  isProtagonist?: boolean;
  /** When true, this character was auto-extracted from an AI reply (not manually created). */
  generatedFromReply?: boolean;
  /** 当该角色是通过「根据文本生成配角」创建时，记录其来源章节（如 "第一章"）。 */
  sourceChapter?: string;
  /** Core motive — mainly for protagonists; optional for supporting cast. */
  motive?: string;
  /** @deprecated Removed from the dossier UI / injection; kept for persist compat. */
  habits?: string;
  strengths?: string;
  weaknesses?: string;
  /** @deprecated Removed from the dossier UI / injection; kept for persist compat. */
  secrets?: string;
  /** @deprecated Removed from the dossier UI / injection; kept for persist compat. */
  notes?: string;
  /**
   * Key relationships (A→B). Not mirrored bidirectionally.
   * Injected with this card; future scene-end AI may upsert leaps here.
   */
  relations?: NovelCastRelation[];
  /** Optional portrait / card photo (casefile PHOTO slot, etc.). */
  portraitUri?: string;
  /** Normalized midpoint of both eyes, detected once when a portrait is selected. */
  portraitFocus?: {
    eyeX: number;
    eyeY: number;
    confidence?: number;
    detector?: 'mlkit' | 'opencv';
  };
  /** Legacy private dossier fields, retained for existing cards. */
  privacy?: NovelCastCharacterPrivacy;
  /** Structured data backing the paper-dossier editor. */
  dossierV2?: CharacterDossierV2;
  /** Compact stable anchors for prompt injection; exact facts are rebuilt from the dossier. */
  aiSummary?: CharacterAiSummary;
  /** Editor-only hydration field; persisted separately and never sent to writing models. */
  biographies?: NovelCharacterBiography[];
};

/**
 * Per-novel character knowledge entry (worldbook-style).
 * Injected only when a trigger key is mentioned in recent messages.
 */
export type NovelCharacterDossier = {
  id: string;
  /** Optional link back to cast card in world-building. */
  castId?: string;
  name: string;
  /**
   * Extra trigger aliases (besides `name`).
   * Matched like worldbook keys against recent chat text.
   */
  aliases: string[];
  /** Character setting text injected when a key matches. */
  content: string;
  /**
   * 定稿经历 — short one-liner finalized when a scene ends.
   * Injected via worldbook-style dossier injection when present.
   * Not filled by cast AI generate. Users may still edit manually.
   */
  experience: string;
  /**
   * 本幕草稿 — working notes for the current scene.
   * Updated during the scene when the character is mentioned.
   * NEVER injected into prompts. Cleared/reset on scene end.
   */
  experienceDraft: string;
  enabled: boolean;
  /** True when chapter edits may have invalidated this derived knowledge. */
  stale?: boolean;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  updatedAt: ISODateString;
};

/**
 * Per-novel non-character lore / settings entry (worldbook-style).
 * Injected only when name or aliases appear in recent messages.
 * Display-only list UI — no character dossier.
 */
export type NovelLoreEntry = {
  id: string;
  type: NovelLoreTypeId;
  /** Display-only atlas volume. Prompt matching still uses semantic `type`. */
  collectionId?: string;
  name: string;
  /** Extra trigger aliases (besides `name`). */
  aliases: string[];
  /** Compact setting text injected when a key matches. */
  content: string;
  enabled: boolean;
  /** True when chapter edits may have invalidated this derived knowledge. */
  stale?: boolean;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  updatedAt: ISODateString;
};

/** One person/place node on a knowledge-base relation graph (demo). */
export type NovelRelationGraphNode = {
  id: string;
  name: string;
  /** Optional link to cast card. */
  castId?: string;
  /**
   * Display role on non-main graphs.
   * person = cast; place = 地域层级; faction = 势力节点。
   */
  nodeKind?: 'person' | 'place' | 'faction';
  x: number;
  y: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** Undirected bond: both ends share the same short label (室友 / 父子 / 债务…). */
export type NovelRelationGraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  note?: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/**
 * main = 人际主图（角色生成/同步写入）
 * region / faction = 展示用拆图（demo，不进生成同步）
 * period = 预留，暂不自动构建
 */
export type NovelRelationGraphKind = 'main' | 'region' | 'faction' | 'period';

/** A named relation map under 关系库; a novel may hold several. */
export type NovelRelationGraph = {
  id: string;
  name: string;
  kind?: NovelRelationGraphKind;
  nodes: NovelRelationGraphNode[];
  edges: NovelRelationGraphEdge[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** Chapter status in the continuation / chapter pipeline. */
export type NovelChapterStatus = 'draft' | 'final';
export type NovelChapterContentStatus = 'unloaded' | 'loading' | 'loaded' | 'error';

/** confirmNovelChapter 的返回：committed=false 表示被任务验收门禁拦截，需作者 override。 */
export type ConfirmNovelChapterResult = {
  committed: boolean;
  warnings: string[];
};

/** A structured chapter of imported / generated novel body text. */
export type NovelChapter = {
  id: string;
  /** 1-based chapter number. */
  index: number;
  title: string;
  /** Short summary of the chapter (used for context assembly). */
  summary: string;
  /** Optional goal / next-scene directive used by the writing pipeline. */
  goal: string;
  /** Chapter body text. */
  content: string;
  /** SQLite-backed body hydration state; metadata can stay resident without the body. */
  contentStatus?: NovelChapterContentStatus;
  /** draft = AI continuation candidate; final = accepted into the book. */
  status: NovelChapterStatus;
  /** When true, this chapter was auto-generated by the AI pipeline. */
  aiGenerated?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type NovelChapterMission = {
  missionId: string;
  novelId: string;
  chapterIndex: number;
  canonRevision: number;
  goal: string;
  mustAdvanceThreadIds: string[];
  mustAdvanceHookIds: string[];
  mustPlantHookCount: number;
  mustAppearCharacterIds: string[];
  sceneLocationId?: string;
  sceneTime?: string;
  status: 'planned' | 'used' | 'verified' | 'superseded';
  createdAt: ISODateString;
};

export type NovelCharacterRedLine = {
  characterId: string;
  name: string;
  immutable: string[];
  currentState: string;
  knows: string[];
  unknown: string[];
  sourceEventIds: string[];
};

export type NovelHookTask = {
  hookId: string;
  keyword: string;
  instruction: 'advance' | 'resolve' | 'mention';
  overdueBy: number;
  dependsOn: string[];
  expectedPayoff: string;
};

export type NovelMissionVerification = {
  missionId: string;
  passed: boolean;
  missingCharacterIds: string[];
  missingHookIds: string[];
  missingThreadIds: string[];
  warnings: string[];
  verifiedAt: ISODateString;
};

export type NovelMissionFeasibility = {
  feasible: boolean;
  budgetTokens: number;
  estimatedHardConstraintTokens: number;
  conflicts: string[];
  checkedAt: ISODateString;
};

/** Foreshadowing ledger entry — planted / fulfilled / dropped state machine. */
export type NovelForeshadowingStatus = 'open' | 'fulfilled' | 'dropped';

export type NovelForeshadowing = {
  id: string;
  /** Trigger keyword, e.g. 「玉佩」/「城主府的旧账」. */
  keyword: string;
  /** One-line description of the planted hook. */
  description: string;
  status: NovelForeshadowingStatus;
  /** Chapter index where the hook was planted. */
  plantedChapterIndex: number;
  createdAt: ISODateString;
  /** Chapter index where the hook was resolved. */
  fulfilledChapterIndex?: number;
  /** Chapter index after which the hook is considered overdue. */
  dueAfterChapterIndex?: number;
  note: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** Audit issue categories mirroring GengBi / webnovel-writer review dimensions. */
export type NovelAuditCategory =
  | 'consistency'
  | 'rhythm'
  | 'continuity'
  | 'character'
  | 'foreshadowing'
  | 'structure';

export type NovelAuditSeverity = 'high' | 'medium' | 'low';

export type NovelAuditIssue = {
  id: string;
  category: NovelAuditCategory;
  severity: NovelAuditSeverity;
  message: string;
};

/** Result of a chapter-level audit (rule regex + LLM fact-check). */
export type NovelChapterAudit = {
  id: string;
  chapterId: string;
  chapterIndex: number;
  issues: NovelAuditIssue[];
  passed: boolean;
  createdAt: ISODateString;
  modelId?: string;
};

/** One planned chapter inside a volume. */
export type NovelVolumeChapter = {
  index: number;
  title: string;
  goal: string;
  /** Explicit narrative scene boundary emitted by the outline planner. */
  sceneEnd?: boolean;
};

/** Lifecycle state for a user-built outline volume. */
export type NovelOutlineVolumeStatus = 'draft' | 'generating' | 'ready' | 'failed';

/** The bounded context handed from one volume to the next. */
export type NovelOutlineVolumeHandoff = {
  incoming?: string;
  outgoing?: string;
  unresolvedThreads?: string[];
};

/** Volume-level plan produced by the AI outline generator. */
export type NovelVolumePlan = {
  id: string;
  title: string;
  summary: string;
  chapters: NovelVolumeChapter[];
  /** User-configured target for this volume; absent on legacy outlines. */
  plannedChapterCount?: number;
  /** User-configured target for each chapter in this volume. */
  wordsPerChapter?: number;
  /** Draft/ready state is persisted so each volume can be edited independently. */
  status?: NovelOutlineVolumeStatus;
  /** Bounded continuity packet for the adjacent volume. */
  handoff?: NovelOutlineVolumeHandoff;
  /** Last generation error for this volume, without invalidating other volumes. */
  generationError?: string;
};

/** Whole-book outline / volume plan (Phase D planning asset). */
export type NovelOutline = {
  summary: string;
  volumes: NovelVolumePlan[];
  /** Stable first chapter index for this outline, preserved when volumes are removed. */
  baseChapterIndex?: number;
  updatedAt: ISODateString;
};

/**
 * A typed change proposed against an outline.  Proposals are intentionally
 * narrower than a full-outline replacement so the accept step can validate
 * exactly what the model is allowed to touch.
 */
export type NovelOutlinePatch =
  | {
      op: 'replace_outline';
      outline: NovelOutline;
      beforeHash: string;
    }
  | {
      op: 'update_volume';
      volumeId: string;
      volume: NovelVolumePlan;
      beforeHash: string;
    }
  | {
      op: 'append_volumes';
      volumes: NovelVolumePlan[];
      beforeHash: string;
    }
  | {
      /** Append-only proposal: existing chapters must remain byte-for-byte unchanged. */
      op: 'append_chapters';
      volumeId: string;
      chapters: NovelVolumeChapter[];
      beforeHash: string;
    }
  | {
      /** Scoped revision proposal: only the listed chapter indexes may change. */
      op: 'update_selected_chapters';
      volumeId: string;
      chapterIndexes: number[];
      chapters: NovelVolumeChapter[];
      beforeHash: string;
    }
  | {
      /** Reorder-only proposal: content is preserved; only the chapter order changes. */
      op: 'reorder_chapters';
      volumeId: string;
      chapterIndexes: number[];
      beforeHash: string;
    };

export type NovelOutlineProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'conflicted'
  | 'failed';

/** A model suggestion kept separate from the canonical outline. */
export type NovelOutlineProposal = {
  id: string;
  /** `novel` for the main outline, or a quick-travel world id. */
  scopeId: string;
  operation: 'create' | 'append' | 'revise' | 'reshape' | 'reorder';
  prompt: string;
  baseHash: string;
  baseVersionId?: string;
  patch: NovelOutlinePatch;
  status: NovelOutlineProposalStatus;
  error?: string;
  modelId?: string;
  tokens?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type SaveNovelOutlineProposalInput = {
  scopeId?: string;
  operation: NovelOutlineProposal['operation'];
  prompt: string;
  candidateOutline: NovelOutline;
  targetVolumeId?: string;
  /** Required for scoped revision proposals; prevents unrelated chapters being touched. */
  targetChapterIndexes?: number[];
  appendVolumes?: boolean;
  modelId?: string;
  tokens?: number;
};

/** Immutable snapshot used for outline history and rollback UI. */
export type NovelOutlineVersion = {
  id: string;
  scopeId: string;
  outline: NovelOutline;
  source: 'manual' | 'ai_accept' | 'restore';
  reason?: string;
  proposalId?: string;
  createdAt: ISODateString;
};

/** The structural shape chosen in the guided creation flow. */
export type NovelStoryKind = 'serialized' | 'wishful' | 'quicktravel';

/**
 * The unified story blueprint used by the guided creation flow.
 *
 * These are orthogonal dimensions rather than mutually exclusive genres:
 * - structure describes how the story is organized;
 * - entry describes how the protagonist reaches another world (if any);
 * - drive describes the feedback the outline should keep delivering.
 */
export type NovelNarrativeStructure = 'single_world' | 'multi_world';
export type NovelWorldEntry = 'none' | 'system_task' | 'breakthrough' | 'book_transmigration';
export type NovelProgressionFocus = 'power' | 'relationship' | 'mystery' | 'mixed';

export type NovelNarrativeProfile = {
  structure: NovelNarrativeStructure;
  entry: NovelWorldEntry;
  focus: NovelProgressionFocus;
  /** Whether the author expects an existing/original plot baseline. */
  knownPlot: boolean;
};

/** Stable story-level material compiled from the four-question workshop. */
export type NovelCreationBlueprint = {
  profile: NovelNarrativeProfile;
  storyCore: {
    title: string;
    brief: string;
    premise: string;
    theme: string;
    ending: string;
    plannedChapters: number;
    firstChapterGoal: string;
    worldName: string;
    worldEra: string;
    gameRules: string;
  };
  /** Only the protagonist's story-level anchor; detailed identity belongs to cast cards. */
  protagonistCore: {
    /** Optional explicit name carried from the creation workshop. */
    name?: string;
    /** Optional explicit gender carried from the creation workshop. */
    gender?: string;
    identity: string;
    goal: string;
  };
  /** Optional seed consumed by the existing quick-travel system/world generators. */
  runtimeSeed?: {
    systemName: string;
    globalRules: string;
    worldSeed: string;
    mission: string;
    entryScene: string;
    originalPlot: {
      premise: string;
      knownToProtagonist: string;
      originalEnding: string;
    };
  };
  /** Compiled stable prompt shown for confirmation and injected into Narrator. */
  foundationPrompt: string;
};

/** The author-owned brief captured before a workbench novel is written. */
export type NovelProjectBrief = {
  premise: string;
  theme: string;
  protagonistArc: string;
  ending: string;
  plannedChapters: number;
  firstChapterGoal: string;
  storyKind?: NovelStoryKind;
};

/**
 * Novel creation workflow. `interactive` is the ordinary Narrator chat path
 * (the persisted name is kept for compatibility); `workbench` is reserved for
 * continuation/project setup.
 */
export type NovelCreationMode = 'interactive' | 'workbench';

/** How a novel produces its next reply. Direct mode adds a planning pass before Narrator. */
export type NovelAgentMode = 'narrator' | 'direct';

/** Runtime stage shown while the Direct → Character → Narrator pipeline runs. */
export type NovelAgentStage =
  | 'memory-context'
  | 'collaboration'
  | 'direct'
  | 'character'
  | 'narrator'
  | 'editor'
  | 'repair'
  | 'memory';

/** Compact, structured hand-off from the Direct planner to the Narrator. */
export type NovelDirectPlan = {
  objective: string;
  scene: string;
  participants: string[];
  beats: string[];
  constraints: string[];
  endingHook: string;
};

/** Structured acting brief handed from Character to Narrator for one turn. */
export type NovelCharacterBrief = {
  activeCharacterIds: string[];
  characters: {
    characterId?: string;
    name: string;
    objective: string;
    emotionalState: string;
    behavior: string;
    voice: string;
    relationshipChanges: string[];
  }[];
  continuityWarnings: string[];
};

/** Structured post-draft review from Editor. Editor never becomes canon by itself. */
export type NovelEditorReview = {
  approved: boolean;
  severity: 'none' | 'minor' | 'major';
  issues: string[];
  revisionInstructions: string;
};

/** Dialogue sample for a named character (voice injection). */
export type NovelDialogueSample = {
  characterName: string;
  sample: string;
};

/** Writing-style feature extracted from existing prose (togglable asset). */
export type NovelStyleFeature = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

/** Per-task token/call statistics for the continuation pipeline. */
export type NovelTaskUsage = {
  calls: number;
  tokens: number;
};

export type NovelContinuationStats = Record<string, NovelTaskUsage>;

/** Continuation pipeline settings (Phase B lookback / Phase C gates / Phase D toggles). */
export type NovelContinuationSettings = {
  /** How many recent full chapter bodies are injected; 0 = summaries/state only. */
  lookbackChapters: number;
  /** Target words for a generated chapter. */
  targetWords: number;
  /** Auto-run rule audit + fact-check after generating a chapter. */
  autoAudit: boolean;
  /** Auto-track foreshadowings while generating chapters. */
  autoForeshadowingTrack: boolean;
  /** Apply anti-AI rules to generated prose. */
  useAntiAiRules: boolean;
  /** Prompt the model to plant/fulfill hooks each chapter. */
  useOutline: boolean;
  /** Word length for per-char style feature pool injection. */
  maxContextChars: number;
};

/** Versioned backup of a chapter for one-step rollback. */
export type NovelChapterBackup = {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  /** Optional for backups created before chapter metadata was included. */
  summary?: string;
  goal?: string;
  createdAt: ISODateString;
};

// ─────────────────────────────────────────────────────────────────────────────
// 续写 / 结局重写 —— StoryState 分析产物（postive.md P1）
// ─────────────────────────────────────────────────────────────────────────────

/** StoryState 分析任务状态机。 */
export type NovelAnalysisStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'failed'
  | 'complete';

/** 世界规则 / 不可违反正史条目。 */
export type NovelWorldFact = {
  id: string;
  /** 规则名，如「灵气复苏后地球灵气浓度」/「主角身世」. */
  subject: string;
  /** 规则内容（正史陈述）。 */
  content: string;
  /** 该正史不可被违反（硬规则）。 */
  canon: boolean;
  /** 规则来源章节号（0 = 全书性设定）。 */
  sourceChapter: number;
  /** 规则成立起止章节（null = 至今仍有效）。 */
  validFromChapter: number;
  validUntilChapter?: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 人物档案（StoryState 人物层）。 */
export type NovelStoryCharacter = {
  id: string;
  canonicalId?: string;
  aliases?: string[];
  lockedByUser?: boolean;
  name: string;
  /** 主角 / 配角 / 反派 / 关键龙套 … */
  role: string;
  /** 外貌 / 性格 / 出身 等静态档案（合并摘要，兼容旧数据与下游）。 */
  profile: string;
  /** 外貌（状态分析结构化提取或全文检索增强）。 */
  appearance?: string;
  /** 性格。 */
  personality?: string;
  /** 说话方式。 */
  speechStyle?: string;
  /** 出身 / 背景。 */
  background?: string;
  /** 动机。 */
  motivation?: string;
  /** 阵营 / 所属。 */
  affiliation?: string;
  /** 仅 NSFW 模式下生成 / 展示（复用大详情页角色卡的隐私词条结构）。 */
  privacy?: NovelCastCharacterPrivacy;
  /** 原文证据片段（状态分析提取或全文检索增强命中）。 */
  evidence?: string[];
  /** 用户预写 SFW 内容（检索种子；不被 LLM 覆盖）。 */
  sfwSeed?: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
  /** 用户预写 NSFW 内容（检索种子；不被 LLM 覆盖）。 */
  nsfwSeed?: string;
};

/** 人物当前状态（可随时间推进变化）。 */
export type NovelCharacterState = {
  characterId: string;
  /** 当前状态一句话（如「重伤，失去内丹」）。 */
  currentState: string;
  /** 当前目标。 */
  goal: string;
  /** 动机。 */
  motive: string;
  /** 说话方式（腔调/口头禅）。 */
  speakingStyle: string;
  /** 该角色当前知道 / 不知道的信息（信息边界）。 */
  knows: string[];
  unknown: string[];
  /** 状态成立章节。 */
  atChapter: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 人物关系及其变化。 */
export type NovelCharacterRelationship = {
  id: string;
  fromCharacter: string;
  toCharacter: string;
  /** 关系标签（师徒 / 宿敌 / 恋人 …）。 */
  relation: string;
  /** 关系强度或变化描述。 */
  description: string;
  atChapter: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 时间线 / 地点 / 组织 / 物品 / 资源变化事件。 */
export type NovelTimelineEvent = {
  id: string;
  /** Stable entity identity for location/faction/item subjects across renames. */
  canonicalId?: string;
  aliases?: string[];
  lockedByUser?: boolean;
  /** 事件类型：timeline | location | faction | item | resource. */
  type: 'timeline' | 'location' | 'faction' | 'item' | 'resource';
  chapter: number;
  subject: string;
  event: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 主线 / 支线 / 情感弧。 */
export type NovelPlotThread = {
  id: string;
  title: string;
  kind: 'main' | 'sub' | 'arc';
  description: string;
  /** 当前推进状态。 */
  progress: string;
  startChapter: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 伏笔状态机（InkOS hook 思想：推进/延迟/回收）。 */
export type NovelHookStatus = 'open' | 'progressing' | 'deferred' | 'resolved';

/** 伏笔台账条目。 */
export type NovelHook = {
  id: string;
  /** 触发关键词，如「玉佩」/「城主府的旧账」。 */
  keyword: string;
  /** 伏笔描述。 */
  description: string;
  /** 伏笔类型：mystery / promise / threat / setup / character / world … */
  type: string;
  status: NovelHookStatus;
  /** 埋设章节。 */
  startChapter: number;
  /** 最近一次推进章节（回收前持续更新）。 */
  lastAdvancedChapter: number;
  /** 预期回收方式。 */
  expectedPayoff: string;
  /** 重要性。 */
  importance: 'minor' | 'major' | 'core';
  /** 依赖的其他伏笔 id。 */
  dependsOn: string[];
  /** 原文证据片段。 */
  supportingEvidence: string[];
  /** 回收章节（status=resolved 时有值）。 */
  resolvedChapter?: number;
  /** 逾期章节阈值。 */
  dueAfterChapter?: number;
  note: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 每章摘要行。 */
export type NovelChapterSummaryRow = {
  chapter: number;
  title: string;
  /** 关键事件。 */
  events: string;
  /** 章末状态（人物/局势落点）。 */
  stateChanges: string;
  /** 本章伏笔活动。 */
  hookActivity: string;
  /** 情绪/基调。 */
  mood: string;
  sourceEventIds?: string[];
  stateVersion?: number;
  confidence?: number;
  locked?: boolean;
  stale?: boolean;
};

/** 文风画像。 */
export type NovelStyleProfile = {
  /** 叙事视角（第一/第三，全知/限知）。 */
  pointOfView: string;
  /** 句长特征。 */
  sentenceLength: string;
  /** 对话比例描述。 */
  dialogueRatio: string;
  /** 节奏（快/慢、场景切换密度）。 */
  pacing: string;
  /** 语言风格特征。 */
  languageFeatures: string;
};

/** 分析 checkpoint（可恢复断点）。 */
export type NovelAnalysisCheckpoint = {
  /** 已完成分析的章节号。 */
  chapter: number;
  /** 该章内容指纹，用于检测章节变化。 */
  fingerprint: string;
  createdAt: ISODateString;
};

/** StoryState 分析产物整体。 */
export type NovelStoryAnalysis = {
  /** 状态版本号：每次确认章节 / 章节失效 +1。 */
  stateVersion: number;
  /** Canon source revision; distinct from projection/extractor stateVersion. */
  canonRevision?: number;
  /** 已分析到的章节号（0 = 未分析）。 */
  lastAnalyzedChapter: number;
  manifest: {
    schemaVersion: 1;
    status: NovelAnalysisStatus;
    progress: number;
    totalChapters: number;
    lastError?: string;
    updatedAt: ISODateString;
  };
  worldFacts: NovelWorldFact[];
  characters: NovelStoryCharacter[];
  characterStates: NovelCharacterState[];
  relationships: NovelCharacterRelationship[];
  timeline: NovelTimelineEvent[];
  plotThreads: NovelPlotThread[];
  hooks: NovelHook[];
  chapterSummaries: NovelChapterSummaryRow[];
  layeredSummaries?: {
    scenes: { id: string; fromChapter: number; toChapter: number; summary: string; stateVersion: number }[];
    volumes: { id: string; fromChapter: number; toChapter: number; summary: string; stateVersion: number }[];
    book: { summary: string; throughChapter: number; stateVersion: number };
  };
  styleProfile: NovelStyleProfile;
  checkpoint?: NovelAnalysisCheckpoint;
};

export type NovelStoryFactProjection = {
  id: string;
  factType: string;
  subjectId: string | null;
  contentJson: string;
  sourceEventId: string;
  stateVersion: number;
  confidence: number;
  locked: boolean;
  stale: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// 续写 / 结局重写 —— 路线推演 / 分支 / 任务 / 快照
// ─────────────────────────────────────────────────────────────────────────────

/** 路线推演风险。 */
export type NovelRouteRisk = {
  kind: 'continuity' | 'causality' | 'character';
  description: string;
};

/** 候选路线（非正史，未选中前不改正文）。 */
export type NovelForecastRoute = {
  routeId: string;
  /** 路线名称。 */
  title: string;
  /** 核心前提。 */
  premise: string;
  /** 未来若干章剧情节拍（相对分歧章）。 */
  beats: { chapter: number; summary: string }[];
  /** 主要人物关键决定。 */
  characterDecisions: { character: string; decision: string }[];
  /** 将推进 / 回收的伏笔。 */
  hookAdvance: string[];
  /** 人物 / 关系 / 世界状态预计变化。 */
  projectedChanges: {
    characters: string[];
    relationships: string[];
    world: string[];
  };
  risks: NovelRouteRisk[];
  /** 与用户意图匹配分数 0-100。 */
  intentScore: number;
  intentRationale: string;
  /** 结局路线：主要人物弧与核心伏笔如何收束。 */
  endingNote?: string;
};

/** 一次路线推演产物。 */
export type NovelForecast = {
  forecastId: string;
  /** continue = 断更续写；ending = 结局重写。 */
  mode: 'continue' | 'ending';
  /** 分歧章节号（continue 模式 = 最后一章；ending = 用户选择）。 */
  divergenceChapter: number;
  /** 推演所依据的 stateVersion。 */
  stateVersion: number;
  /** 推演时正史指纹，用于 stale 判定。 */
  fingerprint: string;
  status: 'active' | 'stale';
  /** 用户指导输入。 */
  userGuide: {
    endingPreference: string;
    targetLength: string;
    mustKeep: string;
    mustAvoid: string;
  };
  routes: NovelForecastRoute[];
  createdAt: ISODateString;
};

/** 用户选中的路线计划（仍非正史，仅计划）。 */
export type NovelContinuationPlan = {
  planId: string;
  forecastId: string;
  routeId: string;
  mode: 'continue' | 'ending';
  /** 计划所依据的 stateVersion。 */
  stateVersion: number;
  status: 'active' | 'stale';
  createdAt: ISODateString;
};

/** 结局重写分支：从分歧章开始保留原文、在独立分支生成新内容。 */
export type NovelContinuationBranch = {
  branchId: string;
  kind: 'ending' | 'alternate';
  /** 分歧章节号（该章及之前保留原文）。 */
  divergenceChapter: number;
  /** 分支基于的 stateVersion。 */
  stateVersion: number;
  status: 'active' | 'merged' | 'discarded' | 'stale';
  title: string;
  summary: string;
  chapters: NovelChapter[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

/** 耗时任务记录（可取消 / 重试 / 恢复）。 */
export type NovelGenerationJob = {
  jobId: string;
  kind: 'analyze' | 'forecast' | 'write' | 'batch' | 'outline' | 'extract' | 'extract-style' | 'enrich';
  mode: 'continue' | 'ending';
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** 进度 0-1。 */
  progress: number;
  currentStep: string;
  lastError?: string;
  /** 恢复 checkpoint（analyze 任务记录已分析章节）。 */
  resumeAt?: number;
  chapterIndex?: number;
  chapterId?: string;
  segmentIndex?: number;
  totalSegments?: number;
  promptFingerprint?: string;
  accumulatedContent?: string;
  retryCount?: number;
  contextTokens?: number;
  userInstruction?: string;
  planId?: string;
  branchId?: string;
  startedAt: ISODateString;
  updatedAt: ISODateString;
  completedAt?: ISODateString;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
};

/** 确认后正史快照，支持回滚。 */
export type NovelStorySnapshot = {
  snapshotId: string;
  label: string;
  stateVersion: number;
  canonRevision?: number;
  chapters: NovelChapter[];
  analysis: NovelStoryAnalysis;
  createdAt: ISODateString;
};

/** 重写审查问题（8 维）。 */
export type NovelRewriteAuditIssue = {
  id: string;
  /** critical / warning / info。 */
  severity: 'critical' | 'warning' | 'info';
  /** ooc / timeline / world / info / hook / plot / pacing / drift。 */
  category: string;
  description: string;
  /** 对应原文证据。 */
  evidence: string;
  suggestion: string;
  /** local = 可自动修复；structural = 涉及情节/人物决定/结局方向，需用户确认。 */
  repairScope: 'local' | 'structural';
};

/** 一次重写审查结果。 */
export type NovelRewriteAudit = {
  auditId: string;
  chapterId: string;
  chapterIndex: number;
  issues: NovelRewriteAuditIssue[];
  /** 0-100。 */
  score: number;
  passed: boolean;
  createdAt: ISODateString;
  modelId?: string;
};

export type Novel = {
  id: string;
  /** Monotonic SQLite canon revision. Native DB is authoritative. */
  canonRevision?: number;
  name: string;
  /**
   * Auto-derived short blurb from work intro (list / legacy).
   * Not injected into chat prompts.
   */
  shortIntro: string;
  /**
   * Full work intro (create AI basis + display).
   * Not injected into chat prompts.
   */
  detailedIntro: string;
  /** Fixed narrative system prompt saved at novel creation. */
  systemPrompt: string;
  /** Full-text writing style guidance injected into every novel turn. */
  writingStyle: string;
  /** Prompt template for compressing each turn into short-term (近期) memory. */
  shortTermMemoryPrompt: string;
  /** Prompt template for merging short-term batch into mid-term (过往) memory. */
  midTermMemoryPrompt: string;
  /** Prompt template for merging mid-term batch into long-term summary. */
  longTermMemoryPrompt: string;
  playerName: string;
  /**
   * @deprecated Mirrored from the first `cast` entry with `isProtagonist`.
   * Freeform extra notes — prefer cast.notes / structured cast fields.
   */
  playerPersona: string;
  /**
   * @deprecated Mirrored from first protagonist cast.motive.
   */
  playerMotive: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerProfession: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerAge: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerGender: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerHeight: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerWeight: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerAppearance: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerPersonality: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerSpeechStyle: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerBackground: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerHabits: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerStrengths: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerWeaknesses: string;
  /** @deprecated Mirrored from protagonist cast. */
  playerSecrets: string;
  /** @deprecated Mirrored from protagonist cast.privacy. */
  playerPrivacy?: NovelCastCharacterPrivacy;
  worldName: string;
  /** World setting: era, tech/magic, social rules (injected as【世界设定】). */
  worldEra: string;
  /** @deprecated Removed from UI; kept empty for persist compatibility. */
  worldConflict: string;
  /** @deprecated Removed from UI; kept empty for persist compatibility. */
  worldTone: string;
  /** @deprecated No longer shown or injected; saved empty to cut chat tokens. */
  mainPlot: string;
  /** @deprecated No longer shown or injected; saved empty to cut chat tokens. */
  initialStoryState: string;
  /** Soft rules the AI must follow while roleplaying (游玩规则). */
  gameRules: string;
  /**
   * @deprecated Status bar removed; always normalized to empty string for persist compatibility.
   */
  statusBar?: string;
  /**
   * When true, after each AI reply generate 4 suggested next routes.
   * Toggled in create step 3 / novel edit (default off).
   */
  autoSuggestRoutes: boolean;
  /**
   * When false: don't use knowledge-base relation graphs for cast generation
   * or prompt injection. Default true for new novels; old novels may turn off
   * to avoid stale / incorrect relation data.
   */
  /** @deprecated Relation-graph functionality was removed. Retained for import compatibility. */
  relationGraphEnabled: boolean;
  /** Persisted dossier appearance id. Display-only — does not affect prompt injection. */
  characterCardAppearanceId: string;
  /** Cast characters for this novel. */
  cast: NovelCastCharacter[];
  /** Human-operated character library metadata. Never injected as a character card. */
  characterWorkspace?: NovelCharacterWorkspace;
  /** Character knowledge (worldbook-style; inject only when mentioned). */
  characterDossiers: NovelCharacterDossier[];
  /**
   * Non-character lore / settings (worlds, places, factions, items…).
   * Worldbook-style: inject only when mentioned.
   */
  loreEntries: NovelLoreEntry[];
  /** User-created atlas volumes. Built-in volumes are supplied by the app. */
  loreCollections?: NovelLoreCollection[];
  /**
   * @deprecated Legacy relation-graph payload retained for old imports only.
   * Demo only — not injected into chat / character generation yet.
   */
  relationGraphs: NovelRelationGraph[];
  /** @deprecated Always empty; novel opening messages removed. Kept for persisted data shape. */
  openingMessage: string;
  /** @deprecated Historical per-novel model; retained for persisted data only. Writing uses the global model. */
  defaultModelId: string;
  /** @deprecated Historical per-novel route; retained for persisted data only. */
  defaultProviderId?: string;
  /** Local file URI for novel cover image. */
  coverImageUri?: string;
  /** Local file URI for chat background image. */
  chatBackgroundUri?: string;
  /** Image opacity for chat background, 0–1 (1 = fully opaque). */
  chatBackgroundOpacity: number;
  /** Imported / generated chapter list (continuation pipeline). Empty for fresh novels. */
  chapters?: NovelChapter[];
  /** Foreshadowing ledger (Phase C). */
  foreshadowings?: NovelForeshadowing[];
  /** Chapter audit history (Phase C). */
  audits?: NovelChapterAudit[];
  /** Whole-book outline / volume plan (Phase D). */
  outline?: NovelOutline;
  /** Immutable snapshots of accepted/manual outline changes. */
  outlineVersions?: NovelOutlineVersion[];
  /** AI/user proposals waiting for explicit acceptance or rejection. */
  outlineProposals?: NovelOutlineProposal[];
  /** Stable creation contract generated by the four-question workshop. */
  foundationPrompt?: string;
  /** Unified story blueprint generated during guided creation. */
  creationBlueprint?: NovelCreationBlueprint;
  /** Author-owned foundation for workbench novels. */
  projectBrief?: NovelProjectBrief;
  /** Creation workflow selected by the author. Legacy novels default to `interactive`. */
  creationMode?: NovelCreationMode;
  /** Optional Direct → Narrator collaboration mode; legacy novels stay Narrator-only. */
  agentMode?: NovelAgentMode;
  /** Synchronous Editor policy for Direct collaboration; omitted legacy data resolves to fast. */
  agentReviewMode?: 'fast' | 'deep';
  /** Per-character dialogue samples (Phase D voice injection). */
  dialogueSamples?: NovelDialogueSample[];
  /** Togglable writing-style feature pool (Phase D). */
  styleFeatures?: NovelStyleFeature[];
  /** Versioned chapter backups for one-step rollback (Phase E). */
  chapterBackups?: NovelChapterBackup[];
  /** Per-task token/call usage for the continuation pipeline (Phase E). */
  continuationStats?: NovelContinuationStats;
  /** Continuation pipeline settings. */
  continuationSettings?: NovelContinuationSettings;
  /** StoryState 分析产物（断更续写 / 结局重写）。 */
  novelStoryAnalysis?: NovelStoryAnalysis;
  novelStoryFacts?: NovelStoryFactProjection[];
  /** 路线推演列表（非正史）。 */
  novelForecasts?: NovelForecast[];
  /** 用户选中的续写路线计划。 */
  novelContinuationPlans?: NovelContinuationPlan[];
  /** 结局重写分支列表。 */
  novelBranches?: NovelContinuationBranch[];
  /** 耗时任务记录（分析/推演/写章）。 */
  novelGenerationJobs?: NovelGenerationJob[];
  /** 确认后正史快照（回滚）。 */
  novelStorySnapshots?: NovelStorySnapshot[];
  /** 重写审查历史（8 维审查报告）。 */
  novelRewriteAudits?: NovelRewriteAudit[];
  /** Incomplete novel kept on the shelf for later editing. */
  isDraft: boolean;
  /** Wizard step to restore when continuing a draft (1–3). */
  createStep: 1 | 2 | 3;
  /**
   * 续写工程标记：由「续写小说」导入创建的小说。
   * 书架点开后直接进入续写工作台；普通新建小说进大详情页。
   */
  isContinuationProject?: boolean;
  /** Full quick-travel archive. Absent on legacy single-world novels. */
  quickTravel?: QuickTravelArchive;
} & EntityTimestamps;

export type CreateNovelInput = Omit<Novel, 'id' | 'createdAt' | 'updatedAt'>;
