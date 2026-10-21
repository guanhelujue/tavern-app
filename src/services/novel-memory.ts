import {
  DEFAULT_LONG_TERM_MEMORY_PROMPT,
  DEFAULT_MID_TERM_MEMORY_PROMPT,
  DEFAULT_SHORT_TERM_MEMORY_PROMPT,
  LONG_TERM_COMPLETION_MAX_TOKENS,
  MEMORY_COMPLETION_ABSOLUTE_MAX,
  MID_TERM_COMPLETION_MAX_TOKENS,
  MID_TERM_MEMORY_BATCH_SIZE,
  resolveLongTermMemoryPrompt,
  resolveMidTermMemoryPrompt,
  resolveShortTermMemoryPrompt,
  SHORT_TERM_MEMORY_BATCH_SIZE,
} from '../constants/novel-memory';
import { requestPlainCompletion } from './llm';
import type { ApiSettings, Novel, OpenAIChatMessage } from '../types/tavern';

const MEMORY_DIRECT_OUTPUT_HINT = '直接输出记忆正文，不要思考过程、不要标题。';

const MEMORY_LENGTH_EMPTY_ERROR =
  '短期记忆压缩失败：模型输出被截断或为空。请到系统设置 → 高级设置调高「记忆长度上限」后重试。';

export type NovelMemoryState = {
  longTermMemory: string;
  midTermMemories: string[];
  shortTermMemories: string[];
};

export type NovelMemoryAndSummaryState = NovelMemoryState & {
  /** Hidden context used only by the Direct / Character agents. */
  agentSummary: string;
};


/**
 * Purpose floor (short/mid/long) covers reasoning overhead; user「记忆 Max Tokens」can raise further.
 * Previously Math.min(cap, budget) made raising memoryMaxTokens above 256 useless for short-term.
 */
function resolveMemoryCompletionTokens(floor: number, memoryMaxTokens: number) {
  const budget =
    typeof memoryMaxTokens === 'number' && memoryMaxTokens > 0
      ? Math.round(memoryMaxTokens)
      : floor;
  return Math.max(floor, Math.min(MEMORY_COMPLETION_ABSOLUTE_MAX, budget));
}

function withDirectOutputHint(prompt: string) {
  const base = prompt.trim();
  if (base.includes('不要思考过程')) {
    return base;
  }
  return `${base}\n\n${MEMORY_DIRECT_OUTPUT_HINT}`;
}

function isLengthOrEmptyMemoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('finish_reason=length') ||
    message.includes('返回为空') ||
    message.includes('没有返回内容') ||
    message.includes('被截断')
  );
}

function extractJsonObject(value: string): unknown {
  const source = value.trim();
  const candidates = [source];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(source.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function text(value: unknown, max = 2400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown, maxItems = 8, maxChars = 320): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, maxChars))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function formatAgentSummary(value: unknown): string {
  const direct = text(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  const source = value as Record<string, unknown>;
  const sections = [
    ['当前局面', text(source.currentSituation, 500)],
    ['关键事件', list(source.events).join('；')],
    ['人物状态', list(source.characterStates).join('；')],
    ['关系变化', list(source.relationshipChanges).join('；')],
    ['世界事实', list(source.worldFacts).join('；')],
    ['未决事项', list(source.unresolvedHooks).join('；')],
  ]
    .filter(([, content]) => content)
    .map(([label, content]) => `${label}：${content}`);
  return sections.join('\n').slice(0, 2400);
}

type ParsedMemoryAndSummary = {
  shortTermMemory: string;
  midTermMemory: string;
  longTermMemory: string;
  agentSummary: string;
};

function normalizeMemoryAndSummary(value: unknown): ParsedMemoryAndSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const parsed: ParsedMemoryAndSummary = {
    shortTermMemory: text(source.shortTermMemory ?? source.shortTerm, 600),
    midTermMemory: text(source.midTermMemory ?? source.midTerm, 1200),
    longTermMemory: text(source.longTermMemory ?? source.longTerm, 1800),
    agentSummary: formatAgentSummary(source.summary ?? source.agentSummary),
  };
  return parsed.shortTermMemory || parsed.midTermMemory || parsed.longTermMemory || parsed.agentSummary
    ? parsed
    : null;
}

