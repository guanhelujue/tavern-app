import { buildWritingPromptExtensionBlocks } from '@/utils/writing-prompt-extensions';
import { recoverStructuredResponse } from '@/services/structured-response';
import { buildThinkingBody } from '@/utils/thinking-request';
import {
  completeGeminiNative,
  isGeminiGenerativeLanguageBaseUrl,
} from '@/services/gemini-native';
import type {
  ApiSettings,
  ContentStyleSettings,
  Message,
  Novel,
  NovelInjectionToggles,
  OpenAIChatMessage,
  WorldbookEntry,
  WritingStyleTemplate,
} from '@/types/tavern';
import {
  dossiersToWorldbookEntries,
  ensureNovelDossiers,
  formatCastRosterForCore,
} from '@/utils/novel-dossiers';
import {
  ensureNovelLoreEntries,
  formatLoreRosterForCore,
  loreEntriesToWorldbookEntries,
} from '@/utils/novel-lore';
import { formatPlayerProfileForCore, formatProtagonistAuthority, getProtagonistCastIds, getProtagonistNameKeys } from '@/utils/novel-player';
import { buildNovelRetrievalSeed, getNarrativeNovel, NOVEL_CAST_IDENTITY_RULE } from '@/utils/novel-narrative-context';
import { formatSuggestedRoutesPromptBlock } from '@/utils/status-bar-html';
import {
  applyMacros,
  type MacroContext,
} from '@/utils/macros';
import { scanWorldbookEntriesDetailed, scanWorldbookEntriesRecursively, type WorldbookMatch } from '@/utils/worldbook';
import { resolveContextTokenBudget } from '@/services/context-budget';
import { buildNovelContextPackFromState, type NovelContextPack } from '@/services/novel-context-pack';
import { formatCharacterRuntimeStateForPrompt } from '@/services/character-prompt-context';
import { resolveEffectiveCharacterRelationships } from '@/services/character-relationship-context';
import {
  buildNovelOutlineChapterGuidance,
  resolveNovelOutlineTurnRuntime,
} from '@/services/novel-outline-runtime';
import { buildQuickTravelContext } from '@/utils/quick-travel';
import { createNovelRequestAbortError } from '@/services/novel-request-lifecycle';
import {
  buildQuickTravelNovelCorePrompt,
  QUICK_TRAVEL_NOVEL_REPLY_HINT,
} from '@/utils/quick-travel-novel-prompt';
import { recordDebugSnapshot } from '@/services/debug-request-history';
import { validateNovelChatResponse } from '@/services/novel-chat-response';
import type { DebugRequestSnapshot } from '@/services/debug-request-history';
export {
  clearDebugRequestHistory,
  getDebugRequestHistory,
  subscribeDebugRequestHistory,
} from '@/services/debug-request-history';
export type { DebugRequestSnapshot } from '@/services/debug-request-history';

export type ContentStyleContext = {
  settings: ContentStyleSettings;
  writingStyleTemplates?: WritingStyleTemplate[];
};

function buildContentStyleBlocks(contentStyle?: ContentStyleContext | null) {
  if (!contentStyle?.settings) {
    return [] as string[];
  }

  return buildWritingPromptExtensionBlocks(contentStyle.settings);
}

/**
 * Rough budget for packing history after the protected core system prompt.
 * Novel cores (system + world + style) are large; 4k left almost no room
 * for recent turns and caused "amnesia" between adjacent replies.
 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 28000;
/** Always keep at least this many prior messages even if the token budget is tight. */
export const MIN_PROTECTED_HISTORY_MESSAGES = 2;
export const DEFAULT_AUTHORS_NOTE_DEPTH = 3;
export const WORLDBOOK_SCAN_MESSAGE_COUNT = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;


const SUGGESTED_ROUTES_INJECTION_MARKERS = ['【建议路线要求', '【建议路线'] as const;

/** Purpose tags for the novel continuation pipeline — a distinct debug category. */
const CONTINUATION_PURPOSE_TAGS = new Set([
  'chapter-write',
  'fact-check',
  'extract-context',
  'outline',
  'style-extract',
]);

const MAIN_CHAT_PURPOSE_TAGS = new Set(['novel-chat']);

export function isContinuationPurpose(purpose?: string): boolean {
  return purpose ? CONTINUATION_PURPOSE_TAGS.has(purpose) : false;
}

export function isMainChatPurpose(purpose?: string): boolean {
  return purpose ? MAIN_CHAT_PURPOSE_TAGS.has(purpose) : false;
}

function detectSuggestedRoutesInjected(messages: OpenAIChatMessage[]) {
  return messages.some(
    (message) =>
      message.role === 'system' &&
      SUGGESTED_ROUTES_INJECTION_MARKERS.some((marker) => message.content.includes(marker)),
  );
}

function detectSystemPromptPresent(messages: OpenAIChatMessage[]) {
  return messages.some((message) => message.role === 'system' && message.content.trim().length > 0);
}

/** Metro/Expo terminal dump of the exact outgoing chat messages (injection diagnosis). */
export function logOutgoingLlmRequestToTerminal({
  model,
  baseUrl,
  streaming,
  thinkingDisabled,
  messages,
  purpose,
  fullDump,
}: {
  model: string;
  baseUrl: string;
  streaming: boolean;
  thinkingDisabled: boolean;
  messages: OpenAIChatMessage[];
  /** e.g. novel-chat | utility-memory | utility-experience | utility-routes */
  purpose?: string;
  /** true = full messages dump; false = one-line digest only */
  fullDump: boolean;
}) {
  const suggestedRoutesInjected = detectSuggestedRoutesInjected(messages);
  const systemPromptPresent = detectSystemPromptPresent(messages);
  const suggestedRoutesLabel = suggestedRoutesInjected ? 'YES' : 'NO';
  const systemPromptLabel = systemPromptPresent ? 'YES' : 'NO';
  const purposeTag = purpose?.trim() || 'unknown';
  const isMainChat = isMainChatPurpose(purposeTag);
  const isContinuation = isContinuationPurpose(purposeTag);
  const banner = isMainChat
    ? `========== [llm-request ★${purposeTag.toUpperCase()}★] ==========`
    : isContinuation
      ? `========== [llm-request ★CONTINUATION ${purposeTag}★] ==========`
      : `========== [llm-request purpose=${purposeTag}] ==========`;
  const bannerEnd = isMainChat
    ? `========== [/llm-request ★${purposeTag.toUpperCase()}★] ==========`
    : isContinuation
      ? `========== [/llm-request ★CONTINUATION ${purposeTag}★] ==========`
      : `========== [/llm-request purpose=${purposeTag}] ==========`;

  if (!fullDump) {
    console.log(
      `[llm-request purpose=${purposeTag}${
        isMainChat ? ' ★MAIN★' : isContinuation ? ' ★CONTINUATION★' : ''
      }] model=${model} messageCount=${messages.length} suggestedRoutesInjected=${suggestedRoutesInjected ? 'yes' : 'no'}`,
    );
    return;
  }

  console.log(banner);
  console.log(`model: ${model}`);
  console.log(`baseUrl: ${baseUrl}`);
  console.log(`stream: ${streaming}${
    isMainChat
      ? ' （主对话，跟随系统设置「流式输出」）'
      : isContinuation
        ? ' （续写流水线，固定非流式）'
        : ' （侧任务固定非流式，与系统设置「流式输出」无关）'
  }`);
  console.log(`thinkingDisabled: ${thinkingDisabled}`);
  console.log(`purpose: ${purposeTag}${
    isMainChat
      ? ''
      : isContinuation
        ? ' ← 小说续写流水线'
        : ' ← 这不是主对话；主对话请搜 ★novel-chat★ / ★MAIN★'
  }`);
  console.log(`messageCount: ${messages.length}`);
  console.log(
    `injectionHints: suggestedRoutes=${suggestedRoutesLabel} systemPrompt=${systemPromptLabel}`,
  );

  messages.forEach((message, index) => {
    const content = message.content ?? '';
    console.log(`--- [${index}] ${message.role} (${content.length} chars) ---`);
    console.log(content);
  });

  console.log(bannerEnd);
}

/** Terminal dump of the model response (when debug is enabled). */
function logOutgoingLlmRequestResponseToTerminal({
  content,
  finishReason,
  purpose,
  debugEnabled,
}: {
  content: string;
  finishReason?: string;
  purpose?: string;
  debugEnabled: boolean;
}) {
  if (!debugEnabled) return;

  const purposeTag = purpose?.trim() || 'unknown';
  const isMainChat = isMainChatPurpose(purposeTag);
  const isContinuation = isContinuationPurpose(purposeTag);
  const banner = isMainChat
    ? `========== [llm-response ★${purposeTag.toUpperCase()}★] ==========`
    : isContinuation
      ? `========== [llm-response ★CONTINUATION ${purposeTag}★] ==========`
      : `========== [llm-response purpose=${purposeTag}] ==========`;
  const bannerEnd = isMainChat
    ? `========== [/llm-response ★${purposeTag.toUpperCase()}★] ==========`
    : isContinuation
      ? `========== [/llm-response ★CONTINUATION ${purposeTag}★] ==========`
      : `========== [/llm-response purpose=${purposeTag}] ==========`;

  console.log(banner);
  console.log(`purpose: ${purposeTag}`);
  console.log(`finishReason: ${finishReason || '(none)'}`);
  console.log(`responseContent (${content.length} chars):`);
  console.log(content);
  console.log(bannerEnd);
}

