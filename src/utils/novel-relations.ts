/**
 * Cast key-relationship helpers.
 *
 * Line format (dossier textarea / injection):
 *   对方名｜关系｜说明
 *
 * targetName may be an off-cast invented person (室友陈砚、父亲xxx) —
 * targetCastId is optional and only set when linked to an existing cast card.
 *
 * Future: scene-end / memory compression may call `upsertCastRelation`
 * when a relationship leap is detected (source: 'ai').
 */

import type { NovelCastCharacter, NovelCastRelation } from '@/types/tavern';
import { generateId, namesMatch } from '@/utils/helpers';

const RELATION_SEP = /[｜|]/;

export const createCastRelationId = () => generateId('rel');

/** Drop relationship rows that target a deleted character. */
export function stripCastRelationsToSubject(
  cast: NovelCastCharacter[],
  subject: { id?: string | null; name?: string | null },
): NovelCastCharacter[] {
  const subjectId = subject.id?.trim() || '';
  const subjectName = subject.name?.trim().toLowerCase() || '';
  if (!subjectId && !subjectName) return cast;

  return cast.map((character) => {
    if (!character.relations?.length) return character;
    const relations = character.relations.filter((relation) => {
      if (subjectId && relation.targetCastId?.trim() === subjectId) return false;
      return !subjectName || relation.targetName.trim().toLowerCase() !== subjectName;
    });
    return relations.length === character.relations.length
      ? character
      : { ...character, relations: relations.length ? relations : undefined };
  });
}

export function normalizeCastRelation(
  item: Partial<NovelCastRelation> | null | undefined,
  index = 0,
): NovelCastRelation | null {
  const targetName =
    typeof item?.targetName === 'string' ? item.targetName.trim() : '';
  const label = typeof item?.label === 'string' ? item.label.trim() : '';
  if (!targetName && !label) {
    return null;
  }

  const note = typeof item?.note === 'string' ? item.note.trim() : '';
  const targetCastId =
    typeof item?.targetCastId === 'string' && item.targetCastId.trim()
      ? item.targetCastId.trim()
      : undefined;
  const source = item?.source === 'ai' || item?.source === 'manual' ? item.source : undefined;
  const updatedAt =
    typeof item?.updatedAt === 'number' && Number.isFinite(item.updatedAt)
      ? item.updatedAt
      : undefined;

  return {
    id:
      typeof item?.id === 'string' && item.id.trim()
        ? item.id.trim()
        : `rel-${index}-${createCastRelationId()}`,
    targetName,
    label,
    ...(note ? { note } : {}),
    ...(targetCastId ? { targetCastId } : {}),
    ...(source ? { source } : {}),
    ...(updatedAt != null ? { updatedAt } : {}),
  };
}

export function normalizeCastRelations(
  value: unknown,
): NovelCastRelation[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const next = value
    .map((item, index) =>
      normalizeCastRelation(item as Partial<NovelCastRelation>, index),
    )
    .filter((item): item is NovelCastRelation => Boolean(item));

  return next.length ? next : undefined;
}

/** Serialize relations for dossier fields / prompt lines (no leading bullets). */
export function formatCastRelationsText(
  relations: NovelCastRelation[] | null | undefined,
): string {
  if (!relations?.length) {
    return '';
  }

  return relations
    .map((item) => {
      const parts = [item.targetName.trim(), item.label.trim()];
      const note = item.note?.trim();
      if (note) {
        parts.push(note);
      }
      return parts.filter(Boolean).join('｜');
    })
    .filter(Boolean)
    .join('\n');
}

/** Prompt block: `关键关系：\n- A｜B｜C` */
export function formatCastRelationsForInject(
  relations: NovelCastRelation[] | null | undefined,
): string {
  const body = formatCastRelationsText(relations);
  if (!body) {
    return '';
  }

  return [
    '关键关系：',
    ...body.split('\n').map((line) => `- ${line}`),
  ].join('\n');
}

/**
 * Parse dossier textarea lines into structured relations.
 * Keeps existing ids / targetCastId / source when the target name still matches.
 */
export function parseCastRelationsText(
  text: string,
  previous?: NovelCastRelation[] | null,
): NovelCastRelation[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•·]\s*/, '').trim())
    .filter(Boolean);

  const prevByName = new Map(
    (previous ?? [])
      .filter((item) => item.targetName.trim())
      .map((item) => [item.targetName.trim().toLowerCase(), item] as const),
  );

  const next: NovelCastRelation[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const parts = raw.split(RELATION_SEP).map((part) => part.trim());
    const targetName = parts[0] ?? '';
    const label = parts[1] ?? '';
    const note = parts.slice(2).join('｜').trim();
    if (!targetName && !label) {
      continue;
    }

    const prev = prevByName.get(targetName.toLowerCase());
    const normalized = normalizeCastRelation(
      {
        id: prev?.id,
        targetName,
        label: label || '关系',
        note: note || undefined,
        targetCastId: prev?.targetCastId,
        source: prev?.source ?? 'manual',
        updatedAt: Date.now(),
      },
      index,
    );
    if (normalized) {
      next.push(normalized);
    }
  }

  return next;
}

