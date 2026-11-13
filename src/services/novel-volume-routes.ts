import { tryParseAiJson } from '@/utils/ai-json';
import { requestCompletionWithUsage, type ChatCompletionResult } from '@/services/llm';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import type { ApiSettings, Novel, NovelOutline, NovelVolumePlan, OpenAIChatMessage } from '@/types/tavern';

export type NovelVolumeRoute = {
  title: string;
  summary: string;
  turningPoint: string;
  risk: string;
  endingState: string;
};

type Completion = (input: Parameters<typeof requestCompletionWithUsage>[0]) => Promise<ChatCompletionResult>;

export type VolumeRouteResult = { routes: NovelVolumeRoute[]; tokens?: number };

function parseJson(value: string): unknown {
  return tryParseAiJson(value) ?? null;
}

function field(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export async function proposeNovelVolumeRoutes({
  novel,
  volume,
  apiSettings,
  requestCompletion = requestCompletionWithUsage,
}: {
  novel: Novel;
  volume: NovelVolumePlan;
  apiSettings: ApiSettings;
  requestCompletion?: Completion;
}): Promise<VolumeRouteResult> {
  const outline = novel.outline;
  if (!outline || !outline.volumes.some((item) => item.id === volume.id)) throw new Error('当前卷不在作品大纲中。');
  const context = buildNovelCharacterContext(novel, `为第${outline.volumes.findIndex((item) => item.id === volume.id) + 1}卷推演路线`).slice(0, 12000);
  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: ['你是中文长篇小说的卷级策划编辑，只输出 JSON。', '只讨论当前卷的路线，不改写正文、章节数组、其他卷或全局大纲。', '返回格式：{"routes":[{"title":"路线名","summary":"路线梗概","turningPoint":"关键转折","risk":"主要风险","endingState":"卷末状态"}]}，给出2到3条互相有差异的路线。', `【作品上下文】\n${context}`, `【全书主线】\n${outline.summary}`, `【当前卷】\n${JSON.stringify(volume)}`].join('\n\n') },
    { role: 'user', content: '请基于当前卷现状给出可供作者选择的推进路线。' },
  ];
  const result = await requestCompletion({ responseFormat: 'json', validateJson: (value) => Boolean(value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).routes) && ((value as Record<string, unknown>).routes as unknown[]).some((item) => item && typeof item === 'object' && ['title', 'summary', 'turningPoint', 'risk', 'endingState'].every((key) => field((item as Record<string, unknown>)[key])))), apiSettings: { ...apiSettings, streamingEnabled: false, thinkingDisabled: true }, messages, purpose: 'novel-volume-route-forecast', maxTokens: 1800, temperature: 0.55 });
  if (!result.content?.trim()) throw new Error('模型没有返回路线推演内容。');
  const payload = parseJson(result.content ?? '');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('模型返回的路线推演不是有效 JSON。');
  const raw = (payload as Record<string, unknown>).routes;
  if (!Array.isArray(raw)) throw new Error('模型返回的路线列表不可用。');
  const routes = raw.map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { title: field(record.title), summary: field(record.summary), turningPoint: field(record.turningPoint), risk: field(record.risk), endingState: field(record.endingState) };
  }).filter((item) => Object.values(item).every(Boolean)).slice(0, 3);
  if (!routes.length) throw new Error('模型返回的路线字段不完整。');
  const tokens = (result.promptTokens ?? 0) + (result.completionTokens ?? 0);
  return { routes, tokens: tokens > 0 ? tokens : undefined };
}

export function applyVolumeRouteToOutline(outline: NovelOutline, volumeId: string, route: NovelVolumeRoute): NovelOutline {
  const target = outline.volumes.find((item) => item.id === volumeId);
  if (!target) throw new Error('当前卷不在作品大纲中。');
  return { ...outline, volumes: outline.volumes.map((item) => item.id === volumeId ? { ...item, summary: `${route.summary}\n\n关键转折：${route.turningPoint}`, handoff: { ...(item.handoff ?? {}), outgoing: route.endingState } } : item) };
}
