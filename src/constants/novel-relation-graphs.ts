/** Soft cap for relation graphs per novel (demo; includes region/faction). */
export const DEFAULT_MAX_RELATION_GRAPHS = 16;
export const MAX_RELATION_GRAPH_HARD_LIMIT = 24;
export const MAX_RELATION_GRAPH_NODES = 48;
export const MAX_RELATION_GRAPH_EDGES = 120;

/**
 * Symmetric short labels for graph edges (A—B share the same word).
 * Prefer these over unidirectional titles like 父亲 / 债主.
 */
export const CANONICAL_RELATION_LABELS = [
  '室友',
  '邻居',
  '朋友',
  '挚友',
  '旧识',
  '青梅竹马',
  '恋人',
  '配偶',
  '炮友',
  '性伴侣',
  '情敌',
  '父子',
  '母子',
  '父女',
  '母女',
  '兄弟',
  '姐妹',
  '兄妹',
  '姐弟',
  '祖孙',
  '亲戚',
  '同学',
  '同门',
  '师生',
  '同事',
  '上下级',
  '战友',
  '合伙人',
  '同盟',
  '宿敌',
  '债务',
  '竞争',
  '熟人',
  '客户',
  '交易',
  '临时搭档',
] as const;

export type CanonicalRelationLabel = (typeof CANONICAL_RELATION_LABELS)[number];


/** Map common unidirectional / alias wording → canonical short label. */
const LABEL_ALIASES: Record<string, string> = {
  合租: '室友',
  合租室友: '室友',
  同屋: '室友',
  好友: '朋友',
  发小: '朋友',
  情侣: '恋人',
  对象: '恋人',
  男友: '恋人',
  女友: '恋人',
  夫妻: '配偶',
  丈夫: '配偶',
  妻子: '配偶',
  青梅: '青梅竹马',
  死对头: '宿敌',
  仇敌: '宿敌',
  父亲: '父子',
  爸爸: '父子',
  爹: '父子',
  母亲: '母子',
  妈妈: '母子',
  娘: '母子',
  儿子: '父子',
  女儿: '父女',
  哥哥: '兄弟',
  弟弟: '兄弟',
  姐姐: '姐妹',
  妹妹: '姐妹',
  师父: '师生',
  师傅: '师生',
  导师: '师生',
  老师: '师生',
  弟子: '师生',
  徒弟: '师生',
  学生: '师生',
  门生: '师生',
  上司: '上下级',
  上级: '上下级',
  老板: '上下级',
  下属: '上下级',
  下级: '上下级',
  部下: '上下级',
  债主: '债务',
  债务人: '债务',
  前同事: '同事',
};

export function normalizeRelationGraphLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '熟人';
  }
  if ((CANONICAL_RELATION_LABELS as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  const aliased = LABEL_ALIASES[trimmed];
  if (aliased) {
    return aliased;
  }
  // Soft match: contain known keywords
  for (const [key, value] of Object.entries(LABEL_ALIASES)) {
    if (trimmed.includes(key)) {
      return value;
    }
  }
  return trimmed.slice(0, 12);
}
