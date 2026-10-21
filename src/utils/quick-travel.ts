import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import type {
  Novel,
  QuickTravelArchive,
  QuickTravelConfig,
  OriginalPlot,
  WorldPack,
  WorldRuntimeState,
} from '@/types/tavern';

export const EMPTY_QUICK_TRAVEL_CONFIG: QuickTravelConfig = {
  enabled: true,
  systemName: '系统',
  systemPersonality: '',
  globalRules: '',
  rewardRules: '',
  itemRules: '',
  memoryRules: '',
  carriedItems: [],
  carriedFlags: [],
};

export function createEmptyOriginalPlot(): OriginalPlot {
  return { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' };
}

export function createEmptyWorldOutline(now = new Date().toISOString()) {
  return {
    summary: '',
    volumes: [{
      id: 'world-volume-1',
      title: '本世界篇章',
      summary: '',
      chapters: [{ index: 1, title: '第一章', goal: '', sceneEnd: false }],
    }],
    updatedAt: now,
  };
}

export function createEmptyWorldRuntime(mission = ''): WorldRuntimeState {
  return {
    currentScene: '',
    currentChapter: 0,
    mission,
    missionStatus: 'not_started',
    completedObjectives: [],
    deviations: [],
    currentEnding: '',
    novelGenerationEnabled: false,
    novelGenerationTargetWords: 4500,
  };
}

export function createWorldPackFromNovel(novel: Novel, now = new Date().toISOString()): WorldPack {
  return {
    id: `world-${novel.id}`,
    name: novel.worldName || novel.name,
    worldEra: novel.worldEra,
    worldRules: novel.gameRules,
    protagonistIdentity: novel.playerPersona,
    entryScene: '',
    mission: '',
    cast: novel.cast ?? [],
    characterDossiers: novel.characterDossiers ?? [],
    loreEntries: novel.loreEntries ?? [],
    originalPlot: createEmptyOriginalPlot(),
    outline: createEmptyWorldOutline(now),
    runtime: createEmptyWorldRuntime(),
    status: 'active',
    createdAt: novel.createdAt || now,
    updatedAt: novel.updatedAt || now,
  };
}

/** The hierarchy root: a lightweight world that owns the host's cast. */
export function createMainWorldPackFromNovel(novel: Novel, now = new Date().toISOString()): WorldPack {
  return {
    id: `main-world-${novel.id}`,
    isMainWorld: true,
    name: novel.worldName || novel.name,
    worldEra: novel.worldEra,
    worldRules: novel.gameRules,
    protagonistIdentity: novel.playerPersona,
    entryScene: '',
    mission: '',
    cast: novel.cast ?? [],
    characterDossiers: novel.characterDossiers ?? [],
    loreEntries: novel.loreEntries ?? [],
    originalPlot: createEmptyOriginalPlot(),
    outline: createEmptyWorldOutline(now),
    runtime: createEmptyWorldRuntime(),
    status: 'active',
    createdAt: novel.createdAt || now,
    updatedAt: novel.updatedAt || now,
  };
}

export function ensureQuickTravelArchive(novel: Novel): QuickTravelArchive {
  if (novel.quickTravel?.worlds?.length) {
    const existingWorlds = novel.quickTravel.worlds;
    const mainWorld = existingWorlds.find((world) => world.isMainWorld);
    const worlds = mainWorld
      ? [mainWorld, ...existingWorlds.filter((world) => world.id !== mainWorld.id)]
      : [createMainWorldPackFromNovel(novel), ...existingWorlds];
    return {
      config: { ...EMPTY_QUICK_TRAVEL_CONFIG, ...novel.quickTravel.config },
      worlds,
      activeWorldId: novel.quickTravel.activeWorldId ?? worlds[0]?.id,
      settlements: novel.quickTravel.settlements ?? [],
    };
  }

  const world = createMainWorldPackFromNovel(novel);
  return {
    config: { ...EMPTY_QUICK_TRAVEL_CONFIG },
    worlds: [world],
    activeWorldId: world.id,
    settlements: [],
  };
}

export function getActiveQuickTravelWorld(novel: Novel): WorldPack | undefined {
  const archive = novel.quickTravel;
  if (!archive) return undefined;
  return archive.worlds.find((world) => world.id === archive.activeWorldId) ?? archive.worlds[0];
}

/**
 * Minimal current-world context for character generation.
 *
 * Do not pass the whole WorldPack here: originalPlot, entryScene and runtime
 * are useful to plot generation, but they are not needed to establish a
 * character card and can introduce unrelated names and token cost.
 */
export function buildQuickTravelCharacterContext(
  world: Pick<WorldPack, 'name' | 'generationBrief' | 'worldEra' | 'worldRules' | 'mission'>,
): string {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const name = text(world.name);
  const generationBrief = text(world.generationBrief);
  const worldEra = text(world.worldEra);
  const worldRules = text(world.worldRules);
  const mission = text(world.mission);

  return [
    `当前小世界：${name || '未命名小世界'}`,
    generationBrief ? `用户构想：${generationBrief}` : '',
    worldEra ? `时代与设定：${worldEra}` : '',
    worldRules ? `本世界规则：${worldRules}` : '',
    mission ? `本世界任务：${mission}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildQuickTravelContext(
  novel: Novel,
  options: {
    includeWorldCard?: boolean;
    includeCharacterCards?: boolean;
    nsfwEnabled?: boolean;
  } = {},
): string {
  const archive = novel.quickTravel;
  if (!archive?.config.enabled) return '';
  const world = getActiveQuickTravelWorld(novel);
  if (!world) return '';
  const includeWorldCard = options.includeWorldCard !== false;
  const includeCharacterCards = options.includeCharacterCards !== false;
  const beats = world.originalPlot.beats
    .filter((beat) => beat.status === 'pending' || beat.status === 'changed')
    .slice(0, 5)
    .map((beat) => `${beat.order}. ${beat.title}：${beat.summary}（原定结果：${beat.originalResult}）`)
    .join('\n');
  const deviations = world.runtime.deviations
    .filter((item) => item.status !== 'resolved')
    .slice(-8)
    .map((item) => `- 原定：${item.originalEvent}\n  实际：${item.actualEvent}\n  后果：${item.consequence}`)
    .join('\n');
  const cast = world.cast
    .slice(0, 8)
    .map((character) => {
      if (character.aiSummary && character.dossierV2) {
        const dossier = normalizeCharacterDossierV2(character.dossierV2, character);
        return formatCharacterAiSummaryForPrompt(
          normalizeCharacterAiSummary(character.aiSummary, character, dossier),
          { includePrivate: options.nsfwEnabled === true },
        );
      }
      return `- ${character.name}｜${character.gender}/${character.age}｜${character.profession}\n  外貌：${character.appearance}\n  性格：${character.personality}\n  背景：${character.background}`;
    })
    .join('\n');
  const outline = world.outline;
  const outlineChapters = outline?.volumes.flatMap((volume) => volume.chapters) ?? [];
  const currentChapterIndex = Math.max(1, world.runtime.currentChapter || 1);
  const currentPlan = outlineChapters.find((chapter) => chapter.index === currentChapterIndex);
  const nextPlan = outlineChapters.find((chapter) => chapter.index === currentChapterIndex + 1);
  // The chapter plan is injected only when an authored outline has activated
  // chapter-driven writing. Normal role-play keeps the quick-travel setting but
  // is not forced into a chapter-shaped reply.
  const outlineText = outline && currentPlan && world.runtime.novelGenerationEnabled
    ? [
        outline.summary ? `本世界主线：${outline.summary}` : '',
        `当前第 ${currentPlan.index} 章《${currentPlan.title}》`,
        `本章目标：${currentPlan.goal}`,
        `本章目标篇幅：约 ${Math.max(1000, world.runtime.novelGenerationTargetWords || 4500)} 字。`,
        nextPlan ? `下一章衔接（不可提前展开）：第 ${nextPlan.index} 章《${nextPlan.title}》` : '',
        world.runtime.novelGenerationEnabled
          ? '章节推进已开启：本次回复只能完成当前这一章，不能提前写下一章或合并多章。'
          : '',
      ].filter(Boolean).join('\n')
    : '';
  return [
    includeCharacterCards ? `【当前小世界角色】\n${cast || '尚未建立角色卡。'}` : '',
    includeWorldCard ? `【快穿全局设定】\n系统：${archive.config.systemName}\n${archive.config.globalRules}` : '',
    includeWorldCard ? `系统性格：${archive.config.systemPersonality}\n奖励规则：${archive.config.rewardRules}\n道具：${archive.config.carriedItems.join('、')}` : '',
    includeWorldCard ? `【当前小世界】\n世界：${world.name}\n时代与背景：${world.worldEra}\n主角身份：${world.protagonistIdentity}\n任务：${world.runtime.mission || world.mission}` : '',
    includeWorldCard ? `【原定剧情】\n${world.originalPlot.premise}\n${beats}\n原定结局：${world.originalPlot.originalEnding}` : '',
    outlineText ? `【本小世界当前章节大纲（最高优先级）】\n${outlineText}` : '',
    includeWorldCard ? `【已发生偏差】\n${deviations || '尚未发生偏差。'}` : '',
    includeWorldCard ? '原定剧情是基准轨迹，不是强制命令。主角的行动必须产生合理、连续的因果变化。' : '',
  ].filter(Boolean).join('\n\n');
}
