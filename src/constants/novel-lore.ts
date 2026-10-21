/** Lore / settings knowledge types (non-character). */

export const NOVEL_LORE_TYPES = [
  'world',
  'location',
  'faction',
  'item',
  'lore',
  'custom',
] as const;

export type NovelLoreTypeId = (typeof NOVEL_LORE_TYPES)[number];

export type NovelLoreCollection = {
  id: string;
  name: string;
  description: string;
  defaultType: NovelLoreTypeId;
};

export const NOVEL_LORE_TYPE_LABELS: Record<NovelLoreTypeId, string> = {
  world: '世界',
  location: '地点',
  faction: '势力',
  item: '物品',
  lore: '设定',
  custom: '其他',
};

/**
 * Permanent atlas volumes. Custom volumes are stored on the novel and merged
 * with this list for display. Keeping semantic type separate from volume lets
 * a user create several item collections (神兵谱 / 法宝录 / 载具库) without
 * growing the prompt schema.
 */
export const SYSTEM_NOVEL_LORE_COLLECTIONS: readonly NovelLoreCollection[] = [
  { id: 'atlas-world', name: '世界核心', description: '时代、秩序与不可违背的底层规则', defaultType: 'world' },
  { id: 'atlas-location', name: '山河舆图', description: '城池、疆域、秘境与空间关系', defaultType: 'location' },
  { id: 'atlas-faction', name: '势力谱系', description: '组织、阵营、门派与权力结构', defaultType: 'faction' },
  { id: 'atlas-item', name: '器物典藏', description: '兵器、道具、遗物与关键资源', defaultType: 'item' },
  { id: 'atlas-lore', name: '规则与传闻', description: '制度、历史、风俗和未分类设定', defaultType: 'lore' },
  { id: 'atlas-custom', name: '未归卷', description: '暂时不属于其他分卷的零散资料', defaultType: 'custom' },
] as const;

export type NovelLoreCollectionTemplateId = 'wuxia' | 'cultivation';

export const NOVEL_LORE_COLLECTION_TEMPLATES: Record<
  NovelLoreCollectionTemplateId,
  { name: string; description: string; collections: readonly Omit<NovelLoreCollection, 'id'>[] }
> = {
  wuxia: {
    name: '江湖武侠',
    description: '门派、武学与神兵各自成卷',
    collections: [
      { name: '江湖地理', description: '城镇、关隘、山川与险地', defaultType: 'location' },
      { name: '门派世家', description: '门派传承、家族与江湖阵营', defaultType: 'faction' },
      { name: '武学秘典', description: '功法、招式、心诀与传承限制', defaultType: 'lore' },
      { name: '神兵谱', description: '名剑、奇兵、暗器与其流转经历', defaultType: 'item' },
    ],
  },
  cultivation: {
    name: '修真仙途',
    description: '宗门、功法、法宝与灵材分卷归档',
    collections: [
      { name: '洞天福地', description: '界域、秘境、灵脉与禁地', defaultType: 'location' },
      { name: '宗门世家', description: '宗门、仙朝、世家与敌对阵营', defaultType: 'faction' },
      { name: '功法神通', description: '修炼体系、功法、术法与代价', defaultType: 'lore' },
      { name: '法宝神器', description: '法器、灵宝、神器与认主规则', defaultType: 'item' },
      { name: '丹药灵材', description: '丹药、灵植、矿材与炼制用途', defaultType: 'item' },
    ],
  },
};

export function getSystemLoreCollectionId(type: NovelLoreTypeId): string {
  return SYSTEM_NOVEL_LORE_COLLECTIONS.find((collection) => collection.defaultType === type)?.id
    ?? 'atlas-custom';
}

/** Maximum number of AI draft entries requested in one review session. */
export const MAX_NOVEL_LORE_BATCH_TOTAL = 20;

/** Keep each model response small enough to validate and retry reliably. */
export const MAX_NOVEL_LORE_BATCH_CHUNK = 5;

/** Hard cap for injected lore content length. */
export const MAX_NOVEL_LORE_CONTENT_LENGTH = 200;

export function isNovelLoreTypeId(value: unknown): value is NovelLoreTypeId {
  return typeof value === 'string' && (NOVEL_LORE_TYPES as readonly string[]).includes(value);
}
