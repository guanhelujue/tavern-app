import { tryParseAiJson } from '@/utils/ai-json';
import { requestCompletionWithUsage, type ContextHistoryMessage } from '@/services/llm';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import {
  buildNovelOutlineChapterGuidance,
  resolveNovelOutlineTurnRuntime,
} from '@/services/novel-outline-runtime';
import type { ApiSettings, Novel, NovelDirectPlan } from '@/types/tavern';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';

const DIRECT_SYSTEM_PROMPT = `你是互动小说里的 Direct 剧情导演。你不写小说正文，只为 Narrator 整理本回合可执行的剧情计划。

根据用户行动、当前章节大纲、隐藏剧情 summary、小说创作设定、世界规则和角色卡，输出严格 JSON：
{
  "objective": "本回合要推进的核心目标",
  "scene": "当前场景、时间与叙事视角",
  "participants": ["必须在场的人物"],
  "beats": ["按顺序发生的 2-5 个情节点"],
  "constraints": ["本回合必须遵守的世界、角色或信息边界"],
  "endingHook": "结尾应留下的行动选择或悬念"
}

要求：只输出 JSON，不要 Markdown、分析或正文；只使用输入中有依据的事实，不擅自改写已经确认的设定；计划要短、具体、能直接交给 Narrator 执行。`;

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

export function normalizeNovelDirectPlan(value: unknown): NovelDirectPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const plan: NovelDirectPlan = {
    objective: text(source.objective),
    scene: text(source.scene),
    participants: list(source.participants, 8),
    beats: list(source.beats, 6),
    constraints: list(source.constraints, 8),
    endingHook: text(source.endingHook),
  };
  return plan.objective || plan.scene || plan.participants.length || plan.beats.length || plan.constraints.length || plan.endingHook
    ? plan
    : null;
}

function compact(value: string | undefined, max: number) {
  return text(value).slice(0, max);
}

function buildDirectInput({
  novel,
  instruction,
  memory,
}: Pick<GenerateNovelDirectPlanInput, 'novel' | 'instruction' | 'memory'>) {
  const activeWorld = novel.quickTravel?.worlds.find(
    (world) => world.id === novel.quickTravel?.activeWorldId,
  ) ?? novel.quickTravel?.worlds[0];
  const cast = (novel.cast ?? [])
    .filter((character) => character.name.trim())
    .slice(0, 8)
    .map((character) => {
      const dossier = character.dossierV2
        ? normalizeCharacterDossierV2(character.dossierV2, character)
        : null;
      const anchor = character.aiSummary && dossier
        ? formatCharacterAiSummaryForPrompt(
            normalizeCharacterAiSummary(character.aiSummary, character, dossier),
          )
        : '';
      return anchor
        ? {
            name: compact(character.name, 80),
            isProtagonist: character.isProtagonist === true,
            anchor: compact(anchor, 900),
          }
        : {
            name: compact(character.name, 80),
            isProtagonist: character.isProtagonist === true,
            role: compact(character.profession || character.affiliation, 80),
            personality: compact(character.personality, 180),
            motive: compact(character.motive, 180),
            background: compact(character.background, 220),
            speechStyle: compact(character.speechStyle, 120),
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
      shortIntro: compact(novel.shortIntro, 700),
      detailedIntro: compact(novel.detailedIntro, 1400),
      foundationPrompt: compact(novel.foundationPrompt, 2600),
      worldName: compact(novel.worldName, 160),
      worldEra: compact(novel.worldEra, 1200),
      worldConflict: compact(novel.worldConflict, 1000),
      worldTone: compact(novel.worldTone, 500),
      mainPlot: compact(novel.mainPlot, 1600),
      initialStoryState: compact(novel.initialStoryState, 1200),
      gameRules: compact(novel.gameRules, 900),
      profile: novel.creationBlueprint?.profile,
      projectBrief: novel.projectBrief
        ? {
            premise: compact(novel.projectBrief.premise, 900),
            theme: compact(novel.projectBrief.theme, 500),
            protagonistArc: compact(novel.projectBrief.protagonistArc, 900),
            ending: compact(novel.projectBrief.ending, 900),
            firstChapterGoal: compact(novel.projectBrief.firstChapterGoal, 700),
          }
        : undefined,
      activeWorld: activeWorld
        ? {
            name: compact(activeWorld.name, 160),
            worldEra: compact(activeWorld.worldEra, 1000),
            worldRules: compact(activeWorld.worldRules, 1000),
            mission: compact(activeWorld.mission, 700),
            entryScene: compact(activeWorld.entryScene, 700),
          }
        : undefined,
      cast,
    },
  };
}

export type GenerateNovelDirectPlanInput = {
  apiSettings: ApiSettings;
  novel: Novel;
  history: ContextHistoryMessage[];
  instruction: string;
  memory?: {
    summary?: string;
    longTermMemory?: string;
    midTermMemories?: string[];
    shortTermMemories?: string[];
    currentChapter?: string;
  };
  signal?: AbortSignal;
};

export async function generateNovelDirectPlan({
  apiSettings,
  novel,
  history,
  instruction,
  memory,
  signal,
}: GenerateNovelDirectPlanInput): Promise<{ plan: NovelDirectPlan; tokens: number; model?: string }> {
  const result = await requestCompletionWithUsage({ responseFormat: 'json', validateJson: (value) => Boolean(normalizeNovelDirectPlan(value)),
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
    },
    messages: [
      { role: 'system', content: DIRECT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(buildDirectInput({ novel, instruction, memory })) },
    ],
    purpose: 'direct-plan',
    maxTokens: 900,
    temperature: 0.25,
    signal,
  });
  const plan = normalizeNovelDirectPlan(extractJsonObject(result.content));
  if (!plan) {
    throw new Error('Direct 没有返回可执行的剧情计划。');
  }
  return {
    plan,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
    model: result.model,
  };
}
