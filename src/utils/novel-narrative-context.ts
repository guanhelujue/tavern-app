import type { Novel } from '@/types/tavern';
import { buildActiveNovelFoundation } from '@/features/novel-creation/legacy-novel-adapter';
import { buildNovelOutlineChapterGuidance, parseExplicitChapterIndex, resolveNovelOutlineTurnRuntime } from '@/services/novel-outline-runtime';
import { getActiveQuickTravelWorld } from '@/utils/quick-travel';
import { formatPlayerProfileForCore, formatProtagonistAuthority, getProtagonistCast, getProtagonistCastIds, getProtagonistNameKeys } from '@/utils/novel-player';
import { dossiersToWorldbookEntries, ensureNovelDossiers, formatCastRosterForCore } from '@/utils/novel-dossiers';
import { ensureNovelLoreEntries, loreEntriesToWorldbookEntries } from '@/utils/novel-lore';
import { scanWorldbookEntriesRecursively } from '@/utils/worldbook';
import { formatNovelForeshadowingContext } from '@/utils/novel-foreshadowing-workspace';

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
    buildActiveNovelFoundation(novel),
    opening ? (world?.entryScene || novel.projectBrief?.firstChapterGoal || novel.initialStoryState) : '',
    opening ? novel.projectBrief?.firstChapterGoal : '',
    world?.protagonistIdentity,
    world?.runtime.mission || world?.mission,
    ...getProtagonistCast(scoped.cast).flatMap((character) => [
      character.name,
      ...((character.relations ?? []).map((relation) => `${relation.targetName}：${relation.label}；${relation.note || ''}`)),
    ]),
  ].filter(Boolean).join('\n');
}

/** Author-written outline constraints that must reach the normal chapter writer. */
export function buildNovelOutlineWritingConstraints(novel: Novel, instruction: string): string {
  const runtime = resolveNovelOutlineTurnRuntime(novel, instruction);
  const chapter = runtime?.current;
  const volume = runtime?.outline.volumes.find((candidate) =>
    candidate.chapters.some((item) => item.index === chapter?.index),
  );
  if (!chapter || !volume) return '';

  const volumeLines = [
    volume.tone?.trim() ? `节奏与基调：${volume.tone.trim()}` : '',
    volume.foreshadowing?.trim() ? `卷级伏笔边界：${volume.foreshadowing.trim()}` : '',
    volume.handoff?.outgoing?.trim() ? `卷末交接：${volume.handoff.outgoing.trim()}` : '',
  ].filter(Boolean);
  const chapterLines = [
    chapter.characterChange?.trim() ? `人物变化：${chapter.characterChange.trim()}` : '',
    chapter.foreshadowing?.trim() ? `本章伏笔：${chapter.foreshadowing.trim()}` : '',
    chapter.endingHook?.trim() ? `章末钩子：${chapter.endingHook.trim()}` : '',
  ].filter(Boolean);
  if (!volumeLines.length && !chapterLines.length) return '';
  return [
    volumeLines.length ? `【当前卷纲约束·写作时遵守】\n${volumeLines.join('\n')}` : '',
    chapterLines.length ? `【当前章纲约束·写作时落实】\n${chapterLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Shared scene-aware context for the chapter writer and planning agents. */
export function buildNovelCharacterContext(novel: Novel, instruction: string, recentText = ''): string {
  const scoped = getNarrativeNovel(novel);
  const world = novel.quickTravel?.config.enabled ? getActiveQuickTravelWorld(novel) : undefined;
  const opening = world?.entryScene || novel.projectBrief?.firstChapterGoal || scoped.initialStoryState;
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
    `【当前创作设定·人物身份以当前角色卡为准】\n${buildActiveNovelFoundation(novel)}`,
    novel.writingStyle?.trim() ? `【作者指定写作风格】\n${novel.writingStyle.trim()}` : '',
    novel.gameRules?.trim() ? `【作者约束】\n${novel.gameRules.trim()}` : '',
    buildNovelOutlineWritingConstraints(novel, instruction),
    formatNovelForeshadowingContext(novel),
    opening ? `【初始故事状态·开篇依据，后续沿用已发生剧情】\n${opening}` : '',
    buildNovelOutlineChapterGuidance(resolveNovelOutlineTurnRuntime(novel, instruction)),
    formatPlayerProfileForCore(scoped, { nsfwEnabled: true }),
    formatCastRosterForCore(scoped),
    ...selected.map((entry) => entry.content),
  ].filter(Boolean).join('\n\n');
}
