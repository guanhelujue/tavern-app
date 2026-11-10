import { DEFAULT_CHARACTER_CARD_APPEARANCE_ID } from '@/constants/character-card-appearances';
import type { NovelPromptDefaults } from '@/store/tavern-store';
import type { CreateNovelInput, Novel, NovelCreationBlueprint, NovelProjectBrief } from '@/types/tavern';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '@/utils/novel-player';

import { compileStoryFoundation } from './blueprint-compiler';
import type { StoryBlueprint } from './domain';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

const FOUNDATION_HEADINGS = new Set([
  '世界名称', '作品定位', '主角核心', '世界设定', '失败代价', '开篇状态', '长期方向',
  '长篇故事引擎', '阶段推进', '长期悬念与副线', '叙事气质', '作者约束',
]);

function section(prompt: string | undefined, label: string): string {
  const value = text(prompt).replace(/\r\n?/g, '\n');
  if (!value) return '';
  const match = value.match(new RegExp(`【${label}】[ \\t]*\\n([\\s\\S]*?)(?=\\n\\s*【[^】]+】[ \\t]*\\n|$)`));
  return match?.[1]?.trim() ?? '';
}

function numberedSection(prompt: string | undefined, label: string): string[] {
  return section(prompt, label)
    .split(/\n/)
    .map((item) => item.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

function bulletSection(prompt: string | undefined, label: string): string[] {
  return section(prompt, label)
    .split(/\n/)
    .map((item) => item.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function parseFoundation(prompt: string | undefined) {
  const protagonist = section(prompt, '主角核心');
  const field = (label: string) => protagonist.match(new RegExp(`(?:^|\\n)${label}：([^\\n]*)`))?.[1]?.trim() ?? '';
  return {
    premise: section(prompt, '作品定位'),
    setting: section(prompt, '世界设定'),
    identity: field('身份'),
    desire: field('欲望'),
    obstacle: field('核心阻力'),
    stakes: section(prompt, '失败代价'),
    opening: section(prompt, '开篇状态'),
    direction: section(prompt, '长期方向'),
    tone: section(prompt, '叙事气质'),
    engine: section(prompt, '长篇故事引擎'),
    arcs: numberedSection(prompt, '阶段推进'),
    openThreads: bulletSection(prompt, '长期悬念与副线'),
    constraints: bulletSection(prompt, '作者约束'),
  };
}

function normalizedBlueprint(blueprint: StoryBlueprint): StoryBlueprint {
  return {
    ...blueprint,
    title: text(blueprint.title),
    premise: text(blueprint.premise),
    setting: text(blueprint.setting),
    stakes: text(blueprint.stakes),
    opening: text(blueprint.opening),
    direction: text(blueprint.direction),
    tone: text(blueprint.tone),
    constraints: list(blueprint.constraints),
    protagonist: {
      identity: text(blueprint.protagonist.identity),
      desire: text(blueprint.protagonist.desire),
      obstacle: text(blueprint.protagonist.obstacle),
    },
    longForm: {
      engine: text(blueprint.longForm.engine),
      arcs: list(blueprint.longForm.arcs),
      openThreads: list(blueprint.longForm.openThreads),
    },
  };
}

function preserveUnknownFoundation(prompt: string | undefined): string {
  const value = text(prompt);
  if (!value) return '';
  const pattern = /【([^】]+)】\s*\n([\s\S]*?)(?=\n\s*【[^】]+】\s*\n|$)/g;
  const unknown: string[] = [];
  for (const match of value.matchAll(pattern)) {
    if (!FOUNDATION_HEADINGS.has(match[1].trim())) {
      unknown.push(`【${match[1].trim()}】\n${match[2].trim()}`.trim());
    }
  }
  const plain = value.replace(pattern, '').trim();
  return [...unknown, plain].filter(Boolean).join('\n\n');
}

function firstDefinedText(...values: unknown[]): string {
  const value = values.find((item) => item !== undefined && item !== null);
  return text(value);
}

export function buildLegacyNovelInput({
  blueprint,
  promptDefaults,
}: {
  blueprint: StoryBlueprint;
  promptDefaults: NovelPromptDefaults;
}): CreateNovelInput {
  const value = normalizedBlueprint(blueprint);
  const foundationPrompt = compileStoryFoundation(value);
  const constraints = value.constraints.join('\n');
  const title = value.title;
  const setting = value.setting;
  const premise = value.premise;
  const intro = premise || setting;
  const creationBlueprint: NovelCreationBlueprint = {
    profile: { structure: 'single_world', entry: 'none', focus: 'mixed', knownPlot: false },
    storyCore: {
      title,
      brief: intro,
      premise,
      theme: value.tone,
      ending: value.direction,
      plannedChapters: 20,
      firstChapterGoal: value.opening,
      worldName: title,
      worldEra: setting,
      gameRules: constraints,
    },
    protagonistCore: {
      identity: text(value.protagonist?.identity),
      goal: text(value.protagonist?.desire),
    },
    planning: {
      obstacle: text(value.protagonist?.obstacle),
      stakes: value.stakes,
      engine: text(value.longForm?.engine),
      arcs: list(value.longForm?.arcs),
      openThreads: list(value.longForm?.openThreads),
    },
    foundationPrompt,
  };
  const projectBrief: NovelProjectBrief = {
    premise,
    theme: value.tone,
    protagonistArc: '',
    ending: value.direction,
    plannedChapters: 20,
    firstChapterGoal: value.opening,
    storyKind: 'serialized',
  };

  return {
    name: title,
    shortIntro: intro.slice(0, 120),
    detailedIntro: intro,
    systemPrompt: promptDefaults.systemPrompt,
    writingStyle: '',
    shortTermMemoryPrompt: promptDefaults.shortTermMemoryPrompt,
    midTermMemoryPrompt: promptDefaults.midTermMemoryPrompt,
    longTermMemoryPrompt: promptDefaults.longTermMemoryPrompt,
    playerName: '',
    playerPersona: text(value.protagonist?.identity),
    playerMotive: text(value.protagonist?.desire),
    ...EMPTY_PLAYER_PROFILE_FIELDS,
    worldName: title,
    worldEra: setting,
    worldConflict: '',
    worldTone: '',
    mainPlot: '',
    initialStoryState: '',
    gameRules: constraints,
    autoSuggestRoutes: false,
    relationGraphEnabled: false,
    characterCardAppearanceId: DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
    cast: [],
    characterDossiers: [],
    loreEntries: [],
    relationGraphs: [],
    openingMessage: '',
    defaultModelId: '',
    defaultProviderId: undefined,
    chatBackgroundOpacity: 0.35,
    foundationPrompt,
    creationBlueprint,
    projectBrief,
    creationMode: 'workbench',
    agentMode: 'narrator',
    agentReviewMode: 'fast',
    isDraft: false,
    createStep: 3,
    isContinuationProject: false,
  };
}

/** Read the editable creation blueprint from current novel data, including legacy prompt sections. */
export function readNovelBlueprint(novel: Novel): StoryBlueprint {
  const stored = novel.creationBlueprint;
  const core = stored?.storyCore;
  const brief = novel.projectBrief;
  const parsed = parseFoundation(novel.foundationPrompt);
  const planning = stored?.planning;
  const protagonist = (novel.cast ?? []).find((character) => character.isProtagonist);
  const arcs = list(planning?.arcs).length ? list(planning?.arcs) : parsed.arcs;
  const openThreads = list(planning?.openThreads).length ? list(planning?.openThreads) : parsed.openThreads;
  const premise = brief && Object.prototype.hasOwnProperty.call(brief, 'premise')
    ? firstDefinedText(brief.premise)
    : core && Object.prototype.hasOwnProperty.call(core, 'premise')
      ? firstDefinedText(core.premise)
      : core && Object.prototype.hasOwnProperty.call(core, 'brief')
        ? firstDefinedText(core.brief)
        : firstDefinedText(parsed.premise);
  return {
    id: `blueprint-${novel.id}`,
    title: text(novel.worldName) || text(novel.name),
    premise,
    protagonist: {
      identity: protagonist ? text(protagonist.profession) : text(stored?.protagonistCore?.identity) || text(novel.playerPersona) || parsed.identity,
      desire: protagonist ? text(protagonist.motive) : text(stored?.protagonistCore?.goal) || text(novel.playerMotive) || parsed.desire,
      obstacle: text(planning?.obstacle) || parsed.obstacle,
    },
    setting: text(novel.worldEra) || text(core?.worldEra) || parsed.setting,
    stakes: text(planning?.stakes) || parsed.stakes,
    opening: text(brief?.firstChapterGoal) || text(core?.firstChapterGoal) || parsed.opening,
    direction: text(brief?.ending) || text(core?.ending) || parsed.direction,
    tone: text(brief?.theme) || text(core?.theme) || parsed.tone,
    constraints: typeof novel.gameRules === 'string'
      ? novel.gameRules.split('\n').map((item) => item.trim()).filter(Boolean)
      : text(core?.gameRules).split('\n').map((item) => item.trim()).filter(Boolean).length
        ? text(core?.gameRules).split('\n').map((item) => item.trim()).filter(Boolean)
        : parsed.constraints,
    longForm: {
      engine: text(planning?.engine) || parsed.engine,
      arcs,
      openThreads,
    },
  };
}

/** Rebuild generation context from current fields while preserving custom legacy sections. */
export function buildActiveNovelFoundation(novel: Novel): string {
  return [compileStoryFoundation(readNovelBlueprint(novel)), preserveUnknownFoundation(novel.foundationPrompt)]
    .filter(Boolean).join('\n\n');
}

/** Build a narrow update payload without replacing cast, outline, or runtime data. */
export function buildNovelBlueprintUpdate(
  novel: Novel,
  blueprint: StoryBlueprint,
): Partial<CreateNovelInput> {
  const value = normalizedBlueprint(blueprint);
  const previous = novel.creationBlueprint;
  const previousBrief = novel.projectBrief;
  const title = value.title || text(novel.worldName) || text(novel.name);
  const premise = value.premise;
  const intro = premise || value.setting;
  const plannedChapters = previousBrief?.plannedChapters
    ?? previous?.storyCore.plannedChapters
    ?? 20;
  const storyKind = previousBrief?.storyKind;
  const foundationPrompt = [
    compileStoryFoundation(value),
    preserveUnknownFoundation(novel.foundationPrompt),
  ].filter(Boolean).join('\n\n');
  const creationBlueprint: NovelCreationBlueprint = {
    profile: previous?.profile ?? { structure: 'single_world', entry: 'none', focus: 'mixed', knownPlot: false },
    storyCore: {
      title,
      brief: intro,
      premise,
      theme: value.tone,
      ending: value.direction,
      plannedChapters,
      firstChapterGoal: value.opening,
      worldName: title,
      worldEra: value.setting,
      gameRules: value.constraints.join('\n'),
    },
    protagonistCore: {
      ...(previous?.protagonistCore?.name ? { name: previous.protagonistCore.name } : {}),
      ...(previous?.protagonistCore?.gender ? { gender: previous.protagonistCore.gender } : {}),
      identity: text(value.protagonist?.identity),
      goal: text(value.protagonist?.desire),
    },
    planning: {
      obstacle: text(value.protagonist?.obstacle),
      stakes: value.stakes,
      engine: text(value.longForm?.engine),
      arcs: list(value.longForm?.arcs),
      openThreads: list(value.longForm?.openThreads),
    },
    ...(previous?.runtimeSeed ? { runtimeSeed: previous.runtimeSeed } : {}),
    foundationPrompt,
  };
  const projectBrief: NovelProjectBrief = {
    premise,
    theme: value.tone,
    protagonistArc: previousBrief?.protagonistArc ?? '',
    ending: value.direction,
    plannedChapters,
    firstChapterGoal: value.opening,
    ...(storyKind ? { storyKind } : {}),
  };
  return {
    // Keep the work's display name stable; the editable blueprint title is the world name.
    worldName: title,
    worldEra: value.setting,
    gameRules: value.constraints.join('\n'),
    playerPersona: text(value.protagonist?.identity),
    playerMotive: text(value.protagonist?.desire),
    projectBrief,
    creationBlueprint,
    foundationPrompt,
  };
}