/** Rewrite provider empty/length errors into memory-specific guidance. */
export function rewriteMemoryErrorMessage(message: string) {
  if (
    message.includes('finish_reason=length') ||
    message.includes('被截断') ||
    message.includes('返回为空') ||
    message.includes('没有返回内容')
  ) {
    return MEMORY_LENGTH_EMPTY_ERROR;
  }
  return message;
}

async function requestMemoryPlainCompletion({
  apiSettings,
  maxTokens,
  messages,
  retryOnLengthEmpty = false,
  retryTokenCap,
}: {
  apiSettings: ApiSettings;
  maxTokens: number;
  messages: OpenAIChatMessage[];
  retryOnLengthEmpty?: boolean;
  retryTokenCap?: number;
}) {
  try {
    return await requestPlainCompletion({
      apiSettings: {
        ...apiSettings,
        streamingEnabled: true,
        thinkingDisabled: true,
        maxTokens,
      },
      messages,
      purpose: 'utility-memory',
    });
  } catch (error) {
    if (!retryOnLengthEmpty || !isLengthOrEmptyMemoryError(error)) {
      throw error;
    }

    const retryTokens = Math.min(
      MEMORY_COMPLETION_ABSOLUTE_MAX,
      Math.max(maxTokens * 2, retryTokenCap ?? maxTokens * 2),
    );

    if (retryTokens <= maxTokens) {
      throw error;
    }

    return await requestPlainCompletion({
      apiSettings: {
        ...apiSettings,
        streamingEnabled: true,
        thinkingDisabled: true,
        maxTokens: retryTokens,
      },
      messages,
      purpose: 'utility-memory',
    });
  }
}


export async function mergeShortTermIntoMidTermMemory({
  apiSettings,
  memoryMaxTokens = MID_TERM_COMPLETION_MAX_TOKENS,
  novel,
  shortTermMemories,
}: {
  apiSettings: ApiSettings;
  memoryMaxTokens?: number;
  novel: Novel;
  shortTermMemories: string[];
}) {
  const prompt = withDirectOutputHint(
    resolveMidTermMemoryPrompt(novel.midTermMemoryPrompt) || DEFAULT_MID_TERM_MEMORY_PROMPT,
  );
  const payload = [
    `【本批近期记忆（${shortTermMemories.length} 条）】\n${shortTermMemories
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n')}`,
  ].join('\n\n');

  let content: string;
  try {
    content = await requestMemoryPlainCompletion({
      apiSettings,
      maxTokens: resolveMemoryCompletionTokens(MID_TERM_COMPLETION_MAX_TOKENS, memoryMaxTokens),
      retryOnLengthEmpty: true,
      retryTokenCap: MEMORY_COMPLETION_ABSOLUTE_MAX,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: payload },
      ],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '过往记忆合并失败，请检查后台模型配置。';
    throw new Error(rewriteMemoryErrorMessage(message));
  }

  return content.trim();
}

export async function mergeMidTermIntoLongTermMemory({
  apiSettings,
  memoryMaxTokens = LONG_TERM_COMPLETION_MAX_TOKENS,
  novel,
  longTermMemory,
  midTermMemories,
}: {
  apiSettings: ApiSettings;
  memoryMaxTokens?: number;
  novel: Novel;
  longTermMemory: string;
  midTermMemories: string[];
}) {
  const prompt = withDirectOutputHint(
    resolveLongTermMemoryPrompt(novel.longTermMemoryPrompt) || DEFAULT_LONG_TERM_MEMORY_PROMPT,
  );
  const payload = [
    `【已有长期总结】\n${longTermMemory.trim() || '（暂无）'}`,
    `【本批过往记忆（${midTermMemories.length} 条）】\n${midTermMemories
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n')}`,
  ].join('\n\n');

  let content: string;
  try {
    content = await requestMemoryPlainCompletion({
      apiSettings,
      maxTokens: resolveMemoryCompletionTokens(LONG_TERM_COMPLETION_MAX_TOKENS, memoryMaxTokens),
      retryOnLengthEmpty: true,
      retryTokenCap: MEMORY_COMPLETION_ABSOLUTE_MAX,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: payload },
      ],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '长期总结合并失败，请检查后台模型配置。';
    throw new Error(rewriteMemoryErrorMessage(message));
  }

  return content.trim();
}

