import { EMPTY_STYLE_PROFILE } from '@/constants/novel-story-state';
import type {
  ISODateString,
  NovelCharacterRelationship,
  NovelCharacterState,
  NovelChapterSummaryRow,
  NovelHook,
  NovelHookStatus,
  NovelPlotThread,
  NovelStoryAnalysis,
  NovelStoryCharacter,
  NovelTimelineEvent,
  NovelWorldFact,
} from '@/types/tavern';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`校验失败：字段 ${field} 应为字符串`);
  }
  return value;
}

/**
 * 标识符（id / 引用）字段容错：LLM 常把 id 写成数字，统一归一为字符串。
 * 字符串原样返回，有限数字转字符串，其他类型（对象/数组/布尔）仍拒绝。
 */
function coerceId(value: unknown, field: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error(`校验失败：字段 ${field} 应为字符串或数字`);
}

/** 标识符引用数组：同样容错数字元素。 */
function requireIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`校验失败：字段 ${field} 应为字符串数组`);
  }
  return value.map((item) => coerceId(item, field));
}

function requireOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`校验失败：字段 ${field} 应为数字`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`校验失败：字段 ${field} 应为字符串数组`);
  }
  return value as string[];
}

type EnumEntry<T extends string> = {
  value: T;
  aliases?: readonly string[];
};

/**
 * 枚举归一化：LLM 常输出同义变体或中文词，未知值回退到 fallback，
 * 避免整批分析因一个标签被拒。非字符串（数字/对象/数组）仍拒绝。
 */
function normalizeEnum<T extends string>(
  value: unknown,
  entries: readonly EnumEntry<T>[],
  fallback: T,
  field: string,
): T {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`校验失败：字段 ${field} 必须为字符串`);
  }
  const normalized = value.trim().toLowerCase();
  for (const entry of entries) {
    if (entry.value === normalized || entry.aliases?.includes(normalized)) {
      return entry.value;
    }
  }
  return fallback;
}

const TIMELINE_TYPE_ENTRIES: readonly EnumEntry<NovelTimelineEvent['type']>[] = [
  { value: 'timeline', aliases: ['event', 'events', 'scene', 'general', '事件', '剧情', '记录'] },
  { value: 'location', aliases: ['place', 'places', '地点', '场所', '场景', '位置'] },
  { value: 'faction', aliases: ['camp', 'group', 'organization', '势力', '组织', '阵营', '集团'] },
  { value: 'item', aliases: ['object', 'objects', '物品', '道具', '宝物', '物件'] },
  { value: 'resource', aliases: ['resources', '物资', '材料', '货币', '资源'] },
];

const PLOT_KIND_ENTRIES: readonly EnumEntry<NovelPlotThread['kind']>[] = [
  { value: 'main', aliases: ['主线', '主', 'mainline'] },
  { value: 'sub', aliases: ['支线', '副线', '支', 'side', 'subplot'] },
  { value: 'arc', aliases: ['情感弧', '弧光', '篇章', 'arcs'] },
];

const HOOK_STATUS_ENTRIES: readonly EnumEntry<NovelHookStatus>[] = [
  { value: 'open', aliases: ['opened', 'active', '开启', '打开', '未回收', '未解决'] },
  { value: 'progressing', aliases: ['progress', 'in-progress', 'in progress', '推进中', '进行中'] },
  { value: 'deferred', aliases: ['defer', '搁置', '延后', '延期'] },
  { value: 'resolved', aliases: ['resolve', 'done', 'closed', '完结', '已回收', '已解决', '关闭'] },
];

const HOOK_IMPORTANCE_ENTRIES: readonly EnumEntry<NovelHook['importance']>[] = [
  { value: 'minor', aliases: ['小', '低', '普通', 'small', 'low'] },
  { value: 'major', aliases: ['中', '重要', 'medium'] },
  { value: 'core', aliases: ['大', '核心', '关键', '高', 'high', 'critical'] },
];

function parseHookStatus(value: unknown): NovelHookStatus {
  return normalizeEnum(value, HOOK_STATUS_ENTRIES, 'open', 'hook.status');
}