function resolveTimeoutMs(apiSettings: ApiSettings) {
  const value = apiSettings.requestTimeoutMs;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 15_000) {
    return Math.min(value, 600_000);
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function resolveRetryCount(apiSettings: ApiSettings) {
  const value = apiSettings.requestRetryCount;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(5, Math.max(0, Math.round(value)));
  }
  return 1;
}

class PartialStreamError extends Error {
  readonly partialContent: string;
  readonly aborted: boolean;

  constructor(error: Error, partialContent: string) {
    super(error.message);
    this.name = 'PartialStreamError';
    this.partialContent = partialContent;
    this.aborted = error.name === 'AbortError';
  }
}

class ModelRefusalError extends Error {
  constructor(reason: string) {
    super(reason ? `模型拒绝了这次请求。\n${reason}` : '模型拒绝了这次请求。');
  }
}

function isRetryableError(error: unknown) {
  // A retry would mix already-displayed text from one attempt with another,
  // then replace the whole bubble with only the last attempt's response.
  if (error instanceof PartialStreamError || error instanceof ModelRefusalError) return false;
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes('超时') || message.includes('timeout') || message.includes('network')) {
    return true;
  }

  if (message.includes('http 5') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }

  if (message.includes('fetch failed') || message.includes('failed to fetch')) {
    return true;
  }

  return false;
}

function formatEmptyResponseError(finishReason?: string) {
  const reason = finishReason?.trim();

  if (!reason || reason.toLowerCase() === 'stop') {
    return '服务未返回正文。';
  }

  if (isTruncationFinishReason(reason)) {
    return '模型返回为空或被截断。请在系统设置调高对应的长度上限（对话 / 记忆）后重试。';
  }

  const lower = reason.toLowerCase();
  if (lower.startsWith('content_filter') || lower.includes('prohibited_content')) {
    return (
      '模型因内容审核未返回正文。' +
      '部分厂商对成人或敏感剧情限制较严；可在系统设置把辅助小模型换成更宽松的厂商，或更换对话模型后重试。'
    );
  }

  return `模型没有返回内容（原因：${reason}）。`;
}

/** Provider stop reasons are not consistent, but these all mean the output hit a limit. */
export function isTruncationFinishReason(reason?: string): boolean {
  const normalized = reason?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  return normalized === 'length'
    || normalized === 'max_tokens'
    || normalized === 'max_output_tokens'
    || normalized === 'max_completion_tokens'
    || normalized === 'token_limit'
    || normalized === 'incomplete_max_output_tokens';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>({
  retryCount,
  run,
}: {
  retryCount: number;
  run: (attempt: number) => Promise<T>;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= retryCount || !isRetryableError(error)) {
        throw error;
      }

      await sleep(400 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('请求失败。');
}

type WireProtocol = NonNullable<ApiSettings['protocol']>;

function resolveWireProtocol(apiSettings: ApiSettings): WireProtocol {
  if (apiSettings.protocol) return apiSettings.protocol;
  return apiSettings.providerId === 'gemini' || isGeminiGenerativeLanguageBaseUrl(apiSettings.baseUrl)
    ? 'google-generate-content'
    : 'openai-compatible';
}

/** Gemini protocol selection is authoritative even when the endpoint is a reverse proxy. */
export function shouldUseGeminiNativeTransport(
  apiSettings: Pick<ApiSettings, 'baseUrl' | 'protocol' | 'providerId'>,
): boolean {
  return apiSettings.protocol === 'google-generate-content' ||
    (!apiSettings.protocol && apiSettings.providerId === 'gemini') ||
    isGeminiGenerativeLanguageBaseUrl(apiSettings.baseUrl);
}

function buildAnthropicRequestBody({
  model,
  messages,
  temperature,
  maxTokens,
  streaming,
  thinkingDisabled,
}: {
  model: string;
  messages: OpenAIChatMessage[];
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  thinkingDisabled: boolean;
}) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean);
  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));
  return {
    model,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    messages: input.length ? input : [{ role: 'user', content: '（继续）' }],
    max_tokens: maxTokens,
    temperature,
    stream: streaming,
    thinking: thinkingDisabled ? { type: 'disabled' } : { type: 'adaptive' },
  };
}

function buildResponsesRequestBody({
  model,
  messages,
  maxTokens,
  streaming,
  thinkingDisabled,
  modelCapability,
  thinkingConfigured,
}: {
  model: string;
  messages: OpenAIChatMessage[];
  maxTokens: number;
  streaming: boolean;
  thinkingDisabled: boolean;
  modelCapability?: ApiSettings['modelCapability'];
  thinkingConfigured?: boolean;
}) {
  const instructions = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean).join('\n\n');
  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    max_output_tokens: maxTokens,
    ...(thinkingConfigured || (modelCapability?.reasoning && modelCapability.reasoning !== 'unknown')
      ? {
          reasoning: thinkingDisabled
            ? { effort: 'none' as const }
            // Responses models only return a user-visible reasoning block when
            // a summary mode is requested; encrypted/internal reasoning alone
            // cannot be rendered by the app.
            : { effort: 'medium' as const, summary: 'auto' as const },
        }
      : {}),
    stream: streaming,
  };
}

type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

type AssistantContentPart = { type?: string; text?: string; refusal?: string };

function refusalFromParts(parts: AssistantContentPart[]): string | undefined {
  const refusals = parts.filter((part) => part?.type === 'refusal');
  if (!refusals.length) return undefined;
  return refusals.map((part) => typeof part.refusal === 'string' ? part.refusal.trim() : '')
    .filter(Boolean).join('\n');
}

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | AssistantContentPart[] | null;
      refusal?: string | null;
      reasoning_content?: string;
      reasoning?: string;
    };
    text?: string;
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

function extractAssistantText(payload: {
  message?: { content?: string | AssistantContentPart[] | null };
  text?: string;
  delta?: { content?: string | null; text?: string };
}): string {
  if (typeof payload.delta?.content === 'string' && payload.delta.content) {
    return payload.delta.content;
  }

  if (typeof payload.delta?.text === 'string' && payload.delta.text) {
    return payload.delta.text;
  }

  const content = payload.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  if (typeof payload.text === 'string') {
    return payload.text;
  }

  return '';
}

function extractAssistantReasoning(payload: {
  message?: { reasoning_content?: string; reasoning?: string };
  delta?: { reasoning_content?: string | null; reasoning?: string | null };
}): string {
  const deltaReasoning = payload.delta?.reasoning_content ?? payload.delta?.reasoning;
  if (typeof deltaReasoning === 'string') return deltaReasoning;
  const messageReasoning = payload.message?.reasoning_content ?? payload.message?.reasoning;
  return typeof messageReasoning === 'string' ? messageReasoning : '';
}

export type ChatCompletionResult = {
  content: string;
  jsonRecovery?: { status: 'recovered' | 'repaired' | 'partial'; rawContent: string; diagnostics: string[] };
  /** Provider-returned reasoning/thinking trace. Never injected into later story context. */
  reasoningContent?: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  /** Actual model id used for this reply (may differ after fallback). */
  model?: string;
};

function extractUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
}): TokenUsage {
  if (!usage) {
    return {};
  }

  return {
    promptTokens:
      typeof usage.prompt_tokens === 'number' && Number.isFinite(usage.prompt_tokens)
        ? usage.prompt_tokens
        : undefined,
    completionTokens:
      typeof usage.completion_tokens === 'number' && Number.isFinite(usage.completion_tokens)
        ? usage.completion_tokens
        : undefined,
  };
}

export type ContextHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  status?: Message['status'];
  id?: string;
};

export type BuildContextPayloadInput = {
  /** Layer 1 — never truncated. */
  coreMemory: string;
  /** Optional main prompt appended into protected core system. */
  mainPrompt?: string;
  history: ContextHistoryMessage[];
  /** Soft sliding window by message count (e.g. 2–20). */
  contextLength?: number;
  /** Hidden text prepended to the latest user utterance. */
  prefix?: string;
  /** Hidden text appended after the latest user utterance. */
  suffix?: string;
  authorsNote?: string;
  /** Structured hidden hand-off from optional novel agents to Narrator. */
  agentHandoff?: string;
  /** Card/global PHI / jailbreak — inserted immediately before the latest user message. */
  postHistoryInstructions?: string;
  worldbookEntries?: WorldbookEntry[];
  maxContextTokens?: number;
  authorsNoteDepth?: number;
  worldbookScanCount?: number;
  worldbookMaxTokens?: number;
  /** Novel scene/outline seeds; enables recursive retrieval without scanning the full roster. */
  worldbookRetrievalSeed?: string;
  /** Expand macros inside worldbook content / authors note / PHI / prefix / suffix. */
  macroContext?: MacroContext;
};

/**
 * Assemble OpenAI chat messages with layered memory:
 * 1) Core static system + mainPrompt (protected)
 * 2) Triggered worldbook system
 * 3) History truncated by contextLength, then token budget (oldest first)
 * 4) Author's Note at depth N (optional conversation memory)
 * 5) Optional agent hand-off before the latest user
 * 6) Post-history instructions (PHI / jailbreak) before latest user
 * 7) Latest user input with prefix/suffix, always last
 */