/**
 * @deprecated Prefer mergeMidTermIntoLongTermMemory / mergeShortTermIntoMidTermMemory.
 * Kept for call sites that still flush short → long in one step.
 */
export async function mergeShortTermIntoLongTermMemory({
  apiSettings,
  memoryMaxTokens = LONG_TERM_COMPLETION_MAX_TOKENS,
  novel,
  longTermMemory,
  shortTermMemories,
  midTermMemories = [],
}: {
  apiSettings: ApiSettings;
  memoryMaxTokens?: number;
  novel: Novel;
  longTermMemory: string;
  shortTermMemories: string[];
  midTermMemories?: string[];
}): Promise<NovelMemoryState> {
  let nextMid = [...midTermMemories];
  let nextLong = longTermMemory;

  if (shortTermMemories.length > 0) {
    const midEntry = await mergeShortTermIntoMidTermMemory({
      apiSettings,
      memoryMaxTokens,
      novel,
      shortTermMemories,
    });
    if (midEntry.trim()) {
      nextMid.push(midEntry);
    }
  }

  if (nextMid.length > 0) {
    const merged = await mergeMidTermIntoLongTermMemory({
      apiSettings,
      memoryMaxTokens,
      novel,
      longTermMemory: nextLong,
      midTermMemories: nextMid,
    });
    nextLong = merged || nextLong;
    nextMid = [];
  }

  return {
    longTermMemory: nextLong,
    midTermMemories: nextMid,
    shortTermMemories: [],
  };
}

const UNIFIED_MEMORY_SUMMARY_PROMPT = `你是小说生成后的剧情整理器。请基于完整的本轮用户输入和 AI 正文，同时更新 8-5-1 记忆与协作 Agent 使用的隐藏 summary。

输出必须是严格 JSON，不要 Markdown、不要解释、不要思考过程：
{
  "shortTermMemory": "单条近期记忆；没有新事实时也要输出—",
  "midTermMemory": "仅当加入本轮后近期记忆达到 8 条时输出合并后的过往记忆，否则输出空字符串",
  "longTermMemory": "仅当加入本轮后过往记忆达到 5 条时输出更新后的长期总结，否则输出空字符串",
  "summary": {
    "currentSituation": "当前局面",
    "events": ["会影响后续的关键事件"],
    "characterStates": ["人物当前状态、目标或已知信息"],
    "relationshipChanges": ["关系变化"],
    "worldFacts": ["新确认的世界事实"],
    "unresolvedHooks": ["未解决目标或伏笔"]
  }
}

记忆和 summary 都只能记录输入正文中明确发生的事实，不得补写或推测。summary 要简短、客观，只供 Direct 和 Character 使用，不是小说正文。`;

