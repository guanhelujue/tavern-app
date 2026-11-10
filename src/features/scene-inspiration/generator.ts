import { requestPlainCompletion } from '../../services/llm';
import { buildWritingPromptExtensionBlocks } from '../../utils/writing-prompt-extensions';
import type { ApiSettings, ContentStyleSettings, Novel, OpenAIChatMessage } from '../../types/tavern';
import type { SceneInspirationChatMessage } from './domain';

export type InspirationContinuity = 'continuous' | 'single';

export const INSPIRATION_HISTORY_LIMIT = 12;
export const INSPIRATION_HISTORY_CHAR_BUDGET = 8_000;

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function isChapterContinuationIntent(prompt: string): boolean {
  const normalized = prompt.trim().replace(/[。！!？?，,\s]+$/g, '');
  return /^(下一章|继续写(?:下一章|正文)?|接着写(?:下一章|正文)?|续写下一章|写下一章|进入下一章)$/.test(normalized);
}

export function trimInspirationHistory(
  messages: SceneInspirationChatMessage[],
  currentPrompt: string,
  limit = INSPIRATION_HISTORY_LIMIT,
  budget = INSPIRATION_HISTORY_CHAR_BUDGET,
): SceneInspirationChatMessage[] {
  const current = currentPrompt.trim();
  const candidates = messages.filter((message) => message.content.trim() !== current);
  const selected: SceneInspirationChatMessage[] = [];
  let used = 0;
  for (let index = candidates.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const message = candidates[index];
    const remaining = budget - used;
    if (remaining <= 0) break;
    const content = message.content.trim().slice(-remaining);
    if (!content) continue;
    selected.unshift({ ...message, content });
    used += content.length;
  }
  return selected;
}

function buildPublicNovelContext(novel: Novel): string {
  const cast = (novel.cast ?? []).slice(0, 12).map((character) => [
    character.name,
    character.profession,
    character.age,
    character.personality,
    character.motive,
  ].filter(Boolean).join('｜')).filter(Boolean);
  const outline = novel.outline?.volumes?.flatMap((volume) => volume.chapters ?? [])
    .slice(0, 40).map((chapter) => `第${chapter.index}章《${chapter.title}》：${chapter.goal}`).join('\n');
  const recent = (novel.chapters ?? []).filter((chapter) => chapter.status === 'final').slice(-6)
    .map((chapter) => `第${chapter.index}章《${chapter.title}》：${chapter.summary}`).join('\n');
  return [
    readText(novel.worldName) ? `【世界】${readText(novel.worldName)}` : '',
    readText(novel.worldEra) ? `【世界设定】\n${readText(novel.worldEra).slice(0, 3500)}` : '',
    readText(novel.gameRules) ? `【作者约束】\n${readText(novel.gameRules).slice(0, 2500)}` : '',
    cast.length ? `【公开角色卡】\n${cast.join('\n').slice(0, 3500)}` : '',
    outline ? `【当前大纲】\n${outline.slice(0, 4500)}` : '',
    recent ? `【最近定稿摘要】\n${recent.slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildSceneInspirationSystemPrompt(
  novel: Novel,
  writingExtensions?: Partial<ContentStyleSettings>,
): string {
  return [
    '你是一个小说灵感对话助手。',
    '下面是作品世界观，只作为回答时的背景。',
    `【作品】${readText(novel.name) || '未命名小说'}`,
    buildPublicNovelContext(novel),
    ...buildWritingPromptExtensionBlocks(writingExtensions),
    '用户的提示词是主要要求，直接围绕它回答。不强制使用大纲、卡片或 JSON；除非用户要求，否则使用自然中文。',
  ].filter(Boolean).join('\n\n');
}

/** One prompt in, one reply out. Continuous mode keeps a bounded local discussion context. */
export async function requestSceneInspirationReply({
  apiSettings,
  novel,
  writingExtensions,
  prompt,
  history = [],
  continuity = 'continuous',
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  writingExtensions?: Partial<ContentStyleSettings>;
  prompt: string;
  history?: SceneInspirationChatMessage[];
  continuity?: InspirationContinuity;
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
      ...(continuity === 'continuous' ? trimInspirationHistory(history, content).map<OpenAIChatMessage>((message) => ({ role: message.role, content: message.content })) : []),
      { role: 'user', content },
    ],
  });

  const normalized = reply.trim();
  if (!normalized) throw new Error('模型没有返回内容，请重试。');
  return normalized;
}
