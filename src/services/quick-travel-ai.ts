import { requestCompletionWithUsage } from '@/services/llm';
import type { ApiSettings } from '@/types/tavern';
import type { OriginalPlot } from '@/types/quick-travel';

type QuickTravelAiUsage = {
  promptTokens: number;
  completionTokens: number;
  modelId?: string;
};

const JSON_RETRY_HINT =
  '（上次输出未通过 JSON 校验。请重新输出：只输出合法的纯 JSON 对象，不要包含任何解释、注释、代码块标记或多余文字。）';

function looksLikeTruncatedJson(text: string) {
  const open = (text.match(/\{/g) ?? []).length;
  const close = (text.match(/\}/g) ?? []).length;
  return open > close || (text.includes('{') && !text.trimEnd().endsWith('}'));
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  if (looksLikeTruncatedJson(trimmed) || /unexpected end of/i.test(message)) {
    throw new Error('模型返回的 JSON 不完整（输出被截断）。请重试一次。');
  }
  throw new Error('模型未返回可解析的 JSON。');
}

function resolveMaxTokens(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function toUsage(result: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}): QuickTravelAiUsage {
  return {
    promptTokens: result.promptTokens ?? 0,
    completionTokens: result.completionTokens ?? 0,
    modelId: result.model,
  };
}

async function requestQuickTravelJson({
  apiSettings,
  maxTokens,
  temperature,
  purpose,
  systemPrompt,
  userContent,
}: {
  apiSettings: ApiSettings;
  maxTokens: number;
  temperature: number;
  purpose: string;
  systemPrompt: string;
  userContent: string;
}): Promise<{ raw: string; usage: QuickTravelAiUsage }> {
  const settings = {
    ...apiSettings,
    streamingEnabled: false,
    thinkingDisabled: true,
    maxTokens,
    temperature,
  } satisfies ApiSettings;
  const run = (content: string) =>
    requestCompletionWithUsage({
      apiSettings: settings,
      maxTokens,
      temperature,
      purpose,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });

  const first = await run(userContent);
  try {
    extractJsonObject(first.content);
    return { raw: first.content, usage: toUsage(first) };
  } catch {
    const retry = await run(`${userContent}\n\n${JSON_RETRY_HINT}`);
    extractJsonObject(retry.content);
    return {
      raw: retry.content,
      usage: {
        promptTokens: (first.promptTokens ?? 0) + (retry.promptTokens ?? 0),
        completionTokens: (first.completionTokens ?? 0) + (retry.completionTokens ?? 0),
        modelId: retry.model ?? first.model,
      },
    };
  }
}

export async function generateQuickTravelSystem({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  current,
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro: string;
  current: { systemName: string; globalRules: string };
  onUsage?: (usage: QuickTravelAiUsage) => void;
}) {
  const { raw, usage } = await requestQuickTravelJson({
    apiSettings,
    maxTokens: resolveMaxTokens(novelCreateMaxTokens, 3500),
    temperature: 0.75,
    purpose: 'create-quick-travel-system',
    systemPrompt: '你是快穿小说系统设计师。只输出合法 JSON，不要解释。',
    userContent: `为小说「${novelName}」设计独立的快穿系统与规则。作品介绍：${intro || '未填写'}\n当前内容：${JSON.stringify(current)}\n输出：{"systemName":"系统名称","globalRules":"系统运行、任务、奖励、惩罚、记忆和世界切换规则"}`,
  });
  const value = extractJsonObject(raw) as Record<string, unknown>;
  const result = {
    systemName: typeof value.systemName === 'string' ? value.systemName.trim() : current.systemName,
    globalRules: typeof value.globalRules === 'string' ? value.globalRules.trim() : current.globalRules,
  };
  onUsage?.(usage);
  return result;
}

export async function generateQuickTravelWorldPlot({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  systemRules,
  protagonistIdentity,
  current,
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro: string;
  systemRules: string;
  protagonistIdentity?: string;
  current: {
    name: string;
    generationBrief: string;
    worldEra: string;
    worldRules: string;
    mission: string;
    originalPlot: OriginalPlot;
  };
  onUsage?: (usage: QuickTravelAiUsage) => void;
}) {
  const { raw, usage } = await requestQuickTravelJson({
    apiSettings,
    maxTokens: resolveMaxTokens(novelCreateMaxTokens, 6500),
    temperature: 0.82,
    purpose: 'create-quick-travel-world',
    systemPrompt: '你是快穿小说小世界剧情设计师。只输出合法 JSON，不要解释。',
    userContent: `根据用户的小世界构想，补全并结构化一个小世界的完整原定剧情，不要随机另起炉灶。\n小说：${novelName}\n作品介绍：${intro || '未填写'}\n【快穿系统规则（仅作为跨世界约束）】\n${systemRules || '未填写'}\n【跨世界主角核心】\n${protagonistIdentity?.trim() || '未填写'}\n【用户的小世界构想（最高优先级）】\n${current.generationBrief || '用户未填写构想，此时才允许根据作品介绍补足基础设定'}\n【当前小世界草稿（只处理这个世界）】\n${JSON.stringify(current)}\n要求：只生成当前小世界，不读取或猜测其他小世界；保留用户指定的人物、关系、冲突、题材和结局倾向；只补足缺失部分，发现冲突时优先服从用户构想。输出 JSON：{"name":"世界名称","worldEra":"时代与世界观","worldRules":"本世界规则","mission":"主角任务","entryScene":"进入世界时的开场","originalPlot":{"premise":"原定主线","knownToProtagonist":"系统告知主角的剧情","beats":[{"id":"beat-1","order":1,"title":"节点标题","originalEvent":"原定事件","involvedCharacters":[],"status":"pending"}],"originalEnding":"原定结局"}。至少生成 5 个 beats。`,
  });
  const value = extractJsonObject(raw) as Record<string, unknown>;
  const plot = value.originalPlot && typeof value.originalPlot === 'object'
    ? value.originalPlot as Record<string, unknown>
    : {};
  const result = {
    name: typeof value.name === 'string' ? value.name.trim() : current.name,
    worldEra: typeof value.worldEra === 'string' ? value.worldEra.trim() : current.worldEra,
    worldRules: typeof value.worldRules === 'string' ? value.worldRules.trim() : current.worldRules,
    mission: typeof value.mission === 'string' ? value.mission.trim() : current.mission,
    entryScene: typeof value.entryScene === 'string' ? value.entryScene.trim() : '',
    originalPlot: {
      premise: typeof plot.premise === 'string' ? plot.premise.trim() : current.originalPlot.premise,
      knownToProtagonist: typeof plot.knownToProtagonist === 'string' ? plot.knownToProtagonist.trim() : current.originalPlot.knownToProtagonist,
      beats: Array.isArray(plot.beats) ? plot.beats : current.originalPlot.beats,
      originalEnding: typeof plot.originalEnding === 'string' ? plot.originalEnding.trim() : current.originalPlot.originalEnding,
    },
  };
  onUsage?.(usage);
  return result;
}
