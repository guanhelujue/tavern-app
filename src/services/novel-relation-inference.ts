import { tryParseAiJson } from '@/utils/ai-json';
import { normalizeRelationGraphLabel } from '@/constants/novel-relation-graphs';
import { requestCompletionWithUsage } from '@/services/llm';
import type { ApiSettings, Novel, NovelCastCharacter, NovelCastRelation } from '@/types/tavern';
import { createCastRelationId, normalizeCastRelations } from '@/utils/novel-relations';

/** Keeps one relation-inference request within a predictable context budget. */
const MAX_RELATION_INFERENCE_CAST = 50;

/** One canonical relationship pair with a shared label and viewpoint-specific descriptions. */
export type NovelRelationInferenceEdge = {
  fromCharacterId: string;
  toCharacterId: string;
  label: string;
  /** Description from the `fromCharacterId` character's viewpoint. */
  fromNote?: string;
  /** Description from the `toCharacterId` character's viewpoint. */
  toNote?: string;
  /** Legacy model field. It is used as the fallback for both viewpoints. */
  note?: string;
};

export type NovelRelationInferenceReport = {
  castCount: number;
  inferredPairCount: number;
  totalPairCount: number;
  addedPairCount: number;
  updatedPairCount: number;
  preservedManualPairCount: number;
};

export type NovelRelationInferenceResult = {
  relations: NovelRelationInferenceEdge[];
  tokens: number;
  model?: string;
};

type RelationCast = Pick<
  NovelCastCharacter,
  | 'id'
  | 'name'
  | 'gender'
  | 'profession'
  | 'affiliation'
  | 'personality'
  | 'background'
  | 'relations'
>;

const RELATION_INFERENCE_SYSTEM_PROMPT = `你是小说角色关系整理器。你的任务是读取整部小说当前角色库中的所有角色卡与已有关系，推理一张一致、可执行的人物关系表。

只输出严格 JSON，不要 Markdown、解释或思考过程：
{
  "relations": [
    {
      "fromCharacterId": "角色A的ID",
      "toCharacterId": "角色B的ID",
      "label": "简短、双方共用的关系标签",
      "fromNote": "从角色A视角描述这段关系的依据或现状",
      "toNote": "从角色B视角描述这段关系的依据或现状"
    }
  ]
}

规则：
1. 只能使用输入角色库中的 ID，不能创造角色、别名或场外人物；不能输出自己指向自己的关系。
2. 每一对人物最多输出一次。关系标签是双方共用的规范化标签，A→B 与 B→A 的 label 必须完全相同；但 fromNote 与 toNote 必须分别站在两个人自己的视角描述，可以不同，不能为了对称而强行复制。不要用“父亲/儿子”“师父/弟子”这类不同视角标签，统一写成“亲子”“师生”等双方共用标签。
3. 如果设定明确表示多人共享同一宿舍、班级、团队、组织、家庭或其他群体关系，必须做关系闭包：群体内每一对角色都要输出对应关系。例如四人同住一间大学宿舍，必须输出 6 对“室友”，不能只写主角与一个室友。
4. 现有关系是证据，不是必须照抄的两份答案：若两侧标签冲突，结合角色卡、世界设定和明确事实选出一个最有依据的共同标签；双方说明仍按各自视角保留，不要求文字一致。
5. 没有充分事实支撑的关系不要臆造；但共享群体关系属于明确事实时要补全所有成员之间的关系。关系标签优先使用“室友、同学、朋友、恋人、亲子、兄弟姐妹、师生、同事、上下级、战友、同盟、宿敌、熟人”等简短中文词。
6. 既有关系中目标是场外人物的记录不属于本次关系表，不要为了凑数量输出场外人物。`;

