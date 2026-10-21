import { MAX_NOVEL_LORE_CONTENT_LENGTH } from '@/constants/novel-lore';
import type {
  Novel,
  NovelCastCharacter,
  NovelCastRelation,
  NovelCharacterDossier,
  NovelCharacterRelationship,
  NovelLoreEntry,
  NovelStoryAnalysis,
} from '@/types/tavern';
import { generateId, namesMatch } from '@/utils/helpers';
import { syncDossiersWithCast } from '@/utils/novel-dossiers';
import { createEmptyLoreEntry } from '@/utils/novel-lore';

/** 同步报告：用于 UI 提示与测试断言。 */
export type KnowledgeSyncReport = {
  addedCast: number;
  skippedCast: number;
  addedLore: number;
  skippedLore: number;
  addedNodes: number;
  addedEdges: number;
  skippedEdges: number;
  hasMainGraph: boolean;
};

export const EMPTY_SYNC_REPORT: KnowledgeSyncReport = {
  addedCast: 0,
  skippedCast: 0,
  addedLore: 0,
  skippedLore: 0,
  addedNodes: 0,
  addedEdges: 0,
  skippedEdges: 0,
  hasMainGraph: false,
};

function isProtagonistRole(role: string): boolean {
  return /主角|女主|男主/.test(role);
}

function nameKey(value: string): string {
  return value.trim().toLowerCase();
}

/** 从分析角色与人物状态构造一张角色卡（cast）。 */
function castFromAnalysisCharacter(
  character: NovelStoryAnalysis['characters'][number],
  state: NovelStoryAnalysis['characterStates'][number] | undefined,
  relations: NovelCastRelation[],
  timestamp: string,
  nsfwEnabled = false,
): NovelCastCharacter {
  const profile = character.profile.trim();
  const backgroundParts = [
    profile,
    character.background?.trim(),
    state?.currentState ? `当前状态：${state.currentState}` : '',
    state?.goal ? `目标：${state.goal}` : '',
    state?.knows.length ? `知道[${state.knows.slice(0, 4).join('、')}]` : '',
    state?.unknown.length ? `不知道[${state.unknown.slice(0, 3).join('、')}]` : '',
  ].filter(Boolean);

  return {
    id: generateId('cast'),
    name: character.name.trim(),
    profession: character.role.trim(),
    age: '',
    gender: '',
    height: '',
    weight: '',
    appearance: character.appearance?.trim() ?? '',
    personality: character.personality?.trim() ?? '',
    speechStyle: state?.speakingStyle.trim() ?? character.speechStyle?.trim() ?? '',
    background: backgroundParts.join('\n'),
    isProtagonist: isProtagonistRole(character.role) || undefined,
    motive: character.motivation?.trim() || state?.motive.trim() || undefined,
    affiliation: character.affiliation?.trim() || undefined,
    relations: relations.length > 0 ? relations : undefined,
    ...(nsfwEnabled && character.privacy ? { privacy: character.privacy } : {}),
    generatedFromReply: true,
    sourceChapter: undefined,
  };
}

/** 抽取某角色为「from」的全部关系（转成 cast relations）。 */
function relationsFromAnalysis(
  relationships: NovelCharacterRelationship[],
  characterName: string,
): NovelCastRelation[] {
  const result: NovelCastRelation[] = [];
  for (const relation of relationships) {
    if (!namesMatch(relation.fromCharacter, characterName)) {
      continue;
    }
    const targetName = relation.toCharacter.trim();
    if (!targetName) {
      continue;
    }
    if (result.some((item) => namesMatch(item.targetName, targetName) && item.label === relation.relation)) {
      continue;
    }
    result.push({
      id: generateId('castrel'),
      targetName,
      label: relation.relation.trim() || '认识',
      note: relation.description.trim().slice(0, 120) || undefined,
      source: 'ai',
    });
  }
  return result;
}


/**
 * 把 `novelStoryAnalysis` 映射到知识库三件套：
 * - 角色 → 角色卡（cast + 关联 dossier）
 * - 正史世界规则 → lore 条目
 * - 人物关系 → 主关系图谱 nodes/edges
 *
 * 幂等且不破坏用户已有数据：已存在（按名字匹配）的 cast / lore / 节点 / 边一律跳过，
 * 只追加缺失项；不删除、不覆盖用户手动编辑内容。无分析时原样返回。
 */