/**
 * Upsert one relation by targetCastId (preferred) or targetName.
 * Intended for future scene-end / memory-leap AI writes (source: 'ai').
 */
export function upsertCastRelation(
  relations: NovelCastRelation[] | null | undefined,
  incoming: Partial<NovelCastRelation> &
    Pick<NovelCastRelation, 'targetName' | 'label'>,
): NovelCastRelation[] {
  const current = normalizeCastRelations(relations) ?? [];
  const targetName = incoming.targetName.trim();
  const targetCastId = incoming.targetCastId?.trim() || '';
  const label = incoming.label.trim();
  if (!targetName && !targetCastId) {
    return current;
  }

  const matchIndex = current.findIndex((item) => {
    if (targetCastId && item.targetCastId && item.targetCastId === targetCastId) {
      return true;
    }
    return (
      targetName &&
      item.targetName.trim().toLowerCase() === targetName.toLowerCase()
    );
  });

  const base =
    matchIndex >= 0
      ? current[matchIndex]
      : ({
          id: createCastRelationId(),
          targetName,
          label,
        } satisfies NovelCastRelation);

  const nextItem = normalizeCastRelation({
    ...base,
    targetName: targetName || base.targetName,
    label: label || base.label,
    note:
      typeof incoming.note === 'string'
        ? incoming.note.trim()
        : base.note,
    targetCastId: targetCastId || base.targetCastId,
    source: incoming.source ?? 'ai',
    updatedAt: Date.now(),
  });

  if (!nextItem) {
    return current;
  }

  if (matchIndex >= 0) {
    const copy = [...current];
    copy[matchIndex] = nextItem;
    return copy;
  }

  return [...current, nextItem];
}

/** Parse a `关键关系：` block from dossier content text. */
export function parseRelationsBlockFromContent(content: string): NovelCastRelation[] {
  const match = content.match(
    /关键关系\s*[：:]\s*\n([\s\S]*?)(?=\n[^\s\-•*·].*[：:]|\n*$)/u,
  );
  if (!match?.[1]) {
    return [];
  }
  return parseCastRelationsText(match[1]);
}

/** Resolve targetCastId from novel cast names when possible. */
export function linkRelationTargetsToCast<
  T extends { id: string; name: string },
>(
  relations: NovelCastRelation[] | null | undefined,
  cast: T[] | null | undefined,
): NovelCastRelation[] | undefined {
  const list = normalizeCastRelations(relations);
  if (!list?.length) {
    return list;
  }

  if (!cast?.length) {
    return list;
  }

  const byName = new Map(
    cast
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim().toLowerCase(), item.id] as const),
  );

  return list.map((item) => {
    if (item.targetCastId) {
      return item;
    }
    const id = byName.get(item.targetName.trim().toLowerCase());
    return id ? { ...item, targetCastId: id } : item;
  });
}

function resolveGenderKind(gender?: string | null): 'male' | 'female' | null {
  const raw = gender?.trim() ?? '';
  if (!raw) {
    return null;
  }
  if (/女|雌|娘|姐|妹|母|妻|妃|她|♀|female|woman|girl|lady/i.test(raw)) {
    return 'female';
  }
  if (/男|雄|兄|弟|父|夫|公|他|♂|male|man|boy|guy/i.test(raw)) {
    return 'male';
  }
  return null;
}

/**
 * Invert A→B label into B→A for locked reciprocal seeding.
 * Symmetric labels stay as-is; kinship flips by the source character's gender.
 */
export function invertCastRelationLabel(
  label: string,
  fromCharacter: { gender?: string | null },
): string {
  const raw = label.trim();
  if (!raw) {
    return '关系';
  }

  if (/合租|室友/.test(raw)) {
    return /合租/.test(raw) ? '合租室友' : '室友';
  }
  if (/恋人|情侣|对象|男友|女友|配偶|夫妻|丈夫|妻子/.test(raw)) {
    return '恋人';
  }
  if (/青梅竹马/.test(raw)) {
    return '青梅竹马';
  }
  if (/宿敌|死对头|仇敌/.test(raw)) {
    return '宿敌';
  }
  if (/朋友|挚友|好友|发小/.test(raw)) {
    return raw.includes('挚') ? '挚友' : '朋友';
  }
  if (/同事|同学|同门|战友/.test(raw)) {
    return raw;
  }
  if (/炮友|性伴侣/.test(raw)) {
    return raw.includes('炮') ? '炮友' : '性伴侣';
  }
  if (/师父|师傅|导师|老师/.test(raw)) {
    return '弟子';
  }
  if (/弟子|徒弟|学生|门生/.test(raw)) {
    return '师父';
  }

  const gender = resolveGenderKind(fromCharacter.gender);
  if (/父亲|爸爸|爹|父/.test(raw)) {
    return gender === 'female' ? '女儿' : gender === 'male' ? '儿子' : '子女';
  }
  if (/母亲|妈妈|娘|母/.test(raw)) {
    return gender === 'female' ? '女儿' : gender === 'male' ? '儿子' : '子女';
  }
  if (/儿子|女儿|孩子|子女|小孩/.test(raw)) {
    return gender === 'female' ? '母亲' : gender === 'male' ? '父亲' : '父母';
  }
  if (/哥哥|兄/.test(raw)) {
    return gender === 'female' ? '妹妹' : gender === 'male' ? '弟弟' : '弟妹';
  }
  if (/弟弟|弟/.test(raw) && !/徒弟|弟子/.test(raw)) {
    return gender === 'female' ? '姐姐' : gender === 'male' ? '哥哥' : '兄姐';
  }
  if (/姐姐|姐/.test(raw)) {
    return gender === 'female' ? '妹妹' : gender === 'male' ? '弟弟' : '弟妹';
  }
  if (/妹妹|妹/.test(raw)) {
    return gender === 'female' ? '姐姐' : gender === 'male' ? '哥哥' : '兄姐';
  }

  // Unknown / asymmetric custom labels: keep wording so the bond stays recognizable.
  return raw;
}