function text(value: unknown, max = 280): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function extractJsonObject(value: string): unknown {
  return tryParseAiJson(value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('\u0000');
}

function resolveCastId(
  value: unknown,
  byId: Map<string, RelationCast>,
  byName: Map<string, string>,
): string | null {
  const raw = text(value, 120);
  if (!raw) return null;
  if (byId.has(raw)) return raw;
  return byName.get(raw.toLowerCase()) ?? null;
}

function buildCastPayload(cast: RelationCast[]) {
  return cast.slice(0, MAX_RELATION_INFERENCE_CAST).map((character) => ({
    id: character.id,
    name: text(character.name, 100),
    gender: text(character.gender, 40),
    profession: text(character.profession, 120),
    affiliation: text(character.affiliation, 160),
    personality: text(character.personality, 280),
    background: text(character.background, 420),
    existingRelations: (normalizeCastRelations(character.relations) ?? []).map((relation) => ({
      targetCharacterId: text(relation.targetCastId, 120),
      targetName: text(relation.targetName, 100),
      label: text(relation.label, 80),
      note: text(relation.note, 220),
      source: relation.source ?? 'legacy',
    })),
  }));
}

function parseRelations(raw: unknown, cast: RelationCast[]): NovelRelationInferenceEdge[] {
  if (!isRecord(raw)) {
    throw new Error('关系整理模型返回的不是 JSON 对象。');
  }
  const rows = Array.isArray(raw.relations)
    ? raw.relations
    : Array.isArray(raw.relationships)
      ? raw.relationships
      : null;
  if (!rows) {
    throw new Error('关系整理模型返回缺少 relations 数组。');
  }
  const byId = new Map(cast.map((character) => [character.id, character]));
  const byName = new Map(
    cast
      .filter((character) => character.name.trim())
      .map((character) => [character.name.trim().toLowerCase(), character.id]),
  );
  const byPair = new Map<string, NovelRelationInferenceEdge>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const fromCharacterId = resolveCastId(
      row.fromCharacterId ?? row.fromId ?? row.from,
      byId,
      byName,
    );
    const toCharacterId = resolveCastId(
      row.toCharacterId ?? row.toId ?? row.to,
      byId,
      byName,
    );
    if (!fromCharacterId || !toCharacterId || fromCharacterId === toCharacterId) continue;
    const label = normalizeRelationGraphLabel(text(row.label ?? row.relation, 80));
    const legacyNote = text(row.note, 280);
    const fromNote = text(row.fromNote ?? row.fromDescription, 280) || legacyNote;
    const toNote = text(row.toNote ?? row.toDescription, 280) || legacyNote;
    const next: NovelRelationInferenceEdge = {
      fromCharacterId,
      toCharacterId,
      label,
      ...(fromNote ? { fromNote } : {}),
      ...(toNote ? { toNote } : {}),
    };
    const key = pairKey(fromCharacterId, toCharacterId);
    const previous = byPair.get(key);
    if (!previous) {
      byPair.set(key, next);
      continue;
    }

    // Models occasionally emit both orientations. Keep one canonical pair,
    // but merge each description into the matching character's viewpoint.
    const reversed =
      previous.fromCharacterId === next.toCharacterId &&
      previous.toCharacterId === next.fromCharacterId;
    const incomingFromNote = reversed ? next.toNote : next.fromNote;
    const incomingToNote = reversed ? next.fromNote : next.toNote;
    byPair.set(key, {
      ...previous,
      ...(previous.fromNote || !incomingFromNote ? {} : { fromNote: incomingFromNote }),
      ...(previous.toNote || !incomingToNote ? {} : { toNote: incomingToNote }),
    });
  }
  return [...byPair.values()];
}

