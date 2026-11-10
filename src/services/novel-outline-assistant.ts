import { requestCompletionWithUsage, type ChatCompletionResult } from '@/services/llm';
import { cloneNovelOutline } from '@/utils/novel-outline-proposals';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import type { ApiSettings, Novel, NovelOutline, NovelVolumePlan, OpenAIChatMessage } from '@/types/tavern';

type OutlineAssistantCompletion = (input: {
  apiSettings: ApiSettings;
  messages: OpenAIChatMessage[];
  purpose?: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<ChatCompletionResult>;

export type OutlineTextRevisionResult = {
  outline: NovelOutline;
  tokens?: number;
};

export type OutlineTextRevisionRequest = {
  novel: Novel;
  outline: NovelOutline;
  volume?: NovelVolumePlan;
  instruction: string;
  apiSettings: ApiSettings;
  /** Test seam; production callers use the configured LLM client. */
  requestCompletion?: OutlineAssistantCompletion;
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter((candidate): candidate is string => Boolean(candidate));
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue with the next common model response shape.
    }
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function novelContext(novel: Novel, instruction: string): string {
  // This helper resolves the active quick-travel world and rebuilds the
  // foundation from the current blueprint/cast instead of trusting a stale
  // legacy foundationPrompt snapshot.
  return buildNovelCharacterContext(novel, instruction).slice(0, 12000);
}

function preserveTokens(result: ChatCompletionResult): number | undefined {
  const total = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
  return total > 0 ? total : undefined;
}

/**
 * Produce a reviewable outline candidate without mutating the store or widening
 * the requested edit scope. A volume edit can change only its prose metadata;
 * a whole-book edit can change only the top-level summary.
 */
export async function requestOutlineTextRevision({
  novel,
  outline,
  volume,
  instruction,
  apiSettings,
  requestCompletion = requestCompletionWithUsage,
}: OutlineTextRevisionRequest): Promise<OutlineTextRevisionResult> {
  const authorInstruction = instruction.trim();
  if (!authorInstruction) throw new Error('请先写下希望 AI 修改的方向。');
  if (volume && !outline.volumes.some((item) => item.id === volume.id)) {
    throw new Error('当前卷已不在这份大纲中，请刷新后重试。');
  }

  const scope = volume ? `当前范围：第 ${outline.volumes.findIndex((item) => item.id === volume.id) + 1} 卷《${volume.title}》` : '当前范围：全书主线';
  const schema = volume
    ? '{"volume":{"title":"卷名","summary":"本卷梗概","tone":"节奏基调（可空）","foreshadowing":"伏笔边界（可空）","outgoing":"卷末状态（可空）"}}'
    : '{"summary":"新的全书主线"}';
  const messages: OpenAIChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是中文小说策划编辑。只输出 JSON，不要 Markdown、解释或额外字段。',
        volume
          ? '只修改当前卷的 title、summary、tone、foreshadowing、handoff.outgoing；必须保留章节数组、章节编号、既有输入交接、计划章数和每章字数。'
          : '只修改全书 summary；必须逐字保留所有分卷、章节、编号、篇幅和交接信息。',
        `输出格式：${schema}`,
        `【当前小说上下文】\n${novelContext(novel, authorInstruction)}`,
        volume ? `【只读·全书主线摘要】\n${outline.summary}` : '',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        scope,
        `作者修改要求：${authorInstruction}`,
        `当前大纲 JSON：${JSON.stringify(volume ? volume : { summary: outline.summary })}`,
      ].join('\n\n'),
    },
  ];
  const result = await requestCompletion({
    apiSettings: { ...apiSettings, streamingEnabled: false, thinkingDisabled: true },
    messages,
    purpose: 'outline-text-revision-candidate',
    maxTokens: 1800,
    temperature: 0.35,
  });
  if (!result.content.trim()) throw new Error('模型没有返回卷纲修改内容，原大纲已保留。');
  const payload = extractJsonObject(result.content);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('模型返回的卷纲不是有效 JSON，原大纲已保留。');

  const next = cloneNovelOutline(outline);
  const record = payload as Record<string, unknown>;
  if (!volume) {
    const summary = text(record.summary);
    if (!summary) throw new Error('模型返回的全书主线为空，原大纲已保留。');
    next.summary = summary;
    return { outline: next, tokens: preserveTokens(result) };
  }

  const rawVolume = record.volume && typeof record.volume === 'object' && !Array.isArray(record.volume)
    ? record.volume as Record<string, unknown>
    : record;
  const target = next.volumes.find((item) => item.id === volume.id);
  if (!target) throw new Error('当前卷已不在这份大纲中，请刷新后重试。');
  const title = text(rawVolume.title);
  const summary = text(rawVolume.summary);
  if (!title || !summary) throw new Error('模型返回的卷名或卷纲为空，原大纲已保留。');
  const optional = (key: string): string | undefined => typeof rawVolume[key] === 'string' ? rawVolume[key].trim() : undefined;
  target.title = title;
  target.summary = summary;
  if (optional('tone') !== undefined) target.tone = optional('tone');
  if (optional('foreshadowing') !== undefined) target.foreshadowing = optional('foreshadowing');
  const outgoing = optional('outgoing');
  if (outgoing !== undefined) target.handoff = { ...(target.handoff ?? {}), outgoing };
  return { outline: next, tokens: preserveTokens(result) };
}