/** 单章摘要行解析。 */
function parseSummaryRow(value: unknown, chapter: number): NovelChapterSummaryRow {
  if (!isPlainObject(value)) {
    throw new Error(`校验失败：第 ${chapter} 章摘要行必须是对象`);
  }
  return {
    chapter: requireNumber(value.chapter, 'summary.chapter'),
    title: requireString(value.title, 'summary.title'),
    events: requireOptionalString(value.events),
    stateChanges: requireOptionalString(value.stateChanges),
    hookActivity: requireOptionalString(value.hookActivity),
    mood: requireOptionalString(value.mood),
  };
}

function parseWorldFact(value: unknown): NovelWorldFact {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：worldFact 必须是对象');
  }
  return {
    id: coerceId(value.id, 'worldFact.id'),
    subject: requireString(value.subject, 'worldFact.subject'),
    content: requireString(value.content, 'worldFact.content'),
    canon: value.canon === true,
    sourceChapter: requireNumber(value.sourceChapter, 'worldFact.sourceChapter'),
    validFromChapter: requireNumber(value.validFromChapter, 'worldFact.validFromChapter'),
    ...(typeof value.validUntilChapter === 'number'
      ? { validUntilChapter: value.validUntilChapter as number }
      : {}),
  };
}

function parseCharacter(value: unknown): NovelStoryCharacter {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：character 必须是对象');
  }
  const optionalString = (field: string): string | undefined => {
    const raw = value[field];
    if (raw === undefined || raw === null) {
      return undefined;
    }
    return requireString(raw, `character.${field}`);
  };
  const enriched: Record<string, string> = {};
  for (const field of [
    'appearance',
    'personality',
    'speechStyle',
    'background',
    'motivation',
    'affiliation',
  ]) {
    const parsed = optionalString(field);
    if (parsed !== undefined) {
      enriched[field] = parsed;
    }
  }
  return {
    id: coerceId(value.id, 'character.id'),
    name: requireString(value.name, 'character.name'),
    role: requireOptionalString(value.role),
    profile: requireOptionalString(value.profile),
    // 结构化字段仅在有值时才写回，避免增量合并时覆盖已有（如检索增强）结果。
    ...enriched,
    ...(Array.isArray(value.evidence) && value.evidence.length > 0
      ? { evidence: requireStringArray(value.evidence, 'character.evidence') }
      : {}),
  };
}

function parseCharacterState(value: unknown): NovelCharacterState {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：characterState 必须是对象');
  }
  return {
    characterId: coerceId(value.characterId, 'characterState.characterId'),
    currentState: requireOptionalString(value.currentState),
    goal: requireOptionalString(value.goal),
    motive: requireOptionalString(value.motive),
    speakingStyle: requireOptionalString(value.speakingStyle),
    knows: requireStringArray(value.knows ?? [], 'characterState.knows'),
    unknown: requireStringArray(value.unknown ?? [], 'characterState.unknown'),
    atChapter: requireNumber(value.atChapter, 'characterState.atChapter'),
  };
}

function parseRelationship(value: unknown): NovelCharacterRelationship {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：relationship 必须是对象');
  }
  return {
    id: coerceId(value.id, 'relationship.id'),
    fromCharacter: coerceId(value.fromCharacter, 'relationship.fromCharacter'),
    toCharacter: coerceId(value.toCharacter, 'relationship.toCharacter'),
    relation: requireOptionalString(value.relation),
    description: requireOptionalString(value.description),
    atChapter: requireNumber(value.atChapter, 'relationship.atChapter'),
  };
}

function parseTimelineEvent(value: unknown): NovelTimelineEvent {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：timelineEvent 必须是对象');
  }
  return {
    id: coerceId(value.id, 'timelineEvent.id'),
    type: normalizeEnum(value.type, TIMELINE_TYPE_ENTRIES, 'timeline', 'timelineEvent.type'),
    chapter: requireNumber(value.chapter, 'timelineEvent.chapter'),
    subject: requireString(value.subject, 'timelineEvent.subject'),
    event: requireString(value.event, 'timelineEvent.event'),
  };
}

