import { tryParseAiJson } from '@/utils/ai-json';
import { requestCompletionWithUsage, type ContextHistoryMessage } from '@/services/llm';
import type {
  ApiSettings,
  Novel,
  NovelCharacterBrief,
  NovelDirectPlan,
  NovelEditorReview,
} from '@/types/tavern';

const EDITOR_SYSTEM_PROMPT = `你是互动小说里的 Editor 审稿 Agent。你不重写正文，只检查 Narrator 刚生成的本回合正文是否可以直接成为正史。

请依据用户行动、Direct 计划、Character 角色简报、小说设定、角色卡和记忆，输出严格 JSON：
{
  "approved": true,
  "severity": "none",
  "issues": [],
  "revisionInstructions": ""
}

severity 只能是 none、minor、major：
- none：没有需要修改的问题；
- minor：有轻微文风或衔接问题，但不值得再次调用正文模型；
- major：违背已确认设定、角色严重出戏、遗漏本回合核心行动，或出现会污染后续记忆的事实错误。

要求：只输出 JSON，不要 Markdown、分析或重写正文；只指出有依据的问题；major 时给出简短、可执行的修订指令。不要因为个人文风偏好否定正文。`;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function extractJsonObject(value: string): unknown {
  return tryParseAiJson(value) ?? null;
}

export function normalizeNovelEditorReview(value: unknown): NovelEditorReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const issues = list(source.issues, 10);
  const revisionInstructions = text(source.revisionInstructions);
  const severity = source.severity === 'major' || source.severity === 'minor' ? source.severity : 'none';
  if (typeof source.approved !== 'boolean' && !issues.length && !revisionInstructions && severity === 'none') {
    return null;
  }
  const approved = typeof source.approved === 'boolean'
    ? source.approved
    : severity === 'none' && issues.length === 0;
  return {
    approved,
    severity,
    issues,
    revisionInstructions,
  };
}

function compact(value: string | undefined, max: number) {
  return text(value).slice(0, max);
}

type EditorMemory = {
  longTermMemory?: string;
  midTermMemories?: string[];
  shortTermMemories?: string[];
  currentChapter?: string;
};

function buildEditorInput({
  novel,
  history,
  instruction,
  draft,
  directPlan,
  characterBrief,
  memory,
}: Pick<GenerateNovelEditorReviewInput, 'novel' | 'history' | 'instruction' | 'draft' | 'directPlan' | 'characterBrief' | 'memory'>) {
  const activeWorld = novel.quickTravel?.worlds.find(
    (world) => world.id === novel.quickTravel?.activeWorldId,
  ) ?? novel.quickTravel?.worlds[0];
  return {
    instruction: compact(instruction, 1200),
    draft: compact(draft, 12000),
    directPlan: directPlan ?? undefined,
    characterBrief: characterBrief ?? undefined,
    memory: {
      longTerm: compact(memory?.longTermMemory, 1300),
      midTerm: (memory?.midTermMemories ?? []).map((item) => compact(item, 400)).filter(Boolean).slice(-5),
      shortTerm: (memory?.shortTermMemories ?? []).map((item) => compact(item, 400)).filter(Boolean).slice(-6),
      currentChapter: compact(memory?.currentChapter, 180),
    },
    novel: {
      name: compact(novel.name, 120),
      foundationPrompt: compact(novel.foundationPrompt, 2200),
      worldName: compact(novel.worldName, 160),
      worldEra: compact(novel.worldEra, 800),
      worldConflict: compact(novel.worldConflict, 900),
      gameRules: compact(novel.gameRules, 700),
      activeWorld: activeWorld
        ? {
            name: compact(activeWorld.name, 160),
            worldRules: compact(activeWorld.worldRules, 900),
            mission: compact(activeWorld.mission, 600),
          }
        : undefined,
    },
    recentHistory: history
      .slice(-6)
      .map((message) => ({ role: message.role, content: compact(message.content, 700) }))
      .filter((message) => message.content),
  };
}

export type GenerateNovelEditorReviewInput = {
  apiSettings: ApiSettings;
  novel: Novel;
  history: ContextHistoryMessage[];
  instruction: string;
  draft: string;
  directPlan?: NovelDirectPlan;
  characterBrief?: NovelCharacterBrief;
  memory?: EditorMemory;
  signal?: AbortSignal;
};

export async function generateNovelEditorReview({
  apiSettings,
  novel,
  history,
  instruction,
  draft,
  directPlan,
  characterBrief,
  memory,
  signal,
}: GenerateNovelEditorReviewInput): Promise<{ review: NovelEditorReview; tokens: number; model?: string }> {
  if (!draft.trim()) {
    throw new Error('Editor 没有可供审查的正文。');
  }

  const result = await requestCompletionWithUsage({ responseFormat: 'json', validateJson: (value) => Boolean(normalizeNovelEditorReview(value)),
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
    },
    messages: [
      { role: 'system', content: EDITOR_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(buildEditorInput({ novel, history, instruction, draft, directPlan, characterBrief, memory })) },
    ],
    purpose: 'editor-agent',
    maxTokens: 800,
    temperature: 0.1,
    signal,
  });
  const review = normalizeNovelEditorReview(extractJsonObject(result.content));
  if (!review) {
    throw new Error('Editor 没有返回可执行的审查结果。');
  }
  return {
    review,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
    model: result.model,
  };
}

export function formatNovelEditorReview(review: NovelEditorReview): string {
  return [
    '【Editor 修订意见】',
    `严重程度：${review.severity}`,
    `问题：${review.issues.join('；') || '无'}`,
    `修订要求：${review.revisionInstructions || '保留原正文，不需要额外修订。'}`,
    'Narrator 只按修订要求修正当前正文，不要提及 Editor、审查或 Agent。',
  ].join('\n');
}

export function shouldRepairNovelDraft(review: NovelEditorReview): boolean {
  return !review.approved && review.severity === 'major' && Boolean(review.revisionInstructions.trim());
}