export function buildContextPayload({
  coreMemory,
  mainPrompt = '',
  history,
  contextLength,
  prefix = '',
  suffix = '',
  authorsNote = '',
  agentHandoff = '',
  postHistoryInstructions = '',
  worldbookEntries = [],
  maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS,
  authorsNoteDepth = DEFAULT_AUTHORS_NOTE_DEPTH,
  worldbookScanCount = WORLDBOOK_SCAN_MESSAGE_COUNT,
  worldbookMaxTokens = 6_000,
  worldbookRetrievalSeed,
  macroContext,
}: BuildContextPayloadInput): OpenAIChatMessage[] {
  const expand = (text: string) =>
    macroContext ? applyMacros(text, macroContext) : text;

  const coreContent = [coreMemory.trim(), expand(mainPrompt).trim()]
    .filter(Boolean)
    .join('\n\n');
  const coreSystem: OpenAIChatMessage = {
    role: 'system',
    content: coreContent || 'You are an immersive roleplay / novel engine.',
  };

  const completeHistory = history.filter(
    (message) => message.status !== 'streaming' && message.status !== 'error' && message.content.trim(),
  );

  const lengthLimitedHistory =
    typeof contextLength === 'number' && Number.isFinite(contextLength)
      ? completeHistory.slice(-Math.max(1, Math.round(contextLength)))
      : completeHistory;

  const latestUserIndex = findLatestUserMessageIndex(lengthLimitedHistory);
  const rawLatestUserContent =
    latestUserIndex >= 0 ? lengthLimitedHistory[latestUserIndex].content : '';
  const wrappedLatestUserContent = `${expand(prefix)}${rawLatestUserContent}${expand(suffix)}`;
  const latestUserMessage =
    latestUserIndex >= 0
      ? {
          role: 'user' as const,
          content: wrappedLatestUserContent,
        }
      : null;

  const priorHistory = lengthLimitedHistory
    .filter((_, index) => index !== latestUserIndex)
    .map<OpenAIChatMessage>((message) => ({
      role: message.role,
      content: message.content,
    }));

  const scanTexts = [
    ...lengthLimitedHistory.slice(-worldbookScanCount).map((message) => message.content),
    expand(prefix),
    expand(suffix),
  ].filter(Boolean);

  const expandedWorldbook = macroContext
    ? worldbookEntries.map((entry) => ({
        ...entry,
        content: applyMacros(entry.content, macroContext),
      }))
    : worldbookEntries;
  const worldbookMessage = buildWorldbookMessage(
    expandedWorldbook,
    scanTexts,
    worldbookMaxTokens,
    worldbookRetrievalSeed,
  );

  const protectedMessages: OpenAIChatMessage[] = [
    coreSystem,
    ...(worldbookMessage ? [worldbookMessage] : []),
    ...(latestUserMessage ? [latestUserMessage] : []),
  ];
  const protectedTokens = estimateMessagesTokens(protectedMessages);
  const authorsNoteMessage = buildAuthorsNoteMessage(expand(authorsNote));
  const agentHandoffMessage = buildAgentHandoffMessage(expand(agentHandoff));
  const phiMessage = buildPostHistoryInstructionsMessage(expand(postHistoryInstructions));
  const authorsNoteTokens = authorsNoteMessage ? estimateMessageTokens(authorsNoteMessage) : 0;
  const agentHandoffTokens = agentHandoffMessage ? estimateMessageTokens(agentHandoffMessage) : 0;
  const phiTokens = phiMessage ? estimateMessageTokens(phiMessage) : 0;
  const historyBudget = Math.max(
    0,
    maxContextTokens - protectedTokens - authorsNoteTokens - agentHandoffTokens - phiTokens,
  );

  // Keep enough prior turns for continuity (at least last user+assistant pair).
  const minKeep = Math.min(
    priorHistory.length,
    Math.max(
      MIN_PROTECTED_HISTORY_MESSAGES,
      typeof contextLength === 'number' && Number.isFinite(contextLength)
        ? Math.max(1, Math.round(contextLength) - 1)
        : MIN_PROTECTED_HISTORY_MESSAGES,
    ),
  );

  const truncatedHistory = truncateHistoryFromOldest(priorHistory, historyBudget, minKeep);
  const chatWithLatest = [...truncatedHistory, ...(latestUserMessage ? [latestUserMessage] : [])];
  const chatWithAuthorsNote = insertAuthorsNoteAtDepth(
    chatWithLatest,
    authorsNoteMessage,
    authorsNoteDepth,
  );
  const chatWithAgentHandoff = insertPostHistoryInstructions(
    chatWithAuthorsNote,
    agentHandoffMessage,
  );
  const chatWithPhi = insertPostHistoryInstructions(chatWithAgentHandoff, phiMessage);

  return [coreSystem, ...(worldbookMessage ? [worldbookMessage] : []), ...chatWithPhi];
}

export function buildNovelCoreMemory(
  novel: Novel,
  globalSystemPrompt = '',
  memoryState?: {
    longTermMemory?: string;
    midTermMemories?: string[];
    shortTermMemories?: string[];
    regressionEcho?: string;
    currentChapter?: string;
    memorySystemEnabled?: boolean;
  },
  contentStyle?: ContentStyleContext | null,
  injectionToggles?: Partial<NovelInjectionToggles> | null,
  contextPack?: NovelContextPack | null,
  retrievalText = '',
): string {
  novel = getNarrativeNovel(novel);
  const toggles = {
    systemPrompt: injectionToggles?.systemPrompt !== false,
    gameRules: injectionToggles?.gameRules !== false,
    characterCards: injectionToggles?.characterCards !== false,
    worldCards: injectionToggles?.worldCards !== false,
  };
  const midTermBlock = (memoryState?.midTermMemories ?? [])
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');
  const shortTermBlock = (memoryState?.shortTermMemories ?? [])
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');
  const minimalEngine =
    'You are the narrative engine for a personal novel / world roleplay app. Stay immersive and consistent.';
  const systemBlock = toggles.systemPrompt
    ? novel.systemPrompt.trim() || globalSystemPrompt.trim() || minimalEngine
    : minimalEngine;
  const foundationPromptBlock = novel.foundationPrompt?.trim()
    ? `【小说创作设定】\n${novel.foundationPrompt.trim()}`
    : '';
  const quickTravelNovelPrompt = buildQuickTravelNovelCorePrompt({
    novel,
    globalSystemPrompt,
    memoryState,
    contentScalePrompt: buildContentStyleBlocks(contentStyle).join('\n\n'),
    injectionToggles,
    retrievalText,
    nsfwEnabled: true,
  });
  if (quickTravelNovelPrompt) {
    return [quickTravelNovelPrompt, foundationPromptBlock, toggles.characterCards ? formatProtagonistAuthority(novel.cast) : '', NOVEL_CAST_IDENTITY_RULE].filter(Boolean).join('\n\n');
  }
  const suggestedRoutesBlock = novel.autoSuggestRoutes
    ? formatSuggestedRoutesPromptBlock()
    : '';
  const contextSections: { label: string; items: import('@/services/novel-context-pack').ContextPackItem[] }[] = [
    { label: '当前章节目标', items: contextPack?.currentChapterGoal ?? [] },
    { label: '当前场景', items: contextPack?.currentScene ?? [] },
    { label: '最近章节摘要', items: contextPack?.recentChapterSummaries ?? [] },
    { label: '活跃人物状态', items: contextPack?.activeCharacters ?? [] },
    { label: '锁定世界事实', items: contextPack?.lockedWorldFacts ?? [] },
    { label: '相关关系·当前态优先', items: contextPack?.relevantRelations ?? [] },
    { label: '未解决伏笔', items: contextPack?.unresolvedHooks ?? [] },
    { label: '风格约束', items: contextPack?.styleConstraints ?? [] },
  ];
  const contextPackBlock = contextPack
    ? contextSections
        .filter((section) => section.items.length > 0)
        .map((section) => `【${section.label}】\n${section.label === '相关关系·当前态优先'
          ? '本节是剧情当前态；与角色卡中的初始关系冲突时，只采用本节。\n'
          : ''}${section.items.map((item) => item.text).join('\n')}`)
        .join('\n\n')
    : '';
  const selectedStateCharacterIds = new Set(
    (contextPack?.activeCharacters ?? [])
      .map((item) => item.id.replace(/^character:/, '')),
  );
  const runtimeStateFallbackBlock = (novel.novelStoryAnalysis?.characterStates ?? [])
    .filter((state) => !state.stale && !selectedStateCharacterIds.has(state.characterId))
    .map((state) => formatCharacterRuntimeStateForPrompt(state))
    .filter(Boolean)
    .join('\n');
  const retrievalLower = retrievalText.toLocaleLowerCase();
  const activeArcBlock = (novel.characterWorkspace?.arcs ?? [])
    .filter((arc) => arc.status === 'active')
    .flatMap((arc) => {
      const character = novel.cast.find((item) => item.id === arc.characterId);
      if (!character) return [];
      const mentioned = character.isProtagonist || [character.name, ...(character.aliases ?? [])]
        .some((name) => name.trim() && retrievalLower.includes(name.trim().toLocaleLowerCase()));
      if (!mentioned) return [];
      return [`${character.name}：阶段目标=${arc.stageGoal || '未填写'}；当前进度=${arc.progress || '未填写'}；下一步=${arc.nextMove || '未填写'}${arc.keyTurn ? `；关键转折=${arc.keyTurn}` : ''}`];
    })
    .join('\n');
  const sections = [
    systemBlock,
    buildQuickTravelContext(novel, {
      includeWorldCard: toggles.worldCards,
      includeCharacterCards: toggles.characterCards,
      nsfwEnabled: true,
    }),
    ...buildContentStyleBlocks(contentStyle),
    `【小说名称】${novel.name}`,
    foundationPromptBlock,
    novel.initialStoryState?.trim() ? `【初始故事状态·开篇依据，后续沿用已发生剧情】\n${novel.initialStoryState.trim()}` : '',
    toggles.characterCards ? formatProtagonistAuthority(novel.cast) : '',
    NOVEL_CAST_IDENTITY_RULE,
    toggles.worldCards && novel.worldName.trim() ? `【世界名称】${novel.worldName.trim()}` : '',
    toggles.worldCards && novel.worldEra.trim() ? `【世界设定】${novel.worldEra.trim()}` : '',
    toggles.gameRules && novel.gameRules?.trim()
      ? `【游玩规则】${novel.gameRules.trim()}`
      : '',
    suggestedRoutesBlock,
    toggles.characterCards ? formatPlayerProfileForCore(novel, {
      nsfwEnabled: true,
    }) : '',
    toggles.characterCards ? formatCastRosterForCore(novel) : '',
    toggles.worldCards ? formatLoreRosterForCore(novel) : '',
    contextPackBlock,
    runtimeStateFallbackBlock ? `【人物当前状态·作者锁定】\n${runtimeStateFallbackBlock}` : '',
    activeArcBlock ? `【人物弧线计划】\n${activeArcBlock}` : '',
    !contextPack && memoryState?.currentChapter?.trim()
      ? `【当前章节】${memoryState.currentChapter.trim()}`
      : '',
    // Memory blocks: skip when memorySystemEnabled is explicitly false.
    !contextPack && memoryState?.memorySystemEnabled !== false && memoryState?.longTermMemory?.trim()
      ? `【长期总结】\n${memoryState.longTermMemory.trim()}`
      : '',
    !contextPack && memoryState?.memorySystemEnabled !== false && midTermBlock ? `【过往记忆】\n${midTermBlock}` : '',
    !contextPack && memoryState?.memorySystemEnabled !== false && shortTermBlock ? `【近期记忆】\n${shortTermBlock}` : '',
    memoryState?.regressionEcho?.trim()
      ? `【回归残响】\n（来自另一条时间线的教训，仅供主角做出不同选择；不要写成当前线已经发生的事。）\n${memoryState.regressionEcho.trim()}`
      : '',
    memoryState?.memorySystemEnabled !== false
      ? '请用第三人称小说正文续写，并遵循世界、角色人设与已注入记忆；配角与设定库细节仅在提及时提供。'
      : '请用第三人称小说正文续写，并遵循世界与角色人设；配角与设定库细节仅在提及时提供。',
  ];

  return sections.filter(Boolean).join('\n\n');
}

