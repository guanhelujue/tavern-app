import { DEFAULT_NOVEL_SYSTEM_PROMPT } from '@/constants/novel-memory';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import {
  buildNovelOutlineChapterGuidance,
  resolveNovelOutlineRuntime,
} from '@/services/novel-outline-runtime';
import type { Novel, NovelInjectionToggles } from '@/types/tavern';
import { formatPlayerProfileForCore } from '@/utils/novel-player';
import { formatCastRosterForCore } from '@/utils/novel-dossiers';
import { getActiveQuickTravelWorld } from '@/utils/quick-travel';

export type QuickTravelNovelMemoryState = {
  longTermMemory?: string;
  midTermMemories?: string[];
  shortTermMemories?: string[];
  regressionEcho?: string;
  currentChapter?: string;
  memorySystemEnabled?: boolean;
};

type BuildQuickTravelNovelPromptInput = {
  novel: Novel;
  globalSystemPrompt?: string;
  memoryState?: QuickTravelNovelMemoryState;
  contentScalePrompt?: string;
  injectionToggles?: Partial<NovelInjectionToggles> | null;
  retrievalText?: string;
  nsfwEnabled?: boolean;
};

export const QUICK_TRAVEL_NOVEL_SYSTEM_PROMPT = `【快穿小说章节引擎】
你负责把当前小世界的大纲写成一章可直接阅读的小说正文。

1. 作用域：本章只发生在“当前小世界”。不得混入其他小世界、外层主世界的时代、职业、阵营、人物关系或剧情。
2. 身份分层：跨世界主角核心只决定宿主持续不变的意识、性格倾向、记忆与长期动机；姓名、身体、职业、家庭、社会身份和本世界关系以当前小世界角色卡与扮演身份为准。魂穿时不得把宿主原世界身份直接写成本世界身份。
3. 章节权威：当前章节大纲和作者本轮指令为最高优先级。只写当前章；下一章信息只作为收束边界，不得提前展开或合并章节。
4. 剧情因果：原定剧情是主角进入前的基准轨迹，不是不可改变的命令。已发生偏差必须延续，并通过人物选择产生连续、可追溯的后果。
5. 人物一致：只使用当前小世界角色与本章命中的设定。维持既有关系、认知、称呼、性格、说话方式和状态，不得把已见过的人重写成初遇。
6. 正文要求：使用第三人称小说叙事，通过行动、对白、环境和必要心理活动推进；完整呈现本章开场、发展、转折与章末落点。只输出章节标题和正文，不输出互动选项、路线建议、设定解释或写作说明。`;

export const QUICK_TRAVEL_NOVEL_MINIMAL_PROMPT = `你是快穿小说章节写作引擎。只写当前小世界的当前章节，使用第三人称，遵守当前身份、章节大纲和下一章边界；只输出章节标题与小说正文，不输出互动选项、路线建议或解释。`;

export const QUICK_TRAVEL_NOVEL_REPLY_HINT =
  '【整章输出】本轮必须输出一整章可直接阅读的小说正文。篇幅以当前章节大纲中的动态目标为准；完整写到本章落点，不得提前展开下一章。';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, maxChars: number) {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function searchTerms(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ');
  const terms = new Set(normalized.split(/\s+/u).filter((item) => item.length >= 2));
  for (const chunk of normalized.split(/\s+/u)) {
    if (chunk.length > 2 && /[\u3400-\u9fff]/u.test(chunk)) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        terms.add(chunk.slice(index, index + 2));
      }
    }
  }
  return [...terms];
}