export function syncStoryAnalysisToKnowledgeBase(
  novel: Novel,
  options?: { nsfwEnabled?: boolean },
): {
  cast: NovelCastCharacter[];
  characterDossiers: NovelCharacterDossier[];
  loreEntries: NovelLoreEntry[];
  relationGraphs: Novel['relationGraphs'];
  report: KnowledgeSyncReport;
} {
  const analysis = novel.novelStoryAnalysis ?? null;
  const nsfwEnabled = options?.nsfwEnabled === true;
  const report: KnowledgeSyncReport = { ...EMPTY_SYNC_REPORT };

  if (!analysis || !analysis.characters.length) {
    return {
      cast: novel.cast ?? [],
      characterDossiers: novel.characterDossiers ?? [],
      loreEntries: novel.loreEntries ?? [],
      relationGraphs: [],
      report,
    };
  }

  const timestamp = new Date().toISOString();
  const existingCast = Array.isArray(novel.cast) ? novel.cast : [];
  const castByName = new Map(
    existingCast
      .filter((item) => item.name.trim())
      .map((item) => [nameKey(item.name), item]),
  );

  // ── 1. 角色卡 ────────────────────────────────────────────────────────────
  const newCast: NovelCastCharacter[] = [];
  for (const character of analysis.characters) {
    if (!character.name.trim()) {
      continue;
    }
    const state = analysis.characterStates.find((item) => item.characterId === character.id);
    if (castByName.has(nameKey(character.name))) {
      report.skippedCast += 1;
      // 自动生成的卡在检索增强后刷新公开字段；用户手动编辑过的卡不覆盖。
      const existing = castByName.get(nameKey(character.name))!;
      if (existing.generatedFromReply) {
        const refreshed = castFromAnalysisCharacter(
          character,
          state,
          existing.relations ?? [],
          timestamp,
          nsfwEnabled,
        );
        const merged = { ...existing };
        for (const field of [
          'appearance',
          'personality',
          'speechStyle',
          'background',
          'motive',
          'affiliation',
        ] as const) {
          const value = refreshed[field];
          if (typeof value === 'string' && value.trim()) {
            merged[field] = value;
          }
        }
        merged.privacy = nsfwEnabled ? refreshed.privacy : undefined;
        castByName.set(nameKey(character.name), merged);
      }
      continue;
    }
    const relations = relationsFromAnalysis(analysis.relationships, character.name);
    const card = castFromAnalysisCharacter(character, state, relations, timestamp, nsfwEnabled);
    newCast.push(card);
    castByName.set(nameKey(character.name), card);
  }
  report.addedCast = newCast.length;

  // 若自动生成的卡被刷新，把合并结果写回正式列表（保持原有顺序与 id）。
  const nextCast = existingCast.map((card) => castByName.get(nameKey(card.name)) ?? card).concat(newCast);
  const existingDossiers = Array.isArray(novel.characterDossiers)
    ? novel.characterDossiers
    : [];
  const nextDossiers = syncDossiersWithCast(nextCast, existingDossiers);

  // ── 2. 正史 → lore ───────────────────────────────────────────────────────
  const existingLore = Array.isArray(novel.loreEntries) ? novel.loreEntries : [];
  const loreByName = new Map(
    existingLore
      .filter((item) => item.name.trim())
      .map((item) => [nameKey(item.name), item]),
  );
  const newLore: NovelLoreEntry[] = [];
  for (const fact of analysis.worldFacts) {
    if (!fact.subject.trim() || !fact.content.trim()) {
      continue;
    }
    if (loreByName.has(nameKey(fact.subject))) {
      report.skippedLore += 1;
      continue;
    }
    const entry = createEmptyLoreEntry('lore');
    entry.name = fact.subject.trim();
    entry.content = fact.content.trim().slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH);
    entry.updatedAt = timestamp;
    newLore.push(entry);
    loreByName.set(nameKey(entry.name), entry);
  }
  report.addedLore = newLore.length;
  const nextLore = [...existingLore, ...newLore];

  return {
    cast: nextCast,
    characterDossiers: nextDossiers,
    loreEntries: nextLore,
    relationGraphs: [],
    report,
  };
}

/** 供 UI 文案使用的报告摘要。 */
export function formatKnowledgeSyncReport(report: KnowledgeSyncReport): string {
  const parts = [
    report.addedCast > 0 ? `新增角色 ${report.addedCast} 张` : '',
    report.addedLore > 0 ? `新增设定 ${report.addedLore} 条` : '',
  ].filter(Boolean);
  const skipped =
    report.skippedCast + report.skippedLore + report.skippedEdges;
  return parts.length === 0
    ? skipped > 0
      ? `没有新内容（已有 ${skipped} 项跳过）`
      : '没有可同步的内容'
    : skipped > 0
      ? `${parts.join('，')}；已有条目保持不变`
      : parts.join('，');
}