export async function refreshNovelMemoryAndSummaryAfterTurn({
  apiSettings,
  memoryMaxTokens = LONG_TERM_COMPLETION_MAX_TOKENS,
  novel,
  userContent,
  assistantContent,
  longTermMemory,
  midTermMemories,
  shortTermMemories,
  agentSummary,
}: {
  apiSettings: ApiSettings;
  memoryMaxTokens?: number;
  novel: Novel;
  userContent: string;
  assistantContent: string;
  longTermMemory: string;
  midTermMemories: string[];
  shortTermMemories: string[];
  agentSummary: string;
}): Promise<NovelMemoryAndSummaryState> {
  const prompt = [
    UNIFIED_MEMORY_SUMMARY_PROMPT,
    `【短期记忆规则】\n${resolveShortTermMemoryPrompt(novel.shortTermMemoryPrompt) || DEFAULT_SHORT_TERM_MEMORY_PROMPT}`,
    `【中期记忆规则】\n${resolveMidTermMemoryPrompt(novel.midTermMemoryPrompt) || DEFAULT_MID_TERM_MEMORY_PROMPT}`,
    `【长期记忆规则】\n${resolveLongTermMemoryPrompt(novel.longTermMemoryPrompt) || DEFAULT_LONG_TERM_MEMORY_PROMPT}`,
  ].join('\n\n');
  const existingShort = shortTermMemories.filter((item) => item.trim());
  const existingMid = midTermMemories.filter((item) => item.trim());
  const payload = JSON.stringify({
    userContent: userContent.trim(),
    assistantContent: assistantContent.trim(),
    existingMemory: {
      longTermMemory: longTermMemory.trim(),
      midTermMemories: existingMid,
      shortTermMemories: existingShort,
    },
    existingSummary: agentSummary.trim(),
    afterTurnShortCount: existingShort.length + 1,
    afterTurnMidCount: existingMid.length + (existingShort.length + 1 >= SHORT_TERM_MEMORY_BATCH_SIZE ? 1 : 0),
  });

  const maxTokens = resolveMemoryCompletionTokens(LONG_TERM_COMPLETION_MAX_TOKENS, memoryMaxTokens);
  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: payload },
  ];
  let parsed: ParsedMemoryAndSummary | null;
  try {
    const raw = await requestMemoryPlainCompletion({
      apiSettings,
      maxTokens,
      retryOnLengthEmpty: true,
      retryTokenCap: MEMORY_COMPLETION_ABSOLUTE_MAX,
      messages,
    });
    parsed = normalizeMemoryAndSummary(extractJsonObject(raw));
    if (!parsed) {
      // Some gateways report finish_reason=stop even when the JSON ends mid-string.
      // Retry once with a shorter-output instruction; never persist a partial result.
      const retryRaw = await requestMemoryPlainCompletion({
        apiSettings,
        maxTokens: Math.min(MEMORY_COMPLETION_ABSOLUTE_MAX, maxTokens * 2),
        messages: [
          {
            role: 'system',
            content: `${prompt}\n\n上一次返回的 JSON 不完整或没有有效字段。请重新生成完整、可解析的 JSON；各 summary 数组最多保留两条简短事实，并确保所有引号、数组和对象闭合。`,
          },
          { role: 'user', content: payload },
        ],
      });
      parsed = normalizeMemoryAndSummary(extractJsonObject(retryRaw));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '剧情整理失败，请检查后台模型配置。';
    throw new Error(rewriteMemoryErrorMessage(message));
  }

  if (!parsed) {
    throw new Error('剧情整理模型重试后仍未返回完整、可用的 JSON 记忆与 summary。');
  }

  const nextShort = [...existingShort];
  if (parsed.shortTermMemory && parsed.shortTermMemory !== '—') {
    nextShort.push(parsed.shortTermMemory);
  }
  let nextMid = [...existingMid];
  let nextLong = longTermMemory.trim();

  if (nextShort.length >= SHORT_TERM_MEMORY_BATCH_SIZE && parsed.midTermMemory) {
    nextMid.push(parsed.midTermMemory);
    nextShort.length = 0;
  }

  if (nextMid.length >= MID_TERM_MEMORY_BATCH_SIZE && parsed.longTermMemory) {
    nextLong = parsed.longTermMemory;
    nextMid = [];
  }

  return {
    longTermMemory: nextLong,
    midTermMemories: nextMid,
    shortTermMemories: nextShort,
    agentSummary: parsed.agentSummary || agentSummary.trim(),
  };
}
