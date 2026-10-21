import { requestPlainCompletion } from '../../services/llm';
import { buildWritingPromptExtensionBlocks } from '../../utils/writing-prompt-extensions';
import type { ApiSettings, ContentStyleSettings, Novel } from '../../types/tavern';

export function buildSceneInspirationSystemPrompt(
  novel: Novel,
  writingExtensions?: Partial<ContentStyleSettings>,
): string {
  return [
    '你是一个小说灵感对话助手。',
    '下面是作品世界观，只作为回答时的背景。',
    `【作品】${novel.name.trim() || '未命名小说'}`,
    novel.worldName.trim() ? `【世界】${novel.worldName.trim()}` : '',
    novel.worldEra.trim() ? `【世界观】\n${novel.worldEra.trim()}` : '',
    ...buildWritingPromptExtensionBlocks(writingExtensions),
    '用户的提示词是主要要求，直接围绕它回答。不强制使用大纲、卡片或 JSON；除非用户要求，否则使用自然中文。',
  ].filter(Boolean).join('\n\n');
}

/** One prompt in, one reply out. Previous inspiration turns are intentionally not sent. */
export async function requestSceneInspirationReply({
  apiSettings,
  novel,
  writingExtensions,
  prompt,
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  writingExtensions?: Partial<ContentStyleSettings>;
  prompt: string;
}): Promise<string> {
  const content = prompt.trim();
  if (!content) throw new Error('请先输入你想问的灵感问题。');

  const reply = await requestPlainCompletion({
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      maxTokens: Math.max(1200, Math.min(apiSettings.maxTokens || 3200, 6000)),
    },
    purpose: 'create-inspiration',
    messages: [
      { role: 'system', content: buildSceneInspirationSystemPrompt(novel, writingExtensions) },
      { role: 'user', content },
    ],
  });

  const normalized = reply.trim();
  if (!normalized) throw new Error('模型没有返回内容，请重试。');
  return normalized;
}