function parsePlotThread(value: unknown): NovelPlotThread {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：plotThread 必须是对象');
  }
  return {
    id: coerceId(value.id, 'plotThread.id'),
    title: requireString(value.title, 'plotThread.title'),
    kind: normalizeEnum(value.kind, PLOT_KIND_ENTRIES, 'sub', 'plotThread.kind'),
    description: requireOptionalString(value.description),
    progress: requireOptionalString(value.progress),
    startChapter: requireNumber(value.startChapter, 'plotThread.startChapter'),
  };
}

function parseHook(value: unknown): NovelHook {
  if (!isPlainObject(value)) {
    throw new Error('校验失败：hook 必须是对象');
  }
  return {
    id: coerceId(value.id, 'hook.id'),
    keyword: requireString(value.keyword, 'hook.keyword'),
    description: requireOptionalString(value.description),
    type: requireOptionalString(value.type),
    status: parseHookStatus(value.status),
    startChapter: requireNumber(value.startChapter, 'hook.startChapter'),
    lastAdvancedChapter: requireNumber(value.lastAdvancedChapter, 'hook.lastAdvancedChapter'),
    expectedPayoff: requireOptionalString(value.expectedPayoff),
    importance: normalizeEnum(value.importance, HOOK_IMPORTANCE_ENTRIES, 'minor', 'hook.importance'),
    dependsOn: requireIdArray(value.dependsOn ?? [], 'hook.dependsOn'),
    supportingEvidence: requireStringArray(value.supportingEvidence ?? [], 'hook.supportingEvidence'),
    ...(typeof value.resolvedChapter === 'number'
      ? { resolvedChapter: value.resolvedChapter as number }
      : {}),
    ...(typeof value.dueAfterChapter === 'number'
      ? { dueAfterChapter: value.dueAfterChapter as number }
      : {}),
    note: requireOptionalString(value.note),
  };
}

/**
 * LLM 分析 delta 的严格校验。任何字段不合法即抛错。
 * delta 描述「这批章节观察到的变化」，由合并器累积进 analysis。
 */
export type StoryAnalysisDelta = {
  summaries: NovelChapterSummaryRow[];
  worldFacts: NovelWorldFact[];
  characters: NovelStoryCharacter[];
  characterStates: NovelCharacterState[];
  relationships: NovelCharacterRelationship[];
  timeline: NovelTimelineEvent[];
  plotThreads: NovelPlotThread[];
  hooks: NovelHook[];
  styleProfile: {
    pointOfView: string;
    sentenceLength: string;
    dialogueRatio: string;
    pacing: string;
    languageFeatures: string;
  };
};

export function parseStoryAnalysisDelta(raw: string): StoryAnalysisDelta {
  const jsonSlice = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    // 带原始输出预览，便于定位是「截断」还是「格式抖动」。
    const preview =
      jsonSlice.length > 300 ? `${jsonSlice.slice(0, 300)}…（后略 ${jsonSlice.length - 300} 字符）` : jsonSlice;
    throw new Error(`分析输出不是合法 JSON（共 ${jsonSlice.length} 字符，输出预览）：${preview}`);
  }  if (!isPlainObject(parsed)) {
    throw new Error('分析输出必须是 JSON 对象');
  }

  return {
    summaries: Array.isArray(parsed.summaries)
      ? parsed.summaries.map((item) => parseSummaryRow(item, 0))
      : [],
    worldFacts: Array.isArray(parsed.worldFacts) ? parsed.worldFacts.map(parseWorldFact) : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters.map(parseCharacter) : [],
    characterStates: Array.isArray(parsed.characterStates)
      ? parsed.characterStates.map(parseCharacterState)
      : [],
    relationships: Array.isArray(parsed.relationships)
      ? parsed.relationships.map(parseRelationship)
      : [],
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline.map(parseTimelineEvent) : [],
    plotThreads: Array.isArray(parsed.plotThreads) ? parsed.plotThreads.map(parsePlotThread) : [],
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks.map(parseHook) : [],
    styleProfile: isPlainObject(parsed.styleProfile)
      ? {
          pointOfView: requireOptionalString(parsed.styleProfile.pointOfView),
          sentenceLength: requireOptionalString(parsed.styleProfile.sentenceLength),
          dialogueRatio: requireOptionalString(parsed.styleProfile.dialogueRatio),
          pacing: requireOptionalString(parsed.styleProfile.pacing),
          languageFeatures: requireOptionalString(parsed.styleProfile.languageFeatures),
        }
      : { ...EMPTY_STYLE_PROFILE },
  };
}

