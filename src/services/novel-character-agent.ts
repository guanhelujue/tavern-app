import { requestCompletionWithUsage, type ContextHistoryMessage } from '@/services/llm';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import {
  buildNovelOutlineChapterGuidance,
  resolveNovelOutlineTurnRuntime,
} from '@/services/novel-outline-runtime';
import type {
  ApiSettings,
  Novel,
  NovelCharacterBrief,
} from '@/types/tavern';

const CHARACTER_SYSTEM_PROMPT = `你是互动小说里的 Character 角色导演。你不写小说正文，只为 Narrator 整理本回合角色执行简报。

根据用户行动、当前章节大纲、隐藏剧情 summary 和角色卡，输出严格 JSON：
{
  "activeCharacterIds": ["本回合实际需要关注的角色ID"],
  "characters": [
    {
      "characterId": "角色ID",
      "name": "角色名",
      "objective": "角色此刻想达成什么",
      "emotionalState": "当前情绪和内在压力",
      "behavior": "本回合应如何行动、反应或推进关系",
      "voice": "本回合说话的语气、措辞或禁忌",
      "relationshipChanges": ["本回合可能发生的关系变化"]
    }
  ],
  "continuityWarnings": ["必须避免的角色出戏或关系矛盾"]
}

要求：只输出 JSON，不要 Markdown、分析或正文；只选择输入中已有的角色；不要替角色决定用户未授权的行动；只负责角色动机、行为、语气和关系连续性，不负责剧情编排；简报要短、具体，能直接交给 Narrator 执行。`;

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

export function normalizeNovelCharacterBrief(value: unknown): NovelCharacterBrief | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const characters = Array.isArray(source.characters)
    ? source.characters
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .slice(0, 8)
        .map((item) => ({
          characterId: text(item.characterId) || undefined,
          name: text(item.name),
          objective: text(item.objective),
          emotionalState: text(item.emotionalState),
          behavior: text(item.behavior),
          voice: text(item.voice),
          relationshipChanges: list(item.relationshipChanges, 6),
        }))
        .filter((item) => item.name || item.characterId || item.objective || item.emotionalState || item.behavior || item.voice || item.relationshipChanges.length > 0)
    : [];
  const brief: NovelCharacterBrief = {
    activeCharacterIds: list(source.activeCharacterIds, 8),
    characters,
    continuityWarnings: list(source.continuityWarnings, 8),
  };

  return brief.activeCharacterIds.length || brief.characters.length || brief.continuityWarnings.length
    ? brief
    : null;
}

function compact(value: string | undefined, max: number) {
  return text(value).slice(0, max);
}

type CharacterMemory = {
  summary?: string;
  longTermMemory?: string;
  midTermMemories?: string[];
  shortTermMemories?: string[];
  currentChapter?: string;
};

function buildCharacterInput({
  novel,
  instruction,
  memory,
}: Pick<GenerateNovelCharacterBriefInput, 'novel' | 'instruction' | 'memory'>) {
  const cast = (novel.cast ?? [])
    .filter((character) => character.name.trim())
    .slice(0, 12)
    .map((character) => {
      const dossier = character.dossierV2
        ? normalizeCharacterDossierV2(character.dossierV2, character)
        : null;
      const anchor = character.aiSummary && dossier
        ? formatCharacterAiSummaryForPrompt(
            normalizeCharacterAiSummary(character.aiSummary, character, dossier),
          )
        : '';
      return {
        id: compact(character.id, 100),
        name: compact(character.name, 80),
        isProtagonist: character.isProtagonist === true,
        ...(anchor
          ? { anchor: compact(anchor, 1200) }
          : {
              role: compact(character.profession || character.affiliation, 100),
              personality: compact(character.personality, 220),
              motive: compact(character.motive, 220),
              background: compact(character.background, 260),
              speechStyle: compact(character.speechStyle, 160),
            }),
        relations: (character.relations ?? []).slice(0, 6).map((relation) => ({
          targetId: compact(relation.targetCastId, 100),
          targetName: compact(relation.targetName, 100),
          label: compact(relation.label, 100),
          note: compact(relation.note, 220),
        })),
      };
    });
  return {
    instruction: compact(instruction, 1200),
    characterContext: buildNovelCharacterContext(novel, instruction, memory?.summary),
    outlineChapter:
      buildNovelOutlineChapterGuidance(resolveNovelOutlineTurnRuntime(novel, instruction)) || undefined,
    summary: compact(memory?.summary, 2400),
    novel: {
      name: compact(novel.name, 120),
      worldName: compact(novel.worldName, 160),
      worldEra: compact(novel.worldEra, 800),
      gameRules: compact(novel.gameRules, 700),
      cast,
    },
  };
}

export type GenerateNovelCharacterBriefInput = {
  apiSettings: ApiSettings;
  novel: Novel;
  history: ContextHistoryMessage[];
  instruction: string;
  memory?: CharacterMemory;
  signal?: AbortSignal;
};

export async function generateNovelCharacterBrief({
  apiSettings,
  novel,
  history,
  instruction,
  memory,
  signal,
}: GenerateNovelCharacterBriefInput): Promise<{ brief: NovelCharacterBrief; tokens: number; model?: string }> {
  if (!(novel.cast ?? []).some((character) => character.name.trim())) {
    throw new Error('当前小说没有可供 Character 使用的角色卡。');
  }

  const result = await requestCompletionWithUsage({
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
    },
    messages: [
      { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(buildCharacterInput({ novel, instruction, memory })) },
    ],
    purpose: 'character-agent',
    maxTokens: 1100,
    temperature: 0.25,
    signal,
  });
  const brief = normalizeNovelCharacterBrief(extractJsonObject(result.content));
  if (!brief) {
    throw new Error('Character 没有返回可执行的角色简报。');
  }
  return {
    brief,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
    model: result.model,
  };
}