export type SessionPromptOverrides = {
  contextLength?: number;
  mainPrompt?: string;
  prefix?: string;
  suffix?: string;
  /** Novel-only: which optional core blocks to inject. */
  injectionToggles?: Partial<NovelInjectionToggles> | null;
};

export function buildNovelMessages({
  novel,
  globalSystemPrompt,
  history,
  authorsNote,
  agentHandoff,
  worldbookEntries,
  sessionConfig,
  memoryState,
  contentStyle,
  maxContextTokens,
  contextPack,
}: {
  novel: Novel;
  globalSystemPrompt: string;
  history: ContextHistoryMessage[];
  authorsNote: string;
  agentHandoff?: string;
  worldbookEntries: WorldbookEntry[];
  sessionConfig?: SessionPromptOverrides;
  memoryState?: {
    longTermMemory?: string;
    midTermMemories?: string[];
    shortTermMemories?: string[];
    regressionEcho?: string;
    currentChapter?: string;
    memorySystemEnabled?: boolean;
  };
  contentStyle?: ContentStyleContext | null;
  maxContextTokens?: number;
  contextPack?: NovelContextPack | null;
}): OpenAIChatMessage[] {
  novel = getNarrativeNovel(novel);
  const windowHistory = history;
  const activeQuickTravelWorld = novel.quickTravel?.worlds.find(
    (world) => world.id === novel.quickTravel?.activeWorldId,
  ) ?? novel.quickTravel?.worlds[0];
  const isQuickTravelNovelGeneration =
    activeQuickTravelWorld?.runtime.novelGenerationEnabled === true;
  const latestUserInstruction = [...history]
    .reverse()
    .find((message) => message.role === 'user')?.content;
  const outlineRuntime = resolveNovelOutlineTurnRuntime(novel, latestUserInstruction);
  const includeCharacterCards = sessionConfig?.injectionToggles?.characterCards !== false;
  const includeWorldCards = sessionConfig?.injectionToggles?.worldCards !== false;
  const knowledgeEntries = includeCharacterCards
    ? dossiersToWorldbookEntries(ensureNovelDossiers(novel), {
        nsfwEnabled: true,
        protagonistCastIds: getProtagonistCastIds(novel.cast),
        protagonistNameKeys: getProtagonistNameKeys(novel.cast),
        cast: novel.cast,
      })
    : [];
  const loreEntries = includeWorldCards
    ? loreEntriesToWorldbookEntries(ensureNovelLoreEntries(novel))
    : [];
  return buildContextPayload({
    coreMemory: buildNovelCoreMemory(
      novel,
      globalSystemPrompt,
      memoryState,
      contentStyle,
      sessionConfig?.injectionToggles,
      contextPack,
      history.slice(-8).map((message) => message.content).join('\n'),
    ),
    mainPrompt: sessionConfig?.mainPrompt,
    history: windowHistory,
    contextLength: sessionConfig?.contextLength,
    prefix: sessionConfig?.prefix,
    suffix: isQuickTravelNovelGeneration
      ? [sessionConfig?.suffix?.trim(), QUICK_TRAVEL_NOVEL_REPLY_HINT]
          .filter(Boolean)
          .join('\n\n')
      : outlineRuntime
        ? [
            sessionConfig?.suffix?.trim(),
            '【整章输出】本轮必须完成当前大纲中的一整章，只输出章节标题和正文，并严格停在下一章边界之前。',
          ].filter(Boolean).join('\n\n')
      : sessionConfig?.suffix,
    authorsNote,
    agentHandoff,
    // Retrieve scene references first, then follow references in matched knowledge.
    worldbookEntries: [
      ...knowledgeEntries,
      ...loreEntries,
      ...(includeWorldCards ? worldbookEntries : []),
    ],
    maxContextTokens,
    worldbookRetrievalSeed: [
      buildNovelRetrievalSeed(novel, latestUserInstruction ?? '', history.slice(-8).filter((message) => message.role === 'assistant').map((message) => message.content).join('\n')),
      authorsNote,
      agentHandoff,
      ...(contextPack?.currentScene ?? []).map((item) => item.text),
      ...(contextPack?.relevantRelations ?? []).map((item) => item.text),
    ].filter(Boolean).join('\n'),
  });
}