function extractJsonObject(value: string): string {
  const cleaned = value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return cleaned;
  }
  return cleaned.slice(start, end + 1);
}

/**
 * 把模型输出的章节号映射为绝对章节号，兼容两种输出习惯：
 * - 绝对编号（落在本批章节 index 范围内）→ 原样使用；
 * - 相对编号（1..batchSize，按 prompt 要求）→ 加上批起点偏移；
 * - 其他越界值 → 钳制到本批范围。
 * 该兼容避免「模型按绝对章号输出、引擎按相对编号偏移」导致章号整体推高
 * （曾导致 32 章的小说被推到 62 章）。
 */
export function mapModelChapter(chapter: number, batchStart: number, batchSize: number): number {
  const batchEnd = batchStart + batchSize - 1;
  if (chapter >= batchStart && chapter <= batchEnd) {
    return chapter;
  }
  if (chapter >= 1 && chapter <= batchSize) {
    return chapter + batchStart - 1;
  }
  return Math.max(batchStart, Math.min(batchEnd, chapter));
}

/** 将 delta 中各章节号字段统一做「绝对/相对兼容」映射到绝对章节号。 */
export function remapBatchDelta(
  delta: StoryAnalysisDelta,
  batchStart: number,
  batchSize: number,
): StoryAnalysisDelta {
  const map = (chapter: number) => mapModelChapter(chapter, batchStart, batchSize);
  return {
    ...delta,
    summaries: delta.summaries.map((row) => ({ ...row, chapter: map(row.chapter) })),
    worldFacts: delta.worldFacts.map((fact) => ({
      ...fact,
      sourceChapter: map(fact.sourceChapter),
      validFromChapter: map(fact.validFromChapter),
      ...(fact.validUntilChapter !== undefined
        ? { validUntilChapter: map(fact.validUntilChapter) }
        : {}),
    })),
    characterStates: delta.characterStates.map((state) => ({
      ...state,
      atChapter: map(state.atChapter),
    })),
    relationships: delta.relationships.map((rel) => ({
      ...rel,
      atChapter: map(rel.atChapter),
    })),
    timeline: delta.timeline.map((event) => ({
      ...event,
      chapter: map(event.chapter),
    })),
    plotThreads: delta.plotThreads.map((thread) => ({
      ...thread,
      startChapter: map(thread.startChapter),
    })),
    hooks: delta.hooks.map((hook) => ({
      ...hook,
      startChapter: map(hook.startChapter),
      lastAdvancedChapter: map(hook.lastAdvancedChapter),
      ...(hook.resolvedChapter !== undefined ? { resolvedChapter: map(hook.resolvedChapter) } : {}),
      ...(hook.dueAfterChapter !== undefined ? { dueAfterChapter: map(hook.dueAfterChapter) } : {}),
    })),
  };
}

/**
 * 检测章节编号错位（历史 bug：模型输出绝对章号、引擎按相对编号偏移，
 * 导致 summaries 等章号整体推高，32 章被记到 62 章）。
 * 判据：存在摘要章号超过全书总章数、或摘要数量远多于总章数。
 */
export function detectMisalignedStoryAnalysis(
  analysis: NovelStoryAnalysis | null,
  totalChapters: number,
): boolean {
  if (!analysis || totalChapters <= 0) {
    return false;
  }
  if (analysis.chapterSummaries.some((row) => row.chapter > totalChapters || row.chapter < 1)) {
    return true;
  }
  // 摘要数量明显超过总章数（正常应为「每章一条」），即使单条未越界也判定错位。
  if (analysis.chapterSummaries.length > totalChapters) {
    return true;
  }
  return false;
}