/**
 * Find relations on other cast cards that already point at `subject`
 * (by targetCastId or targetName). Used to lock reciprocal bonds when generating.
 */
export function collectIncomingCastRelations(
  existingCast: NovelCastCharacterLike[] | null | undefined,
  subject: { id?: string | null; name?: string | null },
): {
  from: NovelCastCharacterLike;
  relation: NovelCastRelation;
}[] {
  const subjectId = subject.id?.trim() || '';
  const subjectName = subject.name?.trim() || '';
  if (!subjectId && !subjectName) {
    return [];
  }

  const hits: { from: NovelCastCharacterLike; relation: NovelCastRelation }[] = [];
  for (const from of existingCast ?? []) {
    if (!from?.name?.trim()) {
      continue;
    }
    if (subjectId && from.id === subjectId) {
      continue;
    }
    for (const relation of from.relations ?? []) {
      const byId =
        Boolean(subjectId) &&
        Boolean(relation.targetCastId?.trim()) &&
        relation.targetCastId?.trim() === subjectId;
      const byName =
        Boolean(subjectName) && namesMatch(relation.targetName, subjectName);
      if (!byId && !byName) {
        continue;
      }
      hits.push({ from, relation });
    }
  }
  return hits;
}

type NovelCastCharacterLike = {
  id: string;
  name: string;
  gender?: string;
  relations?: NovelCastRelation[] | null;
};

/**
 * Build locked reciprocal relations the generated character must keep
 * (e.g. 秦枳→周昊「室友」 ⇒ 周昊 must have 秦枳「室友」).
 */
export function buildLockedReciprocalRelations(
  existingCast: NovelCastCharacterLike[] | null | undefined,
  subject: { id?: string | null; name?: string | null },
): NovelCastRelation[] {
  const incoming = collectIncomingCastRelations(existingCast, subject);
  if (!incoming.length) {
    return [];
  }

  const locked: NovelCastRelation[] = [];
  for (const { from, relation } of incoming) {
    const label = invertCastRelationLabel(relation.label, from);
    const fromNote = relation.note?.trim();
    const note = fromNote
      ? `与「${from.name.trim()}」相互锁定；对方记载：${fromNote}`
      : `与「${from.name.trim()}」相互锁定（对方卡：${relation.label.trim()}）`;
    locked.push({
      id: createCastRelationId(),
      targetName: from.name.trim(),
      targetCastId: from.id,
      label,
      note,
      source: 'manual',
      updatedAt: Date.now(),
    });
  }
  return locked;
}

/** Upsert locked relations on top of AI/user relations; locked wins on conflict. */
export function mergeRelationsWithLocked(
  base: NovelCastRelation[] | null | undefined,
  locked: NovelCastRelation[] | null | undefined,
): NovelCastRelation[] | undefined {
  let next = normalizeCastRelations(base) ?? [];
  for (const item of locked ?? []) {
    next = upsertCastRelation(next, {
      ...item,
      source: item.source ?? 'manual',
    });
  }
  return next.length ? next : undefined;
}

/** Compact prompt block for locked reciprocal relations. */
export function formatLockedRelationsForPrompt(
  locked: NovelCastRelation[] | null | undefined,
): string {
  if (!locked?.length) {
    return '';
  }
  return [
    '【已锁定关联关系（不可删除 / 不可改写 label / 不可写矛盾关系）】',
    ...locked.map(
      (item) =>
        `- ${item.targetName}｜${item.label}${item.note?.trim() ? `｜${item.note.trim()}` : ''}`,
    ),
    '上述条目来自其他角色卡的既有记载，必须原样保留；除此之外请补建此人自己的人际（未入库姓名），勿只再挂更多已有角色。',
  ].join('\n');
}