export async function inferNovelCastRelations({
  apiSettings,
  novel,
  signal,
}: {
  apiSettings: ApiSettings;
  novel: Pick<
    Novel,
    | 'name'
    | 'worldName'
    | 'worldEra'
    | 'worldConflict'
    | 'worldTone'
    | 'mainPlot'
    | 'shortIntro'
    | 'detailedIntro'
    | 'foundationPrompt'
    | 'initialStoryState'
    | 'gameRules'
    | 'cast'
  >;
  signal?: AbortSignal;
}): Promise<NovelRelationInferenceResult> {
  const cast = (novel.cast ?? [])
    .filter((character) => character.name.trim())
    .slice(0, MAX_RELATION_INFERENCE_CAST);
  if (cast.length < 2) {
    return { relations: [], tokens: 0 };
  }

  const payload = {
    novel: {
      name: text(novel.name, 160),
      worldName: text(novel.worldName, 180),
      worldEra: text(novel.worldEra, 500),
      worldConflict: text(novel.worldConflict, 700),
      worldTone: text(novel.worldTone, 300),
      mainPlot: text(novel.mainPlot, 900),
      shortIntro: text(novel.shortIntro, 700),
      detailedIntro: text(novel.detailedIntro, 1600),
      foundationPrompt: text(novel.foundationPrompt, 1600),
      initialStoryState: text(novel.initialStoryState, 1000),
      gameRules: text(novel.gameRules, 900),
    },
    cast: buildCastPayload(cast),
  };
  const result = await requestCompletionWithUsage({ responseFormat: 'json',
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
    },
    messages: [
      { role: 'system', content: RELATION_INFERENCE_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    purpose: 'character-relations',
    maxTokens: 1800,
    temperature: 0.15,
    signal,
  });
  const relations = parseRelations(extractJsonObject(result.content), cast);
  return {
    relations,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
    model: result.model,
  };
}

type PairRecord = {
  fromCharacterId: string;
  toCharacterId: string;
  label: string;
  notesByCharacter: Record<string, string>;
  trusted: boolean;
  source: 'manual' | 'ai';
};

function relationNotesByCharacter(
  relation: Pick<NovelRelationInferenceEdge, 'fromCharacterId' | 'toCharacterId' | 'fromNote' | 'toNote' | 'note'>,
): Record<string, string> {
  const legacyNote = text(relation.note, 280);
  const fromNote = text(relation.fromNote, 280) || legacyNote;
  const toNote = text(relation.toNote, 280) || legacyNote;
  return {
    ...(fromNote ? { [relation.fromCharacterId]: fromNote } : {}),
    ...(toNote ? { [relation.toCharacterId]: toNote } : {}),
  };
}

function mergePairNotes(
  base: Record<string, string>,
  incoming: Record<string, string>,
  incomingWins: boolean,
): Record<string, string> {
  return incomingWins ? { ...base, ...incoming } : { ...incoming, ...base };
}

function relationTargetId(
  relation: NovelCastRelation,
  byId: Map<string, RelationCast>,
  byName: Map<string, string>,
): string | null {
  return (
    resolveCastId(relation.targetCastId, byId, byName) ??
    resolveCastId(relation.targetName, byId, byName)
  );
}

/** Apply canonical pair edges while preserving off-cast relationships and manual evidence. */
export function applyNovelRelationInference(
  cast: NovelCastCharacter[],
  inferredRelations: NovelRelationInferenceEdge[],
): { cast: NovelCastCharacter[]; report: NovelRelationInferenceReport } {
  const namedCast = cast.filter((character) => character.name.trim());
  const byId = new Map(namedCast.map((character) => [character.id, character]));
  const byName = new Map(
    namedCast.map((character) => [character.name.trim().toLowerCase(), character.id]),
  );
  const existingPairs = new Map<string, PairRecord>();
  const existingPairLabels = new Map<string, string>();

  for (const character of namedCast) {
    for (const relation of normalizeCastRelations(character.relations) ?? []) {
      const targetId = relationTargetId(relation, byId, byName);
      if (!targetId || targetId === character.id) continue;
      const key = pairKey(character.id, targetId);
      const candidate: PairRecord = {
        fromCharacterId: character.id,
        toCharacterId: targetId,
        label: normalizeRelationGraphLabel(relation.label),
        notesByCharacter: relationNotesByCharacter({
          fromCharacterId: character.id,
          toCharacterId: targetId,
          note: relation.note,
        }),
        trusted: relation.source !== 'ai',
        source: relation.source === 'manual' || relation.source !== 'ai' ? 'manual' : 'ai',
      };
      const previous = existingPairs.get(key);
      if (!previous) {
        existingPairs.set(key, candidate);
      } else if (candidate.trusted && !previous.trusted) {
        existingPairs.set(key, {
          ...candidate,
          notesByCharacter: mergePairNotes(
            previous.notesByCharacter,
            candidate.notesByCharacter,
            true,
          ),
        });
      } else {
        existingPairs.set(key, {
          ...previous,
          notesByCharacter: mergePairNotes(
            previous.notesByCharacter,
            candidate.notesByCharacter,
            false,
          ),
        });
      }
      if (!existingPairLabels.has(key)) {
        existingPairLabels.set(key, candidate.label);
      }
    }
  }

  const pairRecords = new Map(existingPairs);
  const inferredKeys = new Set<string>();
  for (const relation of inferredRelations) {
    if (!byId.has(relation.fromCharacterId) || !byId.has(relation.toCharacterId)) continue;
    if (relation.fromCharacterId === relation.toCharacterId) continue;
    const key = pairKey(relation.fromCharacterId, relation.toCharacterId);
    inferredKeys.add(key);
    const previous = pairRecords.get(key);
    const inferredNotes = relationNotesByCharacter(relation);
    if (previous?.trusted) {
      // Manual labels/notes win, but an inferred note may still fill the
      // opposite direction when only one side was documented manually.
      pairRecords.set(key, {
        ...previous,
        notesByCharacter: mergePairNotes(previous.notesByCharacter, inferredNotes, false),
      });
      continue;
    }
    if (!previous || !previous.trusted) {
      pairRecords.set(key, {
        ...relation,
        label: normalizeRelationGraphLabel(relation.label),
        notesByCharacter: mergePairNotes(
          previous?.notesByCharacter ?? {},
          inferredNotes,
          true,
        ),
        trusted: false,
        source: 'ai',
      });
    }
  }

  const nextCast = cast.map((character) => {
    if (!character.name.trim()) {
      return character;
    }
    const offCastRelations = (normalizeCastRelations(character.relations) ?? []).filter(
      (relation) => !relationTargetId(relation, byId, byName),
    );
    const pairRelations = [...pairRecords.values()]
      .filter(
        (pair) => pair.fromCharacterId === character.id || pair.toCharacterId === character.id,
      )
      .map((pair) => {
        const targetId = pair.fromCharacterId === character.id ? pair.toCharacterId : pair.fromCharacterId;
        const target = byId.get(targetId);
        return {
          id: createCastRelationId(),
          targetName: target?.name ?? '',
          targetCastId: targetId,
          label: pair.label,
          ...(pair.notesByCharacter[character.id]
            ? { note: pair.notesByCharacter[character.id] }
            : {}),
          source: pair.source,
          updatedAt: Date.now(),
        } satisfies NovelCastRelation;
      });
    return {
      ...character,
      relations: [...offCastRelations, ...pairRelations],
    };
  });

  const totalPairCount = pairRecords.size;
  const addedPairCount = [...inferredKeys].filter((key) => !existingPairs.has(key)).length;
  const updatedPairCount = [...inferredKeys].filter((key) => {
    const pair = pairRecords.get(key);
    return Boolean(pair && existingPairs.has(key) && existingPairLabels.get(key) !== pair.label);
  }).length;
  const preservedManualPairCount = [...pairRecords.values()].filter((pair) => pair.trusted).length;
  return {
    cast: nextCast,
    report: {
      castCount: namedCast.length,
      inferredPairCount: inferredKeys.size,
      totalPairCount,
      addedPairCount,
      updatedPairCount,
      preservedManualPairCount,
    },
  };
}