async function executeChatCompletionRequest({
  apiSettings,
  messages,
  onDelta,
  onReasoningDelta,
  purpose,
  signal: externalSignal,
}: {
  apiSettings: ApiSettings;
  messages: OpenAIChatMessage[];
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  purpose?: string;
  signal?: AbortSignal;
}): Promise<ChatCompletionResult & { finishReason?: string }> {
  let debugSnapshotRecorded = false;
  const recordSnapshot = (partial: Omit<DebugRequestSnapshot, 'at'> & { at?: string }) => {
    debugSnapshotRecorded = true;
    recordDebugSnapshot({
      ...partial,
      providerId: apiSettings.providerId,
      providerName: apiSettings.providerName,
    });
  };

  const baseUrl = apiSettings.baseUrl.trim().replace(/\/+$/, '');
  const effectiveModel = apiSettings.model.trim();
  const timeoutMs = resolveTimeoutMs(apiSettings);

  if (!baseUrl) {
    throw new Error('请先在系统设置中为当前激活厂商填写 Base URL。');
  }

  if (!effectiveModel) {
    throw new Error('请先选择可用模型（系统设置或对话页模型切换）。');
  }

  const debugEnabled = apiSettings.debugPromptInspectorEnabled;
  const thinkingDisabled = Boolean(apiSettings.thinkingDisabled);
  const protocol = resolveWireProtocol(apiSettings);
  const useGeminiNative = shouldUseGeminiNativeTransport({
    baseUrl,
    protocol,
    providerId: apiSettings.providerId,
  });

  logOutgoingLlmRequestToTerminal({
    model: effectiveModel,
    baseUrl,
    streaming: apiSettings.streamingEnabled,
    thinkingDisabled,
    messages,
    purpose,
    fullDump: debugEnabled,
  });

  const body: Record<string, unknown> =
    protocol === 'anthropic-messages'
      ? buildAnthropicRequestBody({
          model: effectiveModel,
          messages,
          temperature: apiSettings.temperature,
          maxTokens: apiSettings.maxTokens,
          streaming: apiSettings.streamingEnabled,
          thinkingDisabled,
        })
      : protocol === 'openai-responses'
        ? buildResponsesRequestBody({
            model: effectiveModel,
            messages,
            maxTokens: apiSettings.maxTokens,
            streaming: apiSettings.streamingEnabled,
            thinkingDisabled,
            modelCapability: apiSettings.modelCapability,
            thinkingConfigured: apiSettings.thinkingConfigured,
          })
        : {
            model: effectiveModel,
            messages,
            temperature: apiSettings.temperature,
            max_tokens: apiSettings.maxTokens,
            stream: apiSettings.streamingEnabled,
            ...(apiSettings.streamingEnabled
              ? {
                  stream_options: {
                    include_usage: true,
                  },
                }
              : {}),
            // V4 thinking burns max_tokens into reasoning_content → empty content + finish_reason=length.
            ...buildThinkingBody(
              apiSettings.providerId,
              effectiveModel,
              thinkingDisabled,
              apiSettings.thinkingConfigured,
              apiSettings.thinkingParameter,
            ),
          };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = apiSettings.apiKey.trim();

  if (apiKey) {
    if (protocol === 'anthropic-messages' || apiSettings.auth === 'x-api-key') {
      headers['x-api-key'] = apiKey;
    } else if (protocol === 'google-generate-content' || apiSettings.auth === 'x-goog-api-key') {
      headers['x-goog-api-key'] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
  }

  const controller = new AbortController();
  let timedOut = false;
  // Long-form novel writing may pause between chunks; leave it under user cancellation.
  const timeoutId = purpose === 'novel-chat'
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
  let partialContent = '';
  let emittedReasoning = false;
  const emitDelta = (delta: string) => {
    partialContent += delta;
    onDelta?.(delta);
  };
  const emitReasoningDelta = (delta: string) => {
    emittedReasoning = true;
    onReasoningDelta?.(delta);
  };
  const withPartialOutput = (error: Error) =>
    (onDelta && partialContent) || (onReasoningDelta && emittedReasoning)
      ? new PartialStreamError(error, partialContent)
      : error;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    // OpenAI-compat for Gemini ignores safety_settings; use native generateContent instead.
    if (useGeminiNative) {
      try {
        const geminiResult = await completeGeminiNative({
          baseUrl,
          apiKey,
          model: effectiveModel,
          messages,
          temperature: apiSettings.temperature,
          maxTokens: apiSettings.maxTokens,
          streaming: apiSettings.streamingEnabled,
          includeThoughts: !thinkingDisabled,
          signal: controller.signal,
          onDelta: emitDelta,
          onReasoningDelta: emitReasoningDelta,
        });

        const content = geminiResult.content.trim();
        if (!content) {
          throw new Error(formatEmptyResponseError(geminiResult.finishReason));
        }

        if (debugEnabled) {
          recordSnapshot({
            model: effectiveModel,
            baseUrl,
            streaming: apiSettings.streamingEnabled,
            purpose,
            messages,
            responseContent: geminiResult.content,
            reasoningContent: geminiResult.reasoningContent,
            responseTokens: {
              promptTokens: geminiResult.promptTokens,
              completionTokens: geminiResult.completionTokens,
            },
            finishReason: geminiResult.finishReason,
          });
        }

        logOutgoingLlmRequestResponseToTerminal({
          content: geminiResult.content,
          finishReason: geminiResult.finishReason,
          purpose,
          debugEnabled,
        });

        return {
          content,
          reasoningContent: geminiResult.reasoningContent,
          promptTokens: geminiResult.promptTokens,
          completionTokens: geminiResult.completionTokens,
          finishReason: geminiResult.finishReason,
          model: effectiveModel,
        };
      } catch (geminiError) {
        if (debugEnabled) {
          recordSnapshot({
            model: effectiveModel,
            baseUrl,
            streaming: apiSettings.streamingEnabled,
            purpose,
            messages,
            error: geminiError instanceof Error ? geminiError.message : String(geminiError),
          });
        }
        throw geminiError;
      }
    }

  const endpoint =
      protocol === 'anthropic-messages'
        ? `${baseUrl}${/\/v1$/i.test(baseUrl) ? '' : '/v1'}/messages`
        : protocol === 'openai-responses'
          ? `${baseUrl}${/\/v1$/i.test(baseUrl) ? '' : '/v1'}/responses`
          : `${baseUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (apiSettings.streamingEnabled) {
      const result = await readStreamingResponse(response, emitDelta, {
        continuationOnTruncation: apiSettings.continuationOnTruncation,
        protocol,
        onReasoningDelta: emitReasoningDelta,
      });

      if (apiSettings.debugPromptInspectorEnabled) {
        recordSnapshot({
          model: effectiveModel,
          baseUrl,
          streaming: true,
          purpose,
          messages,
          responseContent: result.content,
          reasoningContent: result.reasoningContent,
          responseTokens: {
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          },
          finishReason: result.finishReason,
        });
      }

      logOutgoingLlmRequestResponseToTerminal({
        content: result.content,
        finishReason: result.finishReason,
        purpose,
        debugEnabled,
      });

      return { ...result, model: effectiveModel };
    }

    const responseText = await response.text();
    const responses = protocol === 'openai-responses' ? parseResponsesResponse(responseText) : undefined;
    const native = protocol === 'anthropic-messages' ? parseAnthropicResponse(responseText) : responses;
    const data = native ? undefined : parseChatCompletionResponse(responseText);
    const finishReason = native?.finishReason ?? data?.choices?.[0]?.finish_reason;

    if (!response.ok) {
      const error = new Error(
        normalizeProviderError(native?.error || data?.error?.message || responseText, response.status),
      );

      if (apiSettings.debugPromptInspectorEnabled) {
        recordSnapshot({
          model: effectiveModel,
          baseUrl,
          streaming: false,
          purpose,
          messages,
          finishReason,
          error: error.message,
        });
      }

      throw error;
    }

    const content = (native?.content ?? extractAssistantText(data?.choices?.[0] ?? {})).trim();
    const reasoningContent = (
      native?.reasoningContent ?? extractAssistantReasoning(data?.choices?.[0] ?? {})
    ).trim();

    if (!content) {
      const message = data?.choices?.[0]?.message;
      const messageRefusal = typeof message?.refusal === 'string' ? message.refusal.trim() : '';
      const partRefusal = Array.isArray(message?.content) ? refusalFromParts(message.content) : undefined;
      const refusal = responses?.refusal ?? (messageRefusal || partRefusal);
      const error = refusal !== undefined
        ? new ModelRefusalError(refusal)
        : new Error(formatEmptyResponseError(finishReason));

      if (apiSettings.debugPromptInspectorEnabled) {
        recordSnapshot({
          model: effectiveModel,
          baseUrl,
          streaming: false,
          purpose,
          messages,
          finishReason,
          error: error.message,
        });
      }

      throw error;
    }

    const usage = native?.usage ?? extractUsage(data?.usage);

    if (apiSettings.debugPromptInspectorEnabled) {
      recordSnapshot({
        model: effectiveModel,
        baseUrl,
        streaming: false,
        purpose,
        messages,
        responseContent: content,
        reasoningContent: reasoningContent || undefined,
        responseTokens: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
        },
        finishReason,
      });
    }

    logOutgoingLlmRequestResponseToTerminal({
      content: content,
      finishReason,
      purpose,
      debugEnabled,
    });

    const truncated =
      isTruncationFinishReason(finishReason) && !apiSettings.continuationOnTruncation
        ? '\n\n（回复因长度上限被截断；可在系统设置调高对话长度上限，或开启「截断时自动续写」）'
        : '';

    return {
      content: `${content}${truncated}`,
      reasoningContent: reasoningContent || undefined,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      finishReason,
      model: effectiveModel,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw withPartialOutput(createNovelRequestAbortError());
      }

      if (!timedOut) {
        throw withPartialOutput(error);
      }

      const timeoutError = new Error(
        `请求超时（>${Math.round(timeoutMs / 1000)}s）。请检查网络或在高级设置中调高超时时间。`,
      );

      if (apiSettings.debugPromptInspectorEnabled) {
        recordSnapshot({
          model: effectiveModel,
          baseUrl,
          streaming: apiSettings.streamingEnabled,
          purpose,
          messages,
          error: timeoutError.message,
        });
      }

      throw withPartialOutput(timeoutError);
    }

    if (apiSettings.debugPromptInspectorEnabled && !debugSnapshotRecorded && error instanceof Error) {
      recordSnapshot({
        model: effectiveModel,
        baseUrl,
        streaming: apiSettings.streamingEnabled,
        purpose,
        messages,
        error: error.message,
      });
    }

    throw error instanceof Error ? withPartialOutput(error) : error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

const TRUNCATION_NOTICE_SUFFIX =
  '\n\n（回复因长度上限被截断；可在系统设置调高对话长度上限，或开启「截断时自动续写」）';

function stripTruncationNotice(content: string) {
  return content.endsWith(TRUNCATION_NOTICE_SUFFIX)
    ? content.slice(0, -TRUNCATION_NOTICE_SUFFIX.length).trim()
    : content.trim();
}

/**
 * Lightweight completion for memory / utility JSON jobs.
 * Honors apiSettings.streamingEnabled (memory path prefers true for provider reliability).
 * Returns the full collected content string; non-empty truncated replies are kept.
 */
/**
 * Non-streaming completion that surfaces raw usage + delta callback.
 * Used by the continuation pipeline so per-task token stats can be recorded.
 */
export async function requestCompletionWithUsage({
  apiSettings,
  messages,
  purpose = 'utility',
  onDelta,
  onReasoningDelta,
  maxTokens,
  temperature,
  stripNotice = true,
  signal,
  responseFormat,
  validateJson,
  allowPartialJson,
}: {
  apiSettings: ApiSettings;
  messages: OpenAIChatMessage[];
  /** Terminal tag: chapter-write | rule-audit | fact-check | extract-context | … */
  purpose?: string;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  maxTokens?: number;
  temperature?: number;
  /** Strip the truncation notice suffix before returning. Defaults true. */
  stripNotice?: boolean;
  /** Abort an in-flight utility request together with the main novel turn. */
  signal?: AbortSignal;
  /** Only model-authored JSON; transport responses and prose stay untouched. */
  responseFormat?: 'json';
  validateJson?: (value: unknown) => boolean;
  allowPartialJson?: boolean;
}): Promise<ChatCompletionResult> {
  const completionSettings: ApiSettings = {
    ...apiSettings,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  const result = await withRetries({
    retryCount: resolveRetryCount(completionSettings),
    run: () =>
      executeChatCompletionRequest({
        apiSettings: completionSettings,
        messages,
        onDelta,
        onReasoningDelta,
        purpose,
        signal,
      }),
  });

  const completion = {
    ...result,
    content: stripNotice ? stripTruncationNotice(result.content) : result.content.trim(),
  };
  if (responseFormat !== 'json') return completion;
  return recoverStructuredResponse(completion, {
    signal,
    allowPartial: allowPartialJson,
    validate: validateJson ?? ((value) => value !== null && typeof value === 'object'),
    repair: (prompt) => executeChatCompletionRequest({
      apiSettings: { ...completionSettings, streamingEnabled: false, continuationOnTruncation: false,
        temperature: Math.min(completionSettings.temperature, 0.3) },
      messages: [...messages, { role: 'assistant', content: completion.content }, { role: 'user', content: prompt }],
      purpose: `${purpose}-json-repair`,
      signal,
    }),
  });
}

export async function requestPlainCompletion({
  apiSettings,
  messages,
  purpose = 'utility',
  signal,
  responseFormat,
  validateJson,
}: {
  apiSettings: ApiSettings;
  messages: OpenAIChatMessage[];
  /** Terminal tag: utility-memory | utility-experience | utility-routes | … */
  purpose?: string;
  signal?: AbortSignal;
  responseFormat?: 'json';
  validateJson?: (value: unknown) => boolean;
}): Promise<string> {
  if (responseFormat === 'json') {
    const result = await requestCompletionWithUsage({ apiSettings, messages, purpose, signal, responseFormat, validateJson });
    return result.content;
  }
  const plainSettings: ApiSettings = {
    ...apiSettings,
    temperature: Math.min(apiSettings.temperature, 0.6),
  };

  const result = await withRetries({
    retryCount: resolveRetryCount(plainSettings),
    run: () =>
      executeChatCompletionRequest({
        apiSettings: plainSettings,
        messages,
        purpose,
        signal,
      }),
  });

  const content = stripTruncationNotice(result.content);

  // Non-empty truncated replies are usable (e.g. memory clamp); only empty+length throws upstream.
  if (
    !plainSettings.continuationOnTruncation ||
    !isTruncationFinishReason(result.finishReason) ||
    !content
  ) {
    return content;
  }

  const continued = await executeChatCompletionRequest({
    apiSettings: { ...plainSettings, continuationOnTruncation: false },
    messages: [
      ...messages,
      { role: 'assistant', content },
      {
        role: 'user',
        content: '请从上一轮被截断处无缝继续，不要重复已写出的内容，不要道歉或解释。',
      },
    ],
    purpose,
    signal,
  });

  return `${content}\n${stripTruncationNotice(continued.content)}`;
}

export async function requestChatCompletion({
  apiSettings,
  novel,
  globalSystemPrompt = '',
  history,
  authorsNote = '',
  agentHandoff = '',
  worldbookEntries = [],
  sessionConfig,
  memoryState,
  contentStyle,
  contextPack,
  onDelta,
  onReasoningDelta,
  signal,
}: {
  apiSettings: ApiSettings;
  novel?: Novel;
  globalSystemPrompt?: string;
  history: ContextHistoryMessage[];
  authorsNote?: string;
  agentHandoff?: string;
  worldbookEntries?: WorldbookEntry[];
  sessionConfig?: SessionPromptOverrides;
  memoryState?: {
    longTermMemory?: string;
    midTermMemories?: string[];
    shortTermMemories?: string[];
    regressionEcho?: string;
    currentChapter?: string;
    memorySystemEnabled?: boolean;
  };
  contentStyle?: ContentStyleContext | null;
  contextPack?: NovelContextPack | null;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  signal?: AbortSignal;
}) {
  if (!novel) {
    throw new Error('缺少小说上下文。');
  }

  const latestUserInstruction = [...history]
    .reverse()
    .find((message) => message.role === 'user')?.content;
  const outlineRuntime = resolveNovelOutlineTurnRuntime(novel, latestUserInstruction);
  const isOutlineChapterGeneration = outlineRuntime !== null;
  const effectiveSessionConfig: SessionPromptOverrides = {
    ...sessionConfig,
    // The old generic custom-config page has been retired. Novel rules,
    // world outline, knowledge base and memory each own their dedicated lane.
    mainPrompt: undefined,
    prefix: undefined,
    suffix: undefined,
  };
  const effectiveApiSettings: ApiSettings = {
    ...apiSettings,
    // A chapter must not silently stop at the provider's first length boundary.
    // Keep the user's global setting for other chat, but always make one seamless
    // continuation available while chapter-driven writing is active.
    continuationOnTruncation: apiSettings.continuationOnTruncation || isOutlineChapterGeneration,
  };
  const characterStatesById = new Map(
    (novel.novelStoryAnalysis?.characterStates ?? [])
      .filter((state) => !state.stale)
      .map((state) => [state.characterId, state] as const),
  );

  const effectiveContextPack =
    contextPack ??
    buildNovelContextPackFromState(effectiveApiSettings, novel, {
      currentChapterGoal:
        buildNovelOutlineChapterGuidance(outlineRuntime) || memoryState?.currentChapter,
      currentScene: memoryState?.shortTermMemories?.[0],
      recentMessages: history.slice(-24).map((message, index) => ({ id: message.id ?? `history-${index}`, role: message.role, content: message.content })),
      recentChapterSummaries: novel.novelStoryAnalysis?.chapterSummaries?.length
        ? novel.novelStoryAnalysis.chapterSummaries.slice(-8).map((item) => ({
            chapter: item.chapter,
            title: item.title,
            summary: [item.events, item.stateChanges, item.hookActivity, item.mood].filter(Boolean).join('；'),
            stateVersion: item.stateVersion,
            stale: item.stale,
          }))
        : (novel.chapters ?? []).filter((chapter) => chapter.status === 'final').slice(-8).map((chapter) => ({
            chapter: chapter.index,
            title: chapter.title,
            summary: [chapter.summary, chapter.goal].filter(Boolean).join('；'),
          })),
      activeCharacters: ((novel.novelStoryAnalysis?.characters ?? []).filter((item) => !item.stale).length
        ? (novel.novelStoryAnalysis?.characters ?? []).filter((item) => !item.stale)
        : novel.novelStoryFacts
        ?.filter((fact) => /character|person/i.test(fact.factType))
        .map((fact) => ({
          id: fact.subjectId ?? fact.id,
          name: fact.subjectId ?? fact.id,
          profile: fact.contentJson,
          stateVersion: fact.stateVersion,
          confidence: fact.confidence,
          locked: fact.locked,
          stale: fact.stale,
          sourceEventIds: [fact.sourceEventId],
        })) ?? []).map((character) => ({
        id: character.id,
        name: character.name,
        profile: character.profile,
        stateVersion: character.stateVersion,
        confidence: character.confidence,
        locked: character.locked,
        stale: character.stale,
        sourceEventIds: character.sourceEventIds,
      })).map((character) => {
        const runtimeState = characterStatesById.get(character.id);
        return {
          ...character,
          currentState: formatCharacterRuntimeStateForPrompt(runtimeState) || undefined,
          stateVersion: runtimeState?.stateVersion ?? character.stateVersion,
          locked: runtimeState?.locked ?? character.locked,
          sourceEventIds: runtimeState?.sourceEventIds ?? character.sourceEventIds,
        };
      }),
      lockedWorldFacts: ((novel.novelStoryAnalysis?.worldFacts ?? []).filter((item) => !item.stale).length
        ? (novel.novelStoryAnalysis?.worldFacts ?? []).filter((item) => !item.stale)
        : novel.novelStoryFacts
        ?.filter((fact) => /world|lore|fact/i.test(fact.factType))
        .map((fact) => ({
          id: fact.id,
          subject: fact.subjectId ?? fact.factType,
          content: fact.contentJson,
          stateVersion: fact.stateVersion,
          locked: fact.locked,
          stale: fact.stale,
          sourceEventIds: [fact.sourceEventId],
        })) ?? []).map((fact) => ({
        id: fact.id,
        subject: fact.subject,
        content: fact.content,
        stateVersion: fact.stateVersion,
        locked: fact.locked,
        stale: fact.stale,
        sourceEventIds: fact.sourceEventIds,
      })),
      relevantRelations: resolveEffectiveCharacterRelationships(
        novel.cast,
        novel.novelStoryAnalysis?.relationships ?? [],
        { includeStaticFallback: false },
      ),
      unresolvedHooks: [
        ...(novel.novelStoryAnalysis?.hooks ?? []).filter((item) => !item.stale),
        ...((novel.novelStoryAnalysis?.hooks ?? []).some((item) => !item.stale)
          ? []
          : (novel.novelStoryFacts ?? [])
              .filter((fact) => fact.factType === 'hook' && !fact.stale)
              .map((fact) => {
                let value: Record<string, unknown> = {};
                try { value = JSON.parse(fact.contentJson) as Record<string, unknown>; } catch { value = {}; }
                return {
                  id: String(value.id ?? fact.subjectId ?? fact.id),
                  keyword: String(value.keyword ?? fact.subjectId ?? ''),
                  description: String(value.description ?? ''),
                  status: String(value.status ?? 'open'),
                  stateVersion: fact.stateVersion,
                  stale: fact.stale,
                  sourceEventIds: [fact.sourceEventId],
                };
              })),
        ...(novel.foreshadowings ?? []).map((hook) => ({
          id: hook.id,
          keyword: hook.keyword,
          description: hook.description,
          status: hook.status === 'open' ? 'open' : 'resolved',
          stateVersion: hook.stateVersion,
          stale: hook.stale,
          sourceEventIds: hook.sourceEventIds,
        })),
      ],
      styleConstraints: contentStyle ? [contentStyle.settings.defaultWritingStyle ?? ''] : [],
      worldbookEntries,
    });

  const messages = buildNovelMessages({
    novel,
    globalSystemPrompt,
    history,
    authorsNote,
    agentHandoff,
    worldbookEntries,
    sessionConfig: effectiveSessionConfig,
    memoryState,
    contentStyle,
    maxContextTokens: resolveContextTokenBudget(effectiveApiSettings),
    contextPack: effectiveContextPack,
  });

  const result = await withRetries({
    retryCount: resolveRetryCount(effectiveApiSettings),
    run: () =>
      executeChatCompletionRequest({
        apiSettings: effectiveApiSettings,
        messages,
        onDelta,
        onReasoningDelta,
        purpose: 'novel-chat',
        signal,
      }),
  });

  if (
    !effectiveApiSettings.continuationOnTruncation ||
    !isTruncationFinishReason(result.finishReason) ||
    !result.content.trim()
  ) {
    validateNovelChatResponse({
      content: result.content,
      finishReason: result.finishReason,
      targetWords: outlineRuntime?.targetWords,
    });
    return { ...result, contextManifest: effectiveContextPack.contextManifest, contextStateVersion: effectiveContextPack.stateVersion };
  }

  const continueMessages: OpenAIChatMessage[] = [
    ...messages,
    { role: 'assistant', content: result.content.trim() },
    {
      role: 'user',
      content: '请从上一轮被截断处无缝继续写作，不要重复已写出的内容，不要道歉或解释。',
    },
  ];

  const continued = await executeChatCompletionRequest({
    apiSettings: { ...effectiveApiSettings, continuationOnTruncation: false },
    messages: continueMessages,
    onDelta,
    onReasoningDelta,
    purpose: 'novel-chat',
    signal,
  });

  const promptTokens =
    (result.promptTokens ?? 0) + (continued.promptTokens ?? 0);
  const completionTokens =
    (result.completionTokens ?? 0) + (continued.completionTokens ?? 0);

  const completedContent = `${result.content.trim()}\n${stripTruncationNotice(continued.content)}`;
  validateNovelChatResponse({
    content: completedContent,
    finishReason: continued.finishReason,
    targetWords: outlineRuntime?.targetWords,
  });

  return {
    content: completedContent,
    reasoningContent: [result.reasoningContent, continued.reasoningContent]
      .map((item) => item?.trim())
      .filter(Boolean)
      .join('\n\n') || undefined,
    promptTokens: promptTokens > 0 ? promptTokens : undefined,
    completionTokens: completionTokens > 0 ? completionTokens : undefined,
    model: continued.model ?? result.model,
    finishReason: continued.finishReason,
    contextManifest: effectiveContextPack.contextManifest,
    contextStateVersion: effectiveContextPack.stateVersion,
  };
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 2);
}

function estimateMessageTokens(message: OpenAIChatMessage) {
  return estimateTokens(message.content) + 4;
}

function estimateMessagesTokens(messages: OpenAIChatMessage[]) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function truncateHistoryFromOldest(
  history: OpenAIChatMessage[],
  tokenBudget: number,
  minKeep = MIN_PROTECTED_HISTORY_MESSAGES,
) {
  if (history.length === 0) {
    return [] as OpenAIChatMessage[];
  }

  const keepFloor = Math.min(history.length, Math.max(0, Math.round(minKeep)));

  // Core memory ate the whole budget — still keep the newest turns so the model
  // does not greet / reset as if the previous reply never happened.
  if (tokenBudget <= 0) {
    return history.slice(-keepFloor);
  }

  let kept = [...history];

  while (kept.length > keepFloor && estimateMessagesTokens(kept) > tokenBudget) {
    kept = kept.slice(1);
  }

  return kept;
}

function insertAuthorsNoteAtDepth(
  chatMessages: OpenAIChatMessage[],
  authorsNoteMessage: OpenAIChatMessage | null,
  depth: number,
) {
  if (!authorsNoteMessage || chatMessages.length === 0) {
    return chatMessages;
  }

  const safeDepth = Math.max(1, Math.floor(depth));
  const insertIndex = Math.max(0, chatMessages.length - safeDepth);
  const next = [...chatMessages];
  next.splice(insertIndex, 0, authorsNoteMessage);
  return next;
}

/** Insert PHI immediately before the latest user message (spec §5 step 9→10). */
function insertPostHistoryInstructions(
  chatMessages: OpenAIChatMessage[],
  phiMessage: OpenAIChatMessage | null,
) {
  if (!phiMessage) {
    return chatMessages;
  }

  let lastUserIndex = -1;
  for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
    if (chatMessages[index].role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex < 0) {
    return [...chatMessages, phiMessage];
  }

  const next = [...chatMessages];
  next.splice(lastUserIndex, 0, phiMessage);
  return next;
}

function buildAuthorsNoteMessage(authorsNote: string): OpenAIChatMessage | null {
  const trimmedAuthorsNote = authorsNote.trim();

  if (!trimmedAuthorsNote) {
    return null;
  }

  return {
    role: 'system',
    content: `【当前剧情记忆】\n${trimmedAuthorsNote}`,
  };
}

function buildAgentHandoffMessage(agentHandoff: string): OpenAIChatMessage | null {
  const trimmed = agentHandoff.trim();
  if (!trimmed) {
    return null;
  }
  return {
    role: 'system',
    content: `【本回合协作上下文】\n${trimmed}`,
  };
}

function buildPostHistoryInstructionsMessage(
  instructions: string,
): OpenAIChatMessage | null {
  const trimmed = instructions.trim();

  if (!trimmed) {
    return null;
  }

  return {
    role: 'system',
    content: `【历史后指令】\n${trimmed}`,
  };
}

export type PromptInjectionManifestItem = Pick<WorldbookMatch, 'id' | 'priority' | 'reason'> & {
  chars: number;
  estimatedTokens: number;
};


function buildWorldbookMessage(
  worldbookEntries: WorldbookEntry[],
  recentTexts: string[],
  maxTokens: number,
  retrievalSeed?: string,
): OpenAIChatMessage | null {
  const matches = retrievalSeed !== undefined
    ? scanWorldbookEntriesRecursively(worldbookEntries, [retrievalSeed, ...recentTexts].join('\n'), maxTokens)
    : scanWorldbookEntriesDetailed({
        entries: worldbookEntries,
        recentTexts,
        scanMessageCount: WORLDBOOK_SCAN_MESSAGE_COUNT,
      });
  const injectionBudget = Math.max(256, Math.round(maxTokens));
  let consumed = 0;
  const matchedContent = matches
    .filter((match) => {
      if (consumed >= injectionBudget) return false;
      consumed += match.estimatedTokens;
      return true;
    })
    .map((match) => match.content)
    .join('\n\n');

  if (!matchedContent) {
    return null;
  }

  return {
    role: 'system',
    content: `[附加世界设定：${matchedContent}]`,
  };
}

function findLatestUserMessageIndex(messages: ContextHistoryMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index;
    }
  }

  return -1;
}

export async function readStreamingResponse(
  response: Response,
  onDelta?: (delta: string) => void,
  options?: {
    continuationOnTruncation?: boolean;
    protocol?: WireProtocol;
    onReasoningDelta?: (delta: string) => void;
  },
): Promise<ChatCompletionResult> {
  if (!response.ok) {
    const responseText = await response.text();
    const nativeError = options?.protocol === 'anthropic-messages'
      ? parseAnthropicResponse(responseText).error
      : options?.protocol === 'openai-responses'
        ? parseResponsesResponse(responseText).error
        : undefined;
    const data = parseChatCompletionResponse(responseText);

    throw new Error(normalizeProviderError(nativeError || data.error?.message || responseText, response.status));
  }

  if (!response.body) {
    throw new Error('当前运行环境不支持流式响应。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullReasoningContent = '';
  let usage: TokenUsage = {};
  let finishReason = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = parseStreamingLine(line, options?.protocol);

        if (parsed.finishReason) {
          finishReason = parsed.finishReason;
        }

        if (parsed.usage.promptTokens !== undefined || parsed.usage.completionTokens !== undefined) {
          usage = {
            promptTokens: parsed.usage.promptTokens ?? usage.promptTokens,
            completionTokens: parsed.usage.completionTokens ?? usage.completionTokens,
          };
        }

        if (parsed.delta) {
          fullContent += parsed.delta;
          onDelta?.(parsed.delta);
        }
        if (parsed.reasoningDelta) {
          fullReasoningContent += parsed.reasoningDelta;
          options?.onReasoningDelta?.(parsed.reasoningDelta);
        }
      }
    }

    buffer += decoder.decode();

    if (buffer) {
      const parsed = parseStreamingLine(buffer, options?.protocol);

      if (parsed.finishReason) {
        finishReason = parsed.finishReason;
      }

      if (parsed.usage.promptTokens !== undefined || parsed.usage.completionTokens !== undefined) {
        usage = {
          promptTokens: parsed.usage.promptTokens ?? usage.promptTokens,
          completionTokens: parsed.usage.completionTokens ?? usage.completionTokens,
        };
      }

      if (parsed.delta) {
        fullContent += parsed.delta;
        onDelta?.(parsed.delta);
      }
      if (parsed.reasoningDelta) {
        fullReasoningContent += parsed.reasoningDelta;
        options?.onReasoningDelta?.(parsed.reasoningDelta);
      }
    }
  } catch (error) {
    // Partial content has already been delivered through onDelta. Never turn a
    // failed stream into a successful completion; callers must persist it as a
    // cancelled/error request and offer recovery.
    throw error;
  }

  if (!fullContent.trim()) {
    throw new Error(formatEmptyResponseError(finishReason || undefined));
  }

  const truncated =
    isTruncationFinishReason(finishReason) && !options?.continuationOnTruncation
      ? TRUNCATION_NOTICE_SUFFIX
      : '';

  return {
    content: `${fullContent.trim()}${truncated}`,
    reasoningContent: fullReasoningContent.trim() || undefined,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    finishReason: finishReason || undefined,
  };
}

function parseStreamingLine(line: string, protocol: WireProtocol = 'openai-compatible'): {
  delta: string;
  reasoningDelta: string;
  usage: TokenUsage;
  finishReason?: string;
} {
  const trimmedLine = line.trim();

  if (!trimmedLine || !trimmedLine.startsWith('data:')) {
    return { delta: '', reasoningDelta: '', usage: {} };
  }

  const payload = trimmedLine.replace(/^data:\s*/, '');

  if (payload === '[DONE]') {
    return { delta: '', reasoningDelta: '', usage: {} };
  }

  let chunk: Record<string, unknown>;

  try {
    chunk = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return { delta: '', reasoningDelta: '', usage: {} };
  }

  const error = chunk.error as { message?: string } | undefined;
  if (error?.message) {
    throw new Error(error.message);
  }

  if (protocol === 'anthropic-messages') {
    const delta = chunk.delta as { type?: string; text?: string; thinking?: string } | undefined;
    const usage = chunk.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const message = chunk.message as { usage?: { input_tokens?: number } } | undefined;
    return {
      delta: delta?.type === 'text_delta' ? delta.text ?? '' : '',
      reasoningDelta: delta?.type === 'thinking_delta' ? delta.thinking ?? delta.text ?? '' : '',
      usage: {
        promptTokens: usage?.input_tokens ?? message?.usage?.input_tokens,
        completionTokens: usage?.output_tokens,
      },
      finishReason:
        (chunk as { type?: string }).type === 'message_delta'
          ? ((delta as { stop_reason?: string } | undefined)?.stop_reason ?? undefined)
          : undefined,
    };
  }

  if (protocol === 'openai-responses') {
    const type = typeof chunk.type === 'string' ? chunk.type : '';
    if (type === 'response.output_text.delta') {
      return { delta: typeof chunk.delta === 'string' ? chunk.delta : '', reasoningDelta: '', usage: {} };
    }
    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning.delta') {
      return { delta: '', reasoningDelta: typeof chunk.delta === 'string' ? chunk.delta : '', usage: {} };
    }
    if (type === 'response.completed') {
      const response = chunk.response as {
        status?: string;
        incomplete_details?: { reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      } | undefined;
      return {
        delta: '',
        reasoningDelta: '',
        usage: {
          promptTokens: response?.usage?.input_tokens,
          completionTokens: response?.usage?.output_tokens,
        },
        finishReason: response?.incomplete_details?.reason ?? (response?.status === 'completed' ? 'stop' : undefined),
      };
    }
  }

  const choices = chunk.choices as {
    delta?: {
      content?: string | null;
      text?: string;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string | null;
  }[] | undefined;
  const choice = choices?.[0];
  const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  return {
    delta: extractAssistantText({ delta: choice?.delta }),
    reasoningDelta: extractAssistantReasoning({ delta: choice?.delta }),
    usage: extractUsage(usage),
    finishReason: choice?.finish_reason ?? undefined,
  };
}

function parseAnthropicResponse(responseText: string): {
  content: string;
  reasoningContent?: string;
  usage: TokenUsage;
  finishReason?: string;
  error?: string;
} {
  if (!responseText) return { content: '', usage: {} };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return { content: '', usage: {}, error: responseText };
  }
  const error = data.error as { message?: string } | undefined;
  const content = Array.isArray(data.content)
    ? data.content
        .map((item) => {
          const row = item as { type?: string; text?: string };
          return row.type === 'text' ? row.text ?? '' : '';
        })
        .join('')
    : '';
  const reasoningContent = Array.isArray(data.content)
    ? data.content
        .map((item) => {
          const row = item as { type?: string; thinking?: string; text?: string };
          return row.type === 'thinking' ? row.thinking ?? row.text ?? '' : '';
        })
        .join('')
        .trim()
    : '';
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : undefined;
  return {
    content,
    reasoningContent: reasoningContent || undefined,
    usage: {
      promptTokens: usage?.input_tokens,
      completionTokens: usage?.output_tokens,
    },
    finishReason: stopReason === 'max_tokens' ? 'length' : stopReason,
    error: error?.message,
  };
}

function parseResponsesResponse(responseText: string): {
  content: string;
  refusal?: string;
  reasoningContent?: string;
  usage: TokenUsage;
  finishReason?: string;
  error?: string;
} {
  if (!responseText) return { content: '', usage: {} };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return { content: '', usage: {}, error: responseText };
  }
  const error = data.error as { message?: string } | undefined;
  const outputText = typeof data.output_text === 'string' ? data.output_text : '';
  const output = Array.isArray(data.output) ? data.output : [];
  const parts = output.flatMap((item) => {
    const row = item as { content?: AssistantContentPart[] };
    return Array.isArray(row?.content) ? row.content : [];
  });
  const content = outputText || parts
    .filter((part) => part.type === 'output_text' || part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
  const reasoningContent = output
    .flatMap((item) => {
      const row = item as {
        type?: string;
        summary?: { type?: string; text?: string }[];
        content?: { type?: string; text?: string }[];
      };
      if (row.type !== 'reasoning') return [];
      return [...(row.summary ?? []), ...(row.content ?? [])];
    })
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const incompleteDetails = data.incomplete_details as { reason?: string } | undefined;
  const status = typeof data.status === 'string' ? data.status : undefined;
  return {
    content,
    refusal: refusalFromParts(parts),
    reasoningContent: reasoningContent || undefined,
    usage: {
      promptTokens: usage?.input_tokens,
      completionTokens: usage?.output_tokens,
    },
    finishReason: incompleteDetails?.reason ?? (status === 'completed' ? 'stop' : status),
    error: error?.message,
  };
}

function normalizeProviderError(rawMessage: string | undefined, status: number) {
  const message = rawMessage?.trim() || `请求失败：HTTP ${status}`;
  if (
    status === 401 ||
    /authentication fails?|unauthori[sz]ed|invalid api key|api key/i.test(message)
  ) {
    return '模型认证失败：请到系统设置检查 API Key、Base URL 与模型配置。';
  }
  return message;
}

function parseChatCompletionResponse(responseText: string): ChatCompletionResponse {
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText) as ChatCompletionResponse;
  } catch {
    return { error: { message: responseText } };
  }
}
