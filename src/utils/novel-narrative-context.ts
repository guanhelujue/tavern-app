import type { Novel } from '@/types/tavern';
import { buildNovelOutlineChapterGuidance, parseExplicitChapterIndex, resolveNovelOutlineTurnRuntime } from '@/services/novel-outline-runtime';
import { getActiveQuickTravelWorld } from '@/utils/quick-travel';
import { formatPlayerProfileForCore, formatProtagonistAuthority, getProtagonistCast, getProtagonistCastIds, getProtagonistNameKeys } from '@/utils/novel-player';
import { dossiersToWorldbookEntries, ensureNovelDossiers, formatCastRosterForCore } from '@/utils/novel-dossiers';
import { ensureNovelLoreEntries, loreEntriesToWorldbookEntries } from '@/utils/novel-lore';
import { scanWorldbookEntriesRecursively } from '@/utils/worldbook';

export const NOVEL_CAST_IDENTITY_RULE = '【出场人物与身份】角色库是已建档人物索引，不是全部出场名单。姓名、别名或明确身份匹配才能把场景人物对应到已有角色；不得因为名单中只有一位配角，就让其顶替场景中的其他人。角色卡未命中时，保留原文中的姓名或身份称呼，允许未建卡人物出场，不得擅改已有角色的职业、年龄或关系。';

export function getNarrativeNovel(novel: Novel): Novel {
  const world = novel.quickTravel?.config.enabled ? getActiveQuickTravelWorld(novel) : undefined;
  return world ? { ...novel, cast: world.cast, characterDossiers: world.characterDossiers, loreEntries: world.loreEntries } : novel;
}

export function buildNovelRetrievalSeed(novel: Novel, instruction: string, recentText = ''): string {
  const world = novel.quickTravel?.config.enabled ? getActiveQuickTravelWorld(novel) : undefined;
  const scoped = getNarrativeNovel(novel);
  const chapter = parseExplicitChapterIndex(instruction);
  const opening = chapter === 1 || (chapter === undefined && !recentText.trim());
  return [
    instruction,
    recentText,
    buildNovelOutlineChapterGuidance(resolveNovelOutlineTurnRuntime(novel, instruction)),
    novel.foundationPrompt,
    opening ? (world?.entryScene || novel.initialStoryState) : '',
    opening ? novel.projectBrief?.firstChapterGoal : '',
    world?.protagonistIdentity,
    world?.runtime.mission || world?.mission,
    ...getProtagonistCast(scoped.cast).flatMap((character) => [
      character.name,
      ...((character.relations ?? []).map((relation) => `${relation.targetName}：${relation.label}；${relation.note || ''}`)),
    ]),
  ].filter(Boolean).join('\n');
}

/** Shared scene-aware context for the chapter writer and planning agents. */
export function buildNovelCharacterContext(novel: Novel, instruction: string, recentText = ''): string {
  const scoped = getNarrativeNovel(novel);
  const world = novel.quickTravel?.config.enabled ? getActiveQuickTravelWorld(novel) : undefined;
  const entries = [
    ...dossiersToWorldbookEntries(ensureNovelDossiers(scoped), {
      nsfwEnabled: true,
      protagonistCastIds: getProtagonistCastIds(scoped.cast),
      protagonistNameKeys: getProtagonistNameKeys(scoped.cast),
      cast: scoped.cast,
    }),
    ...loreEntriesToWorldbookEntries(ensureNovelLoreEntries(scoped)),
  ];
  const selected = scanWorldbookEntriesRecursively(entries, buildNovelRetrievalSeed(novel, instruction, recentText), 2500);
  return [
    formatProtagonistAuthority(scoped.cast),
    NOVEL_CAST_IDENTITY_RULE,
    novel.foundationPrompt ? `【创作设定·人物身份以当前角色卡为准】\n${novel.foundationPrompt}` : '',
    (world?.entryScene || scoped.initialStoryState) ? `【初始故事状态·开篇依据，后续沿用已发生剧情】\n${world?.entryScene || scoped.initialStoryState}` : '',
    buildNovelOutlineChapterGuidance(resolveNovelOutlineTurnRuntime(novel, instruction)),
    formatPlayerProfileForCore(scoped, { nsfwEnabled: true }),
    formatCastRosterForCore(scoped),
    ...selected.map((entry) => entry.content),
  ].filter(Boolean).join('\n\n');
}
