import { isTruncationFinishReason, requestCompletionWithUsage } from './llm';
import type { CharacterDossierV2 } from '../types/character-dossier-v2';
import type { ApiSettings, ContentStyleSettings, NovelCastCharacter } from '../types/tavern';
import { buildWritingPromptExtensionBlocks } from '../utils/writing-prompt-extensions';
import { asRecord, asString } from '../utils/helpers';

export const CHARACTER_BIOGRAPHY_SYSTEM_PROMPT = `你是一名擅长人物塑造的中文小说作者。请根据角色资料与作者本次提出的要求，创作一篇独立的人物小传。

规则：
1. 作者要求决定题材、时间、视角、氛围、关系与尺度，不预设小传类型，也不要擅自改写成角色介绍。
2. 角色资料只用于保持姓名、身份、外貌、身体事实、性格和说话方式一致。
3. 用具体场景、动作、感官、心理与对话写人，避免档案式罗列、性格总结和空泛抒情。
4. 允许描写正文没有呈现、正文不准备展开或完全独立于主线的内容；不要续写小说主线，不要声称这些内容已经成为正文事实。
5. 不复述作者要求，不添加创作说明、免责声明或结尾点评。
6. 标题应简短、有画面感，正文必须完整收束；篇幅与作者要求相称，未指定时写成一篇有起承转合的标准短篇。

只输出合法 JSON：
{"title":"小传标题","content":"小传正文"}`;

function extractBiographyPayload(content: string) {
  if (!content.trim()) throw new Error('模型没有返回小传正文，请重新生成。');
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidates = [cleaned, start >= 0 && end > start ? cleaned.slice(start, end + 1) : ''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const raw = asRecord(JSON.parse(candidate));
      const title = asString(raw.title).trim();
      const body = asString(raw.content).trim();
      if (body) return { title: title || '未命名小传', content: body, usedRawResponse: false };
    } catch {
      // Try the bounded JSON candidate next.
    }
  }
  // Keep the complete response (including fences or multiple pieces) for manual editing.
  return { title: '未命名小传', content, usedRawResponse: true };
}

function characterReference(
  character: NovelCastCharacter,
  dossier: CharacterDossierV2,
  includePrivate: boolean,
) {
  return {
    name: character.name,
    gender: character.gender,
    age: character.age,
    profession: character.profession,
    birthplace: character.birthplace,
    affiliation: character.affiliation,
    appearance: character.appearance,
    personality: character.personality,
    speechStyle: character.speechStyle,
    background: character.background,
    motive: character.motive,
    strengths: character.strengths,
    weaknesses: character.weaknesses,
    publicDossier: dossier.public,
    ...(includePrivate ? { privateDossier: dossier.private } : {}),
  };
}

export async function generateCharacterBiography({
  apiSettings,
  character,
  dossier,
  request,
  nsfwEnabled,
  writingExtensions,
  maxTokens,
}: {
  apiSettings: ApiSettings;
  character: NovelCastCharacter;
  dossier: CharacterDossierV2;
  request: string;
  nsfwEnabled: boolean;
  writingExtensions?: Partial<ContentStyleSettings>;
  maxTokens?: number;
}) {
  const authorRequest = request.trim();
  if (!authorRequest) throw new Error('请先写下你想看的内容。');
  const outputBudget = typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
    ? Math.max(1600, Math.round(maxTokens))
    : 8000;

  const result = await requestCompletionWithUsage({
    apiSettings: { ...apiSettings, streamingEnabled: false },
    purpose: 'create-character-biography',
    temperature: Math.max(0.72, Math.min(apiSettings.temperature, 1.02)),
    maxTokens: outputBudget,
    messages: [
      { role: 'system', content: CHARACTER_BIOGRAPHY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `【角色资料】\n${JSON.stringify(characterReference(character, dossier, nsfwEnabled), null, 2)}`,
          ...buildWritingPromptExtensionBlocks(writingExtensions),
          `【作者这次想看】\n${authorRequest}`,
        ].filter(Boolean).join('\n\n'),
      },
    ],
  });

  return {
    ...extractBiographyPayload(result.content),
    truncated: isTruncationFinishReason(result.finishReason),
    promptTokens: result.promptTokens ?? 0,
    completionTokens: result.completionTokens ?? 0,
  };
}