/**
 * 清空受污染的章号敏感数据，保留 characters / styleProfile
 * （用户可能已通过「全文检索增强」补充过角色档案，不能丢）。
 * 返回可用于全量重新分析的空基座。
 */
export function resetMisalignedStoryAnalysis(analysis: NovelStoryAnalysis): NovelStoryAnalysis {
  return {
    ...analysis,
    lastAnalyzedChapter: 0,
    manifest: { ...analysis.manifest, status: 'idle', progress: 0, updatedAt: new Date().toISOString() },
    checkpoint: undefined,
    worldFacts: [],
    characterStates: [],
    relationships: [],
    timeline: [],
    plotThreads: [],
    hooks: [],
    chapterSummaries: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 增量合并器 —— 用 delta 推进 analysis（保留累积，新值覆盖旧值）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 人物去重归一化：修复「同一人物被多次记录」（历史 bug —— 模型每批自由生成 id，
 * 同人不同 id 导致 characters 膨胀，甚至一人被记 5 次）。
 * - 按 name 合并 characters，保留首个条目的 id（避免悬空引用），吸收后续条目字段；
 * - characterStates 的 characterId 同步重映射到保留的 id，并去重（保留 atChapter 最新）；
 * - relationships 引用的是角色名而非 id，无需处理。
 */
export function dedupeCharactersInAnalysis(analysis: NovelStoryAnalysis): NovelStoryAnalysis {
  const idRemap = new Map<string, string>();
  const characters: NovelStoryCharacter[] = [];
  const seenByName = new Map<string, number>();

  for (const character of analysis.characters) {
    const key = character.name.trim();
    if (!key) {
      characters.push(character);
      continue;
    }
    const existingIndex = seenByName.get(key);
    if (existingIndex === undefined) {
      seenByName.set(key, characters.length);
      characters.push(character);
    } else {
      const target = characters[existingIndex];
      const merged: NovelStoryCharacter = { ...target, ...character, id: target.id };
      const evidence = mergeStringSets(target.evidence, character.evidence);
      if (evidence) {
        merged.evidence = evidence;
      }
      characters[existingIndex] = merged;
      idRemap.set(character.id, target.id);
    }
  }

  const stateByCharacter = new Map<string, NovelCharacterState>();
  for (const state of analysis.characterStates) {
    const canonicalId = idRemap.get(state.characterId) ?? state.characterId;
    const existing = stateByCharacter.get(canonicalId);
    if (!existing || state.atChapter >= existing.atChapter) {
      // 关键：value 的 characterId 必须改写为 canonical id，否则与 characters 的 id 失配。
      stateByCharacter.set(canonicalId, { ...state, characterId: canonicalId });
    }
  }

  if (
    characters.length === analysis.characters.length &&
    idRemap.size === 0 &&
    stateByCharacter.size === analysis.characterStates.length
  ) {
    return analysis;
  }
  return {
    ...analysis,
    characters,
    characterStates: [...stateByCharacter.values()],
  };
}

function mergeStringSets(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  if (!left && !right) {
    return undefined;
  }
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

/**
 * 将一批实体统一做 id 唯一化：模型会自由生成 id，可能在同一批/跨批复用
 * （如 rel-1、hook-4、tl-1 重复），导致渲染 key 冲突、引用悬空。
 * 返回唯一化后的实体列表与「旧 id → 新 id」映射（供 dependsOn 等引用重映射）。
 * 若没有重复则返回原数组引用（零拷贝）。
 */
export function normalizeUniqueEntityIds<T extends { id: string }>(
  items: readonly T[],
  deriveKey: (item: T, index: number) => string,
): { items: T[]; idMap: Map<string, string> } {
  const seen = new Set<string>();
  const idMap = new Map<string, string>();
  let changed = false;
  const out: T[] = items.map((item, index) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    changed = true;
    let candidate = deriveKey(item, index);
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${deriveKey(item, index)}-${suffix}`;
      suffix += 1;
    }
    seen.add(candidate);
    idMap.set(item.id, candidate);
    return { ...item, id: candidate };
  });
  return changed ? { items: out, idMap } : { items: [...out], idMap };
}

/** 全量 id 归一化：对 analysis 的所有实体数组统一去重 id，并重映射 hooks.dependsOn。 */
export function normalizeAnalysisEntityIds(analysis: NovelStoryAnalysis): NovelStoryAnalysis {
  const relationships = normalizeUniqueEntityIds(
    analysis.relationships,
    (item) => `${item.fromCharacter}→${item.toCharacter}`,
  );
  const hooks = normalizeUniqueEntityIds(analysis.hooks, (item) => item.keyword || `hook-${item.id}`);
  const plotThreads = normalizeUniqueEntityIds(analysis.plotThreads, (item) => item.title);
  const timeline = normalizeUniqueEntityIds(
    analysis.timeline,
    (item, index) => `tl-${item.chapter}-${index}`,
  );
  const worldFacts = normalizeUniqueEntityIds(analysis.worldFacts, (item) => item.subject);

  const hasRemap =
    relationships.idMap.size > 0 ||
    hooks.idMap.size > 0 ||
    plotThreads.idMap.size > 0 ||
    timeline.idMap.size > 0 ||
    worldFacts.idMap.size > 0;
  if (!hasRemap) {
    return analysis;
  }

  // 归一化后仍保留的原 id（重复 id 的第一条保留原名），dependsOn 若指向它们则无需重映射；
  // 只有指向已完全消失的旧 id 才通过 idMap 重映射，避免把引用错误指向被重命名的兄弟条目。
  const keptHookIds = new Set(hooks.items.map((item) => item.id));

  return {
    ...analysis,
    relationships: relationships.items,
    plotThreads: plotThreads.items,
    timeline: timeline.items,
    worldFacts: worldFacts.items,
    // dependsOn 引用重映射：优先保留现存 id，仅对已消失的旧 id 换新，避免悬空。
    hooks: hooks.items.map((hook) =>
      hook.dependsOn.length > 0
        ? {
            ...hook,
            dependsOn: hook.dependsOn.map((id) => (keptHookIds.has(id) ? id : hooks.idMap.get(id) ?? id)),
          }
        : hook,
    ),
  };
}

/** 将一批章节观察到的 delta 合并进 analysis（确认章节后的状态增量更新也复用此函数）。 */
export function mergeStoryAnalysisDelta(
  analysis: NovelStoryAnalysis,
  delta: StoryAnalysisDelta,
  upToChapter: number,
  now: ISODateString,
): NovelStoryAnalysis {
  return mergeDelta(analysis, delta, upToChapter, now);
}

export function mergeDelta(
  analysis: NovelStoryAnalysis,
  delta: StoryAnalysisDelta,
  upToChapter: number,
  now: ISODateString,
): NovelStoryAnalysis {
  // 数组字段全部拷贝，避免原地污染输入（事务安全：解析/合并失败不残留）。
  const next: NovelStoryAnalysis = {
    ...analysis,
    worldFacts: [...analysis.worldFacts],
    characters: [...analysis.characters],
    characterStates: [...analysis.characterStates],
    relationships: [...analysis.relationships],
    timeline: [...analysis.timeline],
    plotThreads: [...analysis.plotThreads],
    hooks: [...analysis.hooks],
    chapterSummaries: [...analysis.chapterSummaries],
    lastAnalyzedChapter: Math.max(analysis.lastAnalyzedChapter, upToChapter),
  };

  // worldFacts：按 subject 覆盖。
  for (const fact of delta.worldFacts) {
    const existingIndex = next.worldFacts.findIndex((item) => item.subject === fact.subject);
    if (existingIndex >= 0) {
      next.worldFacts[existingIndex] = fact;
    } else {
      next.worldFacts.push(fact);
    }
  }

  // characters：按 id 覆盖；id 漂移时（模型每批自由生成 id 导致同人不同 id）按 name 兜底合并，
  // 保留已存在条目的 id 与既有引用（characterStates.characterId / relationships），吸收增量字段。
  const charIdRemap = new Map<string, string>();
  for (const character of delta.characters) {
    const incomingCanonicalId = character.canonicalId || character.id;
    const incomingNames = new Set([character.name, ...(character.aliases ?? [])].map((item) => item.trim().toLocaleLowerCase()).filter(Boolean));
    const existingById = next.characters.findIndex((item) =>
      item.id === character.id || (item.canonicalId || item.id) === incomingCanonicalId,
    );
    if (existingById >= 0) {
      const target = next.characters[existingById];
      next.characters[existingById] = {
        ...target,
        ...character,
        id: target.id,
        canonicalId: target.canonicalId || target.id,
        aliases: [...new Set([...(target.aliases ?? []), target.name, ...(character.aliases ?? []), character.name])],
        lockedByUser: target.lockedByUser || character.lockedByUser,
      };
      if (character.id !== target.id) charIdRemap.set(character.id, target.id);
      continue;
    }
    const existingByName = next.characters.findIndex((item) => {
      const knownNames = [item.name, ...(item.aliases ?? [])].map((name) => name.trim().toLocaleLowerCase());
      return knownNames.some((name) => incomingNames.has(name));
    });
    if (existingByName >= 0) {
      const target = next.characters[existingByName];
      next.characters[existingByName] = {
        ...target,
        ...character,
        // 保留原 id，避免悬空引用（characterStates.characterId 等仍指向原 id）。
        id: target.id,
        canonicalId: target.canonicalId || target.id,
        aliases: [...new Set([...(target.aliases ?? []), target.name, ...(character.aliases ?? []), character.name])],
        lockedByUser: target.lockedByUser || character.lockedByUser,
      };
      charIdRemap.set(character.id, target.id);
    } else {
      next.characters.push({
        ...character,
        canonicalId: incomingCanonicalId,
        aliases: [...new Set([...(character.aliases ?? []), character.name])],
        confidence: character.confidence ?? 1,
        lockedByUser: character.lockedByUser ?? false,
      });
    }
  }

  // characterStates：按 characterId 覆盖为最新；先经 charIdRemap 归一，避免
  // 「characters 已按 name 合并、characterStates 却因 id 漂移各自累积」的重复状态。
  for (const state of delta.characterStates) {
    const canonicalId = charIdRemap.get(state.characterId) ?? state.characterId;
    const existingIndex = next.characterStates.findIndex(
      (item) => item.characterId === canonicalId,
    );
    if (existingIndex >= 0) {
      next.characterStates[existingIndex] = { ...state, characterId: canonicalId };
    } else {
      next.characterStates.push({ ...state, characterId: canonicalId });
    }
  }

  // relationships：按 from→to 覆盖；id 唯一性由末尾的 normalizeAnalysisEntityIds 统一保证
  // （模型可能复用 rel-1 等 id，导致渲染 key 冲突）。
  for (const relation of delta.relationships) {
    const existingIndex = next.relationships.findIndex(
      (item) => item.fromCharacter === relation.fromCharacter && item.toCharacter === relation.toCharacter,
    );
    if (existingIndex >= 0) {
      next.relationships[existingIndex] = relation;
    } else {
      next.relationships.push(relation);
    }
  }

  // timeline/location/faction/item：事件保留历史，同时给实体 subject 绑定稳定 canonicalId。
  for (const event of delta.timeline) {
    const names = new Set([event.subject, ...(event.aliases ?? [])].map((item) => item.trim().toLocaleLowerCase()));
    const prior = next.timeline.find((item) => item.type === event.type && (
      (event.canonicalId && (item.canonicalId || item.id) === event.canonicalId) ||
      [item.subject, ...(item.aliases ?? [])].some((name) => names.has(name.trim().toLocaleLowerCase()))
    ));
    const duplicate = next.timeline.some((item) =>
      item.id === event.id && item.chapter === event.chapter && item.event === event.event,
    );
    if (!duplicate) {
      next.timeline.push({
        ...event,
        canonicalId: prior?.canonicalId || event.canonicalId || event.id,
        aliases: [...new Set([...(prior?.aliases ?? []), prior?.subject ?? '', ...(event.aliases ?? []), event.subject])].filter(Boolean),
        confidence: event.confidence ?? 1,
        lockedByUser: prior?.lockedByUser || event.lockedByUser || false,
      });
    }
  }

  // plotThreads：按 id 覆盖。
  for (const thread of delta.plotThreads) {
    const existingIndex = next.plotThreads.findIndex((item) => item.id === thread.id);
    if (existingIndex >= 0) {
      next.plotThreads[existingIndex] = { ...next.plotThreads[existingIndex], ...thread };
    } else {
      next.plotThreads.push(thread);
    }
  }

  // hooks：按 keyword 匹配合并（状态演进 / lastAdvancedChapter 更新）。
  for (const hook of delta.hooks) {
    const existingIndex = next.hooks.findIndex((item) => item.keyword === hook.keyword);
    if (existingIndex >= 0) {
      const existing = next.hooks[existingIndex];
      next.hooks[existingIndex] = {
        ...existing,
        description: hook.description || existing.description,
        type: hook.type || existing.type,
        status: promoteHookStatus(existing.status, hook.status, existing, hook),
        lastAdvancedChapter: Math.max(existing.lastAdvancedChapter, hook.lastAdvancedChapter),
        expectedPayoff: hook.expectedPayoff || existing.expectedPayoff,
        importance:
          existing.importance === 'core' || hook.importance === 'core'
            ? 'core'
            : existing.importance === 'major' || hook.importance === 'major'
              ? 'major'
              : 'minor',
        dependsOn: hook.dependsOn.length > 0 ? hook.dependsOn : existing.dependsOn,
        supportingEvidence: [
          ...new Set([...existing.supportingEvidence, ...hook.supportingEvidence]),
        ].slice(0, 8),
        ...(hook.resolvedChapter !== undefined
          ? { resolvedChapter: hook.resolvedChapter }
          : existing.resolvedChapter !== undefined
            ? { resolvedChapter: existing.resolvedChapter }
            : {}),
        ...(hook.dueAfterChapter !== undefined
          ? { dueAfterChapter: hook.dueAfterChapter }
          : existing.dueAfterChapter !== undefined
            ? { dueAfterChapter: existing.dueAfterChapter }
            : {}),
        note: hook.note || existing.note,
      };
    } else {
      next.hooks.push(hook);
    }
  }

  // chapterSummaries：按 chapter 覆盖。
  for (const summary of delta.summaries) {
    const existingIndex = next.chapterSummaries.findIndex(
      (item) => item.chapter === summary.chapter,
    );
    if (existingIndex >= 0) {
      next.chapterSummaries[existingIndex] = summary;
    } else {
      next.chapterSummaries.push(summary);
    }
  }

  // styleProfile：最新批次覆盖（最后一次调用拥有最新文风认知）。
  if (
    delta.styleProfile.pointOfView ||
    delta.styleProfile.sentenceLength ||
    delta.styleProfile.dialogueRatio ||
    delta.styleProfile.pacing ||
    delta.styleProfile.languageFeatures
  ) {
    next.styleProfile = { ...next.styleProfile, ...delta.styleProfile };
  }

  next.manifest = {
    ...next.manifest,
    updatedAt: now,
  };

  // 末尾统一归一化所有实体 id（关系/伏笔/剧情线/时间线/世界观），并重映射 dependsOn，
  // 防止模型跨批/同批复用同一 id 造成渲染 key 冲突或引用悬空。
  return normalizeAnalysisEntityIds(next);
}

/** 伏笔状态演进：open→progressing→deferred→resolved，不允许倒退。 */
function promoteHookStatus(
  existing: NovelHookStatus,
  incoming: NovelHookStatus,
  existingHook: NovelHook,
  incomingHook: NovelHook,
): NovelHookStatus {
  if (incoming === 'resolved') {
    return 'resolved';
  }
  if (incoming === 'progressing' && existing === 'open') {
    return 'progressing';
  }
  if (incoming === 'deferred' && existing === 'open') {
    return 'deferred';
  }
  if (incoming === 'deferred' && existing === 'progressing') {
    return 'deferred';
  }
  void existingHook;
  void incomingHook;
  return existing;
}
