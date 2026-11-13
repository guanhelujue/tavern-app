import { tryParseAiJson } from '@/utils/ai-json';
import { requestPlainCompletion } from '@/services/llm';
import type { ApiSettings, Novel } from '@/types/tavern';
import { stripStatusBarFromAssistantContent } from '@/utils/status-bar-html';

function extractJsonObject(text: string): unknown {
  return tryParseAiJson(text) ?? null;
}

function normalizeRoutes(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { routes?: unknown }).routes)
      ? (raw as { routes: unknown[] }).routes
      : [];

  return list
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Generate 4 short player-facing next-route suggestions from the latest turn.
 */
export async function generateSuggestedRoutes({
  apiSettings,
  novel,
  userContent,
  assistantContent,
  longTermMemory,
  midTermMemories,
  shortTermMemories,
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  userContent: string;
  assistantContent: string;
  longTermMemory: string;
  midTermMemories?: string[];
  shortTermMemories: string[];
}): Promise<string[]> {
  const narrative = stripStatusBarFromAssistantContent(assistantContent).slice(-1200);
  const midMemory = (midTermMemories ?? []).slice(-3).join('\n');
  const shortMemory = shortTermMemories.slice(-5).join('\n');

  const raw = await requestPlainCompletion({ responseFormat: 'json', validateJson: (value) => normalizeRoutes(value).length > 0,
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
      maxTokens: Math.min(apiSettings.maxTokens || 512, 512),
      temperature: 0.7,
    },
    purpose: 'utility-routes',
    messages: [
      {
        role: 'system',
        content: [
          '你是互动小说的路线参谋。根据当前剧情，给出玩家下一步可采取的 4 条建议路线。',
          '要求：',
          '1. 正好 4 条，互不重复，覆盖谨慎 / 进取 / 社交 / 探索等不同倾向时更好。',
          '2. 每条 12–28 字，用第二人称行动句（如「先去账房核对货单」）。',
          '3. 贴合已发生剧情，不要剧透未发生的大结局。',
          '4. 只输出 JSON：{"routes":["...","...","...","..."]}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `【小说】${novel.name}`,
          longTermMemory.trim() ? `【长期总结】${longTermMemory.trim().slice(0, 400)}` : '',
          midMemory ? `【过往记忆】\n${midMemory}` : '',
          shortMemory ? `【近期记忆】\n${shortMemory}` : '',
          userContent.trim() ? `【玩家本轮】${userContent.trim().slice(0, 400)}` : '',
          narrative ? `【AI 本轮正文】\n${narrative}` : '',
          '请给出 4 条建议路线。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const routes = normalizeRoutes(extractJsonObject(raw));

  if (routes.length < 2) {
    throw new Error('建议路线数量不足。');
  }

  while (routes.length < 4) {
    routes.push(`继续观察当前局面（备选 ${routes.length + 1}）`);
  }

  return routes.slice(0, 4);
}