function relevanceScore(value: string, terms: string[]) {
  const haystack = value.toLocaleLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function selectRuleLines(value: string, query: string, maxLines = 8) {
  const lines = value
    .split(/\r?\n|(?<=[。！？；])/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');

  const terms = searchTerms(query);
  const hardRulePattern = /必须|禁止|不得|不可|只能|身份|保密|系统|任务|OOC|记忆/u;
  return lines
    .map((line, index) => ({
      line,
      index,
      score: relevanceScore(line, terms) * 10 + (hardRulePattern.test(line) ? 6 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxLines)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line)
    .join('\n');
}

function buildSystemBlock(
  novel: Novel,
  globalSystemPrompt: string,
  enabled: boolean,
) {
  if (!enabled) return QUICK_TRAVEL_NOVEL_MINIMAL_PROMPT;
  const stored = text(novel.systemPrompt);
  const global = text(globalSystemPrompt);
  const extra = stored && stored !== DEFAULT_NOVEL_SYSTEM_PROMPT
    ? stored
    : global && global !== DEFAULT_NOVEL_SYSTEM_PROMPT
      ? global
      : '';
  return [
    QUICK_TRAVEL_NOVEL_SYSTEM_PROMPT,
    extra ? `【本书额外叙事要求】\n${extra}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildChapterBlock(novel: Novel) {
  return buildNovelOutlineChapterGuidance(resolveNovelOutlineRuntime(novel));
}

function buildGlobalRulesBlock(novel: Novel, query: string) {
  const archive = novel.quickTravel;
  const world = getActiveQuickTravelWorld(novel);
  if (!archive || !world) return '';
  const globalRules = selectRuleLines(archive.config.globalRules, query);
  const worldRules = selectRuleLines(world.worldRules, query);
  const mission = text(world.runtime.mission) || text(world.mission);
  const systemMentioned = [archive.config.systemName, '系统', '积分', '奖励', '结算', '道具']
    .filter(Boolean)
    .some((keyword) => query.includes(keyword));
  const relevantItems = archive.config.carriedItems.filter((item) => query.includes(item));

  return [
    '【快穿规则与本世界任务】',
    archive.config.systemName ? `系统：${archive.config.systemName}` : '',
    globalRules ? `跨世界硬规则：\n${globalRules}` : '',
    worldRules ? `本世界规则：\n${worldRules}` : '',
    mission ? `当前任务：${mission}` : '',
    systemMentioned && archive.config.systemPersonality
      ? `系统性格：${clip(archive.config.systemPersonality, 300)}`
      : '',
    systemMentioned && archive.config.rewardRules
      ? `奖励/结算：${clip(archive.config.rewardRules, 350)}`
      : '',
    relevantItems.length > 0 ? `本章相关携带物：${relevantItems.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function buildWorldBlock(novel: Novel, query: string) {
  const world = getActiveQuickTravelWorld(novel);
  if (!world) return '';
  const chapterIndex = Math.max(1, world.runtime.currentChapter || 1);
  const terms = searchTerms(query);
  const candidateBeats = world.originalPlot.beats
    .filter((beat) => beat.status === 'pending' || beat.status === 'changed')
    .map((beat) => ({
      beat,
      score: relevanceScore(
        `${beat.title}\n${beat.summary}\n${beat.originalResult}`,
        terms,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.beat.order - b.beat.order);
  const relevantBeats = candidateBeats
    .filter((item, index) => item.score > 0 || index === 0)
    .slice(0, 2)
    .map(({ beat }) => `${beat.order}. ${beat.title}：${beat.summary}（原定结果：${beat.originalResult}）`)
    .join('\n');
  const relevantDeviations = world.runtime.deviations
    .filter((item) => item.status !== 'resolved')
    .map((item) => ({
      item,
      score: relevanceScore(
        `${item.originalEvent}\n${item.actualEvent}\n${item.consequence}`,
        terms,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((item, index) => item.score > 0 || index < 2)
    .slice(0, 4)
    .map(({ item }) => `- 原定：${item.originalEvent}\n  实际：${item.actualEvent}\n  后果：${item.consequence}`)
    .join('\n');

  return [
    '【当前小世界资料】',
    `世界：${world.name || '未命名小世界'}`,
    world.worldEra ? `时代与背景：${world.worldEra}` : '',
    world.protagonistIdentity ? `本世界扮演身份：${world.protagonistIdentity}` : '',
    chapterIndex === 1 && world.entryScene ? `初始进入场景：${world.entryScene}` : '',
    world.originalPlot.knownToProtagonist
      ? `主角进入前已知剧情：${clip(world.originalPlot.knownToProtagonist, 700)}`
      : '',
    world.originalPlot.premise
      ? `原定剧情基线：${clip(world.originalPlot.premise, 800)}`
      : '',
    relevantBeats ? `本章相关原定节点：\n${relevantBeats}` : '',
    world.originalPlot.originalEnding
      ? `必须知晓的原定结局边界：${clip(world.originalPlot.originalEnding, 500)}`
      : '',
    relevantDeviations ? `与本章相关的未解决偏差：\n${relevantDeviations}` : '',
  ].filter(Boolean).join('\n');
}

function buildCharacterBlock(novel: Novel, query: string, nsfwEnabled: boolean) {
  const world = getActiveQuickTravelWorld(novel);
  if (!world) return '';
  const currentNovel = { ...novel, cast: world.cast, characterDossiers: world.characterDossiers };
  const protagonists = formatPlayerProfileForCore(currentNovel, { nsfwEnabled });
  const terms = searchTerms(query);
  const related = world.cast
    .filter((character) => !character.isProtagonist)
    .map((character) => ({
      character,
      score: relevanceScore(
        `${character.name}\n${character.profession}\n${character.affiliation}\n${character.personality}\n${character.speechStyle}`,
        terms,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ character }) => {
      if (character.aiSummary && character.dossierV2) {
        const dossier = normalizeCharacterDossierV2(character.dossierV2, character);
        return clip(
          formatCharacterAiSummaryForPrompt(
            normalizeCharacterAiSummary(character.aiSummary, character, dossier),
            { includePrivate: nsfwEnabled },
          ),
          1200,
        );
      }
      return [
        `- ${character.name}${character.profession ? `｜${character.profession}` : ''}`,
        character.personality ? `  性格：${clip(character.personality, 220)}` : '',
        character.speechStyle ? `  口吻：${clip(character.speechStyle, 140)}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n');
  return [
    protagonists,
    related ? `【本章相关角色摘要】\n${related}` : '',
    formatCastRosterForCore(currentNovel),
  ].filter(Boolean).join('\n\n');
}

function buildMemoryBlock(memoryState?: QuickTravelNovelMemoryState) {
  if (!memoryState || memoryState.memorySystemEnabled === false) return '';
  const mid = (memoryState.midTermMemories ?? []).filter(Boolean).slice(-5);
  const short = (memoryState.shortTermMemories ?? []).filter(Boolean).slice(-8);
  return [
    memoryState.longTermMemory?.trim()
      ? `【本小世界长期总结】\n${memoryState.longTermMemory.trim()}`
      : '',
    mid.length > 0 ? `【本小世界过往记忆】\n${mid.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    short.length > 0 ? `【本小世界近期记忆】\n${short.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildQuickTravelNovelCorePrompt({
  novel,
  globalSystemPrompt = '',
  memoryState,
  contentScalePrompt = '',
  injectionToggles,
  retrievalText = '',
  nsfwEnabled = false,
}: BuildQuickTravelNovelPromptInput) {
  const world = getActiveQuickTravelWorld(novel);
  if (!world?.runtime.novelGenerationEnabled) return '';
  const toggles = {
    systemPrompt: injectionToggles?.systemPrompt !== false,
    gameRules: injectionToggles?.gameRules !== false,
    characterCards: injectionToggles?.characterCards !== false,
    worldCards: injectionToggles?.worldCards !== false,
  };
  const chapters = world.outline?.volumes.flatMap((volume) => volume.chapters) ?? [];
  const chapterIndex = Math.max(1, world.runtime.currentChapter || 1);
  const current = chapters.find((chapter) => chapter.index === chapterIndex);
  const query = [
    current?.title,
    current?.goal,
    world.runtime.currentScene,
    retrievalText,
  ].filter(Boolean).join('\n');

  return [
    buildSystemBlock(novel, globalSystemPrompt, toggles.systemPrompt),
    contentScalePrompt,
    `【小说名称】${novel.name}`,
    buildChapterBlock(novel),
    toggles.gameRules ? buildGlobalRulesBlock(novel, query) : '',
    toggles.worldCards ? buildWorldBlock(novel, query) : '',
    toggles.characterCards ? buildCharacterBlock(novel, query, nsfwEnabled) : '',
    buildMemoryBlock(memoryState),
    memoryState?.regressionEcho?.trim()
      ? `【回归残响】\n（来自另一条时间线的教训，不是当前线已经发生的事实。）\n${memoryState.regressionEcho.trim()}`
      : '',
  ].filter(Boolean).join('\n\n');
}
