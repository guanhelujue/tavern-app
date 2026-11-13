import {
  MAX_NOVEL_LORE_BATCH_CHUNK,
  MAX_NOVEL_LORE_BATCH_TOTAL,
  MAX_NOVEL_LORE_CONTENT_LENGTH,
  NOVEL_LORE_TYPES,
  NOVEL_LORE_TYPE_LABELS,
  isNovelLoreTypeId,
  type NovelLoreTypeId,
} from '@/constants/novel-lore';
import { DEFAULT_NOVEL_SYSTEM_PROMPT } from '@/constants/novel-memory';
import { REWRITE_PASS_SCORE } from '@/constants/novel-story-state';
import { requestCompletionWithUsage, requestPlainCompletion } from '@/services/llm';
import { extractAiJsonArray, extractAiJsonObject } from '@/utils/ai-json';
import { shouldAdoptRevision } from '@/services/novel-rewrite-pipeline';
import { normalizeCharacterAiSummary } from '@/features/character-dossier-v2/ai-summary';
import {
  buildCharacterGenerationSystemPrompt,
  buildSupportingCharacterGenerationSystemPrompt,
} from '@/features/character-dossier-v2/generation-prompt';
import {
  mergeCharacterDossierV2,
  normalizeCharacterDossierV2,
} from '@/features/character-dossier-v2/model';
import type { CharacterAiSummary, CharacterDossierV2 } from '@/types/character-dossier-v2';
import type {
  ApiSettings,
  NovelCastCharacter,
  NovelCastCharacterPrivacy,
  NovelCastRelation,
  NovelLoreEntry,
  NovelStyleProfile,
} from '@/types/tavern';
import { normalizeCastPrivacyFields } from '@/utils/novel-dossiers';
import { normalizeLoreEntry } from '@/utils/novel-lore';
import { type NovelPlayerProfileFields } from '@/utils/novel-player';
import {
  buildLockedReciprocalRelations,
  createCastRelationId,
  formatCastRelationsText,
  formatLockedRelationsForPrompt,
  mergeRelationsWithLocked,
  normalizeCastRelations,
} from '@/utils/novel-relations';
import { normalizeRelationGraphLabel } from '@/constants/novel-relation-graphs';
import { asString, generateId, normalizeAliases } from '@/utils/helpers';

/** 已有角色摘要注入提示词的字符预算（可压缩层：仅防撞名参考，角色过多时优先裁剪明细）。 */
const MAX_CAST_CONTEXT_CHARS = 1600;

const NOVEL_CREATE_JSON_RETRY_HINT =
  '（上次输出未通过 JSON 校验。请重新输出：只输出符合原要求的合法 JSON 对象或数组，不要包含任何解释、注释、代码块标记或多余文字。）';

/** 新建侧 AI 调用 token 用量（供 UI 统计到小说 continuationStats）。 */
export type CreateAiUsage = {
  promptTokens: number;
  completionTokens: number;
  modelId?: string;
};

/** A bounded evidence block used by the "import supporting characters" flow. */
export type SupportingCharacterSourceSection = {
  label: string;
  content: string;
};

export type SupportingCharacterCandidate = {
  name: string;
  role?: string;
  evidence: string[];
  sourceLabel?: string;
};

/** 新建侧 AI 任务标签（与续写任务同表统计，settings 面板可见）。 */
export const NOVEL_CREATE_USAGE_TASKS = {
  framework: 'create-framework',
  cast: 'create-cast',
  lore: 'create-lore',
  supporting: 'create-supporting',
} as const;

/** 轻量反 AI 味规则：注入角色/设定生成提示词，减少模板套话。 */
const CREATE_ANTI_AI_RULES = `【反套话规则】
- 描述用具体细节与行为，禁止「气质不凡」「注定不凡」类空话形容词堆砌。
- 性格/动机要从行为与选择里体现，禁止只贴标签（如「腹黑」「高冷」）而不解释其由来。
- 背景写事件与因果，不写总结性赞美；人物关系的 note 写现状与张力，不写空泛客套。
- 避免每项都以「擅长/喜欢/性格」开头，变换句式；不要输出明显模板化的排比。`;

function mergeUsage(a: CreateAiUsage, b: CreateAiUsage): CreateAiUsage {
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0),
    modelId: b.modelId ?? a.modelId,
  };
}

function toCreateAiUsage(result: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}): CreateAiUsage {
  return {
    promptTokens: result.promptTokens ?? 0,
    completionTokens: result.completionTokens ?? 0,
    modelId: result.model,
  };
}

export type NovelFrameworkDraft = {
  playerName: string;
  playerPersona: string;
  playerMotive: string;
} & NovelPlayerProfileFields & {
  worldName: string;
  worldEra: string;
  worldConflict: string;
  worldTone: string;
  mainPlot: string;
  initialStoryState: string;
  gameRules: string;
  cast: NovelCastCharacter[];
};

type FrameworkAiPayload = {
  playerName?: string;
  playerPersona?: string;
  playerMotive?: string;
  playerProfession?: string;
  playerAge?: string;
  playerGender?: string;
  playerHeight?: string;
  playerWeight?: string;
  playerAppearance?: string;
  playerPersonality?: string;
  playerSpeechStyle?: string;
  playerBackground?: string;
  playerHabits?: string;
  playerStrengths?: string;
  playerWeaknesses?: string;
  playerSecrets?: string;
  playerPrivacy?: NovelCastCharacterPrivacy;
  worldName?: string;
  worldEra?: string;
  worldConflict?: string;
  worldTone?: string;
  mainPlot?: string;
  initialStoryState?: string;
  gameRules?: string;
  cast?: Partial<NovelCastCharacter>[];
};

type CharacterAiPayload = Partial<
  Pick<
    NovelCastCharacter,
    | 'name'
    | 'aliases'
    | 'profession'
    | 'age'
    | 'gender'
    | 'height'
    | 'weight'
    | 'birthplace'
    | 'affiliation'
    | 'appearance'
    | 'personality'
    | 'speechStyle'
    | 'background'
    | 'motive'
    | 'strengths'
    | 'weaknesses'
    | 'relations'
    | 'privacy'
  >
>;

type CharacterGenerationAiPayload = {
  cast?: CharacterAiPayload & { relations?: unknown };
  dossierV2?: Partial<CharacterDossierV2> | null;
  aiSummary?: Partial<CharacterAiSummary> | null;
};

function normalizeAiRelations(value: unknown): NovelCastRelation[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const mapped = value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const row = item as Record<string, unknown>;
    const targetName = asString(row.targetName);
    const label = asString(row.label);
    if (!targetName && !label) {
      return null;
    }
    const normalized = normalizeRelationGraphLabel(label || '熟人');

    return {
      id: asString(row.id) || createCastRelationId(),
      targetName,
      label: normalized,
      note: asString(row.note) || undefined,
      source: 'ai' as const,
      updatedAt: Date.now(),
    } satisfies NovelCastRelation;
  });

  // Post-filter: demote unsupported "恋人/配偶" labels when the note shows no
  // actual romantic context (happens when LLM hallucinates relationships).
  const sanitized = mapped.map((item) => {
    if (!item) {
      return null;
    }
    if (!isRomanticLabel(item.label)) {
      return item;
    }
    if (item.note && hasRomanticContext(item.note)) {
      return item;
    }
    // No verifiable romantic context → demote to the weakest safe label.
    return {
      ...item,
      label: isRomanticLabel(item.label) ? '旧识' : item.label,
      note: item.note
        ? `[自动修正：无恋爱依据，原标注「${item.label}」已降级为旧识] ${item.note}`
        : `[自动修正：无恋爱依据，原标注「${item.label}」已降级为旧识]`,
    } satisfies NovelCastRelation;
  });

  return normalizeCastRelations(sanitized);
}

/** Labels that imply romance / sexual partnership. */
function isRomanticLabel(label: string): boolean {
  return /^(恋人|配偶|炮友|性伴侣|情侣|情敌|男友|女友|对象)$/.test(label);
}

/** Shallow heuristic: does this note text hint at romantic context? */
function hasRomanticContext(note: string): boolean {
  return /恋爱|喜欢|爱慕|钟情|表白|追求|暧昧|心动|约会|求婚|订婚|已婚|结婚|夫妻|伴侣|情人/.test(note);
}

function extractJsonObject(text: string): unknown {
  const parsed = extractAiJsonObject(text);
  if (parsed) return parsed;
  throw new Error('模型未返回可解析的 JSON。');
}

/**
 * 请求 + JSON 解析，解析失败自动重试一次（部分截断 / 格式抖动可自愈）。
 * 与续写状态分析（novel-story-state）的失败自愈策略一致：仍失败才抛错，
 * 避免用户因一次截断或格式抖动就得手动重来。
 */
/**
 * 可复用的新建侧 JSON 请求封装：
 * - 强制关闭流式/思考，统一 JSON 输出要求；
 * - 输出未通过 `validate`（默认 extractJsonObject）时自动重试一次（截断/格式抖动自愈）；
 * - 返回原文 + token 用量（供 UI 统计到小说 continuationStats）。
 */
async function requestCreateCompletion({
  apiSettings,
  maxTokens,
  temperature,
  purpose = 'utility-create',
  systemPrompt,
  userContent,
  validate = (raw: string) => {
    extractJsonObject(raw);
    return true;
  },
}: {
  apiSettings: ApiSettings;
  maxTokens: number;
  temperature: number;
  purpose?: string;
  systemPrompt: string;
  userContent: string;
  validate?: (raw: string) => boolean;
}): Promise<{ raw: string; usage: CreateAiUsage }> {
  const settings: ApiSettings = {
    ...apiSettings,
    streamingEnabled: false,
    thinkingDisabled: true,
    maxTokens,
    temperature,
  };

  const run = (content: string, previous?: string) =>
    requestCompletionWithUsage({
      apiSettings: settings,
      maxTokens,
      temperature,
      purpose,
      responseFormat: 'json',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
        ...(previous ? [{ role: 'assistant' as const, content: previous }, { role: 'user' as const, content: '保留已有完整字段，只修复格式并补足原要求中的缺失项。' }] : []),
      ],
    });

  const first = await run(userContent);
  try {
    if (!validate(first.content)) throw new Error('AI 返回内容未通过结构校验。');
    return { raw: first.content, usage: toCreateAiUsage(first) };
  } catch {
    const retry = await run(`${userContent}\n\n${NOVEL_CREATE_JSON_RETRY_HINT}`, first.content);
    if (!validate(retry.content)) throw new Error('AI 修复结果未通过结构校验。');
    return {
      raw: retry.content,
      usage: {
        promptTokens: (first.promptTokens ?? 0) + (retry.promptTokens ?? 0),
        completionTokens: (first.completionTokens ?? 0) + (retry.completionTokens ?? 0),
        modelId: retry.model ?? first.model,
      },
    };
  }
}

const CREATE_AUDIT_SYSTEM_PROMPT = `你是小说设定质量审查官。审查一段 AI 生成的设定 JSON，按以下维度检查：
- 与世界/框架设定冲突（世界观越界、具名人物与已有卡冲突）；
- 与已有角色雷同或撞名（姓名、外貌、性格、职业高度近似）；
- 关系是否有依据（已锁定关系/自建人际是否合理）；
- 内容是否空话套话、模板化；
- 字段是否完整（新建角色各字段应具体可扮演）。
输出严格为 JSON：{ "score": 0到100的整数, "issues": ["问题1", "问题2"] }，不要输出 JSON 以外的任何文字。`;

const CREATE_REVISE_SYSTEM_PROMPT = `你是小说设定修订编辑。根据审查问题修订给定设定 JSON：
- 只修有问题的地方；未标注问题的字段原样保留，不要重写无关内容。
- 保持 JSON 结构不变；姓名不得撞名，不得破坏已锁定关系。
- 只输出修订后的完整 JSON，不要解释。`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type CreateAuditScore = { score: number; issues: string[]; passed: boolean };

async function auditCreateDraft({
  apiSettings,
  maxTokens,
  temperature,
  purpose,
  auditUserContent,
}: {
  apiSettings: ApiSettings;
  maxTokens: number;
  temperature: number;
  purpose: string;
  auditUserContent: string;
}): Promise<CreateAuditScore & { usage: CreateAiUsage }> {
  const settings: ApiSettings = {
    ...apiSettings,
    streamingEnabled: false,
    thinkingDisabled: true,
    maxTokens,
    temperature,
  };

  const result = await requestCompletionWithUsage({
    apiSettings: settings,
    maxTokens,
    temperature,
    purpose,
    responseFormat: 'json',
    allowPartialJson: false,
    validateJson: (value) => isPlainObject(value) && typeof value.score === 'number' && Number.isFinite(value.score) && Array.isArray(value.issues),
    messages: [
      { role: 'system', content: CREATE_AUDIT_SYSTEM_PROMPT },
      { role: 'user', content: auditUserContent },
    ],
  });
  const usage = toCreateAiUsage(result);

  try {
    const payload = extractJsonObject(result.content);
    if (!isPlainObject(payload)) {
      return { score: 0, issues: [], passed: false, usage };
    }
    const rawScore = payload.score;
    const score =
      typeof rawScore === 'number' && Number.isFinite(rawScore)
        ? Math.max(0, Math.min(100, Math.round(rawScore)))
        : 0;
    const issues = Array.isArray(payload.issues)
      ? (payload.issues as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];
    return { score, issues, passed: score >= REWRITE_PASS_SCORE, usage };
  } catch {
    return { score: 0, issues: [], passed: false, usage };
  }
}

async function reviseCreateDraft({
  apiSettings,
  maxTokens,
  temperature,
  purpose,
  draftJson,
  issues,
}: {
  apiSettings: ApiSettings;
  maxTokens: number;
  temperature: number;
  purpose: string;
  draftJson: string;
  issues: string[];
}): Promise<{ raw: string | null; usage: CreateAiUsage }> {
  const settings: ApiSettings = {
    ...apiSettings,
    streamingEnabled: false,
    thinkingDisabled: true,
    maxTokens,
    temperature,
  };

  const issueBlock = issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n');
  const result = await requestCompletionWithUsage({
    apiSettings: settings,
    maxTokens,
    temperature,
    purpose,
    responseFormat: 'json',
    validateJson: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    messages: [
      { role: 'system', content: CREATE_REVISE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `【审查问题】\n${issueBlock}\n\n【待修订设定 JSON】\n${draftJson}\n\n请输出修订后的完整 JSON。`,
      },
    ],
  });

  try {
    extractJsonObject(result.content);
    return { raw: result.content, usage: toCreateAiUsage(result) };
  } catch {
    return { raw: null, usage: toCreateAiUsage(result) };
  }
}

/**
 * 可复用的「自检 → 修订 → 采用判定」闭环（借鉴续写的 8 维审查 + shouldAdoptRevision）。
 * - 自检未过线才修订；修订后再复审一次，用净提升判定是否采用，避免劣化覆盖。
 * - 适用于任何「JSON 生成对象 + 约束上下文」的新建场景。
 */
async function selfAuditAndReviseJson<T>(params: {
  apiSettings: ApiSettings;
  maxTokens: number;
  temperature: number;
  purpose: string;
  /** 自检上下文：应包含生成时的约束（框架/已有角色/防撞名等）。 */
  auditContext: string;
  draft: T;
  encode: (draft: T) => string;
  decode: (raw: string) => T | null;
}): Promise<{ value: T; usage: CreateAiUsage }> {
  const { draft } = params;
  const draftJson = params.encode(draft);
  let totalUsage: CreateAiUsage = { promptTokens: 0, completionTokens: 0 };

  const auditUserContent = `${params.auditContext}\n\n【待审查设定 JSON】\n${draftJson}`;

  const original = await auditCreateDraft({
    apiSettings: params.apiSettings,
    maxTokens: Math.min(params.maxTokens, 1500),
    temperature: 0.2,
    purpose: params.purpose,
    auditUserContent,
  });
  totalUsage = mergeUsage(totalUsage, original.usage);
  if (original.passed) {
    return { value: draft, usage: totalUsage };
  }

  const revised = await reviseCreateDraft({
    apiSettings: params.apiSettings,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    purpose: params.purpose,
    draftJson,
    issues: original.issues,
  });
  totalUsage = mergeUsage(totalUsage, revised.usage);
  const revisedDraft = revised.raw ? params.decode(revised.raw) : null;
  if (!revisedDraft) {
    return { value: draft, usage: totalUsage };
  }

  const followUp = await auditCreateDraft({
    apiSettings: params.apiSettings,
    maxTokens: Math.min(params.maxTokens, 1500),
    temperature: 0.2,
    purpose: params.purpose,
    auditUserContent: `${params.auditContext}\n\n【待审查设定 JSON】\n${params.encode(revisedDraft)}`,
  });
  totalUsage = mergeUsage(totalUsage, followUp.usage);

  const adopt = shouldAdoptRevision({
    originalScore: original.score,
    revisedScore: followUp.score,
    originalPassed: original.passed,
    revisedPassed: followUp.passed,
  });

  return {
    value: adopt ? revisedDraft : draft,
    usage: totalUsage,
  };
}

function resolveNovelCreateMaxTokens(value: number | undefined, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return fallback;
}

/**
 * Character cards are structured, relatively small JSON documents.  Letting
 * the global novel-create limit (normally 8k) flow into this request makes
 * mobile generation noticeably slower without improving the card result.
 */
function resolveNovelCastMaxTokens(value: number | undefined, fallback = 3200) {
  return Math.min(Math.max(resolveNovelCreateMaxTokens(value, fallback), 1600), 4200);
}

function fillIfEmpty(current: string, next: unknown) {
  // AI sometimes emits scalar fields such as age as a number (16), even
  // though the editor stores every card field as text.  Never call trim on
  // an unnormalised model value; this used to make a valid response fail
  // after it had already been shown in debug_terminal.
  const currentText = typeof current === 'string' ? current : String(current ?? '');
  if (currentText.trim()) {
    return currentText;
  }

  return typeof next === 'string' ? next.trim() : String(next ?? '').trim();
}

/**
 * Extract a character name only from an explicit protagonist phrase. This is
 * deliberately conservative: arbitrary prose must not be turned into a name
 * and accidentally force a supporting character to become the protagonist.
 */
function extractExplicitCharacterName(value: string): string {
  const text = value.trim();
  if (!text) {
    return '';
  }

  const patterns = [
    /(?:主角|女主角|男主角|主人公)\s*(?:姓名|名字)?\s*(?:是|叫|为|：|:)?\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z·-]{1,11})(?=\s*(?:想|要|希望|需要|必须|决定|试图|正在|的|[，,。；;：:、]|$))/u,
    /(?:主角|女主角|男主角|主人公)[^\n。！？]{0,24}?(?:姓名|名字)\s*(?:是|叫|为|：|:)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z·-]{1,11})/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim() ?? '';
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

/** Recover gender only from an explicit phrase; a name or generic prose is not evidence. */
function extractExplicitCharacterGender(value: string): string {
  const text = value.trim();
  if (!text) {
    return '';
  }

  if (/(?:女主角|女性主角|女主|女性|女生|女人)/u.test(text)) {
    return '女';
  }
  if (/(?:男主角|男性主角|男主|男性|男生|男人)/u.test(text)) {
    return '男';
  }

  return '';
}

function createCastId() {
  return generateId('cast');
}

function normalizeAiCastCharacter(
  item: Partial<NovelCastCharacter> | null | undefined,
): NovelCastCharacter | null {
  if (!item) {
    return null;
  }

  const name = asString(item.name);

  if (!name) {
    return null;
  }

  const privacy = normalizeCastPrivacyFields(item.privacy);
  const relations = normalizeAiRelations(item.relations);
  const aliases = normalizeAliases(item.aliases).filter(
    (alias) => alias.toLowerCase() !== name.toLowerCase(),
  ).slice(0, 6);

  return {
    id: asString(item.id) || createCastId(),
    name,
    ...(aliases.length ? { aliases } : {}),
    profession: asString(item.profession),
    age: asString(item.age),
    gender: asString(item.gender),
    height: asString(item.height),
    weight: asString(item.weight),
    birthplace: asString(item.birthplace),
    affiliation: asString(item.affiliation),
    appearance: asString(item.appearance),
    personality: asString(item.personality),
    speechStyle: asString(item.speechStyle),
    background: asString(item.background),
    isProtagonist: item.isProtagonist === true,
    motive: asString(item.motive),
    strengths: asString(item.strengths),
    weaknesses: asString(item.weaknesses),
    ...(relations ? { relations } : {}),
    ...(privacy ? { privacy } : {}),
  };
}

function mergeFrameworkDraft(
  current: NovelFrameworkDraft,
  generated: FrameworkAiPayload,
): NovelFrameworkDraft {
  const existingCast = current.cast;

  return {
    playerName: current.playerName,
    playerPersona: current.playerPersona,
    playerMotive: current.playerMotive,
    playerProfession: current.playerProfession,
    playerAge: current.playerAge,
    playerGender: current.playerGender,
    playerHeight: current.playerHeight,
    playerWeight: current.playerWeight,
    playerAppearance: current.playerAppearance,
    playerPersonality: current.playerPersonality,
    playerSpeechStyle: current.playerSpeechStyle,
    playerBackground: current.playerBackground,
    playerHabits: current.playerHabits,
    playerStrengths: current.playerStrengths,
    playerWeaknesses: current.playerWeaknesses,
    playerSecrets: current.playerSecrets,
    playerPrivacy: undefined,
    worldName: fillIfEmpty(current.worldName, generated.worldName),
    worldEra: fillIfEmpty(current.worldEra, generated.worldEra),
    worldConflict: '',
    worldTone: '',
    mainPlot: '',
    initialStoryState: '',
    gameRules: fillIfEmpty(current.gameRules, generated.gameRules),
    cast: existingCast,
  };
}

function mergePrivacyDraft(
  current: NovelCastCharacter['privacy'] | undefined,
  generated: NovelCastCharacter['privacy'] | undefined,
  nsfwEnabled: boolean,
): NovelCastCharacterPrivacy | undefined {
  // SFW: never accept AI privacy / erotic field output.
  if (!nsfwEnabled) {
    return normalizeCastPrivacyFields(current);
  }

  const cur = normalizeCastPrivacyFields(current) ?? {};
  const gen = normalizeCastPrivacyFields(generated) ?? {};

  return normalizeCastPrivacyFields({
    genitals: fillIfEmpty(cur.genitals ?? '', gen.genitals),
    chest: fillIfEmpty(cur.chest ?? '', gen.chest),
    erogenousZones: fillIfEmpty(cur.erogenousZones ?? '', gen.erogenousZones),
    scent: fillIfEmpty(cur.scent ?? '', gen.scent),
    xp: fillIfEmpty(cur.xp ?? '', gen.xp),
    masturbationHabits: fillIfEmpty(
      cur.masturbationHabits ?? '',
      gen.masturbationHabits,
    ),
    taboo: fillIfEmpty(cur.taboo ?? '', gen.taboo),
  });
}

function mergeCharacterDraft(
  current: NovelCastCharacter,
  generated: CharacterAiPayload,
  generatedDossier: unknown,
  generatedSummary: unknown,
  nsfwEnabled: boolean,
  lockedRelations?: NovelCastRelation[] | null,
): NovelCastCharacter {
  const privacy = mergePrivacyDraft(current.privacy, generated.privacy, nsfwEnabled);
  const baseRelations =
    current.relations?.length
      ? current.relations
      : generated.relations?.length
        ? generated.relations
        : undefined;
  // Locked bonds from other cards always win (roommate / kinship / etc.).
  const relations = mergeRelationsWithLocked(baseRelations, lockedRelations);
  const currentAliases = normalizeAliases(current.aliases);
  const aliases = (currentAliases.length ? currentAliases : normalizeAliases(generated.aliases))
    .filter((alias) => alias.toLowerCase() !== (current.name || asString(generated.name)).trim().toLowerCase())
    .slice(0, 6);

  const mergedCharacter: NovelCastCharacter = {
    ...current,
    name: fillIfEmpty(current.name, generated.name),
    aliases,
    profession: fillIfEmpty(current.profession, generated.profession),
    age: fillIfEmpty(current.age, generated.age),
    gender: fillIfEmpty(current.gender, generated.gender),
    height: fillIfEmpty(current.height, generated.height),
    weight: fillIfEmpty(current.weight, generated.weight),
    birthplace: fillIfEmpty(current.birthplace ?? '', generated.birthplace),
    affiliation: fillIfEmpty(current.affiliation ?? '', generated.affiliation),
    appearance: fillIfEmpty(current.appearance, generated.appearance),
    personality: fillIfEmpty(current.personality, generated.personality),
    speechStyle: fillIfEmpty(current.speechStyle, generated.speechStyle),
    background: fillIfEmpty(current.background, generated.background),
    motive: fillIfEmpty(current.motive ?? '', generated.motive),
    strengths: fillIfEmpty(current.strengths ?? '', generated.strengths),
    weaknesses: fillIfEmpty(current.weaknesses ?? '', generated.weaknesses),
    isProtagonist: current.isProtagonist === true,
    ...(relations ? { relations } : { relations: undefined }),
    ...(privacy ? { privacy } : { privacy: undefined }),
  };
  const dossierV2 = mergeCharacterDossierV2(
    current.dossierV2,
    generatedDossier,
    mergedCharacter,
    { includePrivate: nsfwEnabled },
  );
  const withDossier = { ...mergedCharacter, dossierV2 };
  return {
    ...withDossier,
    aiSummary: normalizeCharacterAiSummary(generatedSummary, withDossier, dossierV2),
  };
}

function buildFrameworkSystemPrompt() {
  return `你是沉浸式互动小说设定助手。根据用户的名称与介绍，生成一个完整可玩的小说世界框架。
主角由用户在「角色设定」中另行添加（使用角色卡 AI 生成按钮）；本阶段只生成世界。
只输出一个 JSON 对象，不要 Markdown，不要解释。

JSON 字段（全中文内容）：
{
  "worldName": "世界名称",
  "worldEra": "世界设定（时代、科技/魔法、社会规则、势力格局等；禁止引入任何具名人物）",
  "gameRules": "AI 扮演时需要遵守的法则（禁止引入具名人物）"
}

要求：
1. 不要生成任何主角字段（playerName / playerProfession / playerAge 等）。
2. 不要生成 cast / 配角列表。
3. worldEra 和 gameRules 中只写世界与规则，不出现任何具名人物。可用「修士」「凡人」「宗门」「王国」等泛称。
4. 设定与用户的作品介绍一致；若某字段用户已有内容，输出里对应键可省略。
5. 必须输出完整可解析的 JSON，不要截断。
6. 不要生成 mainPlot / initialStoryState / statusBar / 角色经历 等废弃字段。`;
}

function summarizeExistingCastForPrompt(
  existingCast: NovelCastCharacter[],
  excludeId?: string,
  maxChars = MAX_CAST_CONTEXT_CHARS,
): string {
  const others = existingCast.filter(
    (item) => item.id !== excludeId && item.name.trim(),
  );

  if (others.length === 0) {
    return '';
  }

  const lines = others.map((item, index) => {
    const role = item.isProtagonist ? '主角' : '配角';
    const relationText = formatCastRelationsText(item.relations);
    const bits = [
      `姓名=${item.name.trim()}`,
      `身份=${role}`,
      item.gender.trim() ? `性别=${item.gender.trim()}` : '',
      item.age.trim() ? `年龄=${item.age.trim()}` : '',
      item.profession.trim() ? `职业=${item.profession.trim()}` : '',
      item.affiliation?.trim() ? `阵营=${item.affiliation.trim().slice(0, 24)}` : '',
      item.personality.trim()
        ? `性格要点=${item.personality.trim().slice(0, 40)}`
        : '',
      item.motive?.trim() ? `动机=${item.motive.trim().slice(0, 30)}` : '',
      relationText
        ? `关联关系=${relationText.split('\n').join('；')}`
        : '',
    ].filter(Boolean);
    return `${index + 1}. ${bits.join('；')}`;
  });

  const reservedNames = others.map((item) => item.name.trim()).filter(Boolean);

  // 固定规则块（不可压缩）：防撞名硬约束始终完整保留。
  const fixedRules = [
    '新角色必须与上列每个人在姓名、外貌、性格、职业定位、语气上明显不同；不要复刻主角模板。',
    '禁止为了「融入群像」而硬把新角色挂到上列每个人身上：没有关系依据、也无剧情必要，就不要写与已有角色的关联。',
    '用户要求或原文证据已明确与某个已有角色的关系时，必须保留该人名和关系，不得随机换人。',
    '例外：若上列某人的「关联关系」已明确点名当前正在生成的名字（或你主动采用该未建卡姓名作为当前角色名），则必须继承那一条固定纽带，禁止改成无关或矛盾关系。',
  ].join('\n');
  const reservedNameBlock = `【禁用姓名】${reservedNames.join('、')}`;
  const header = `【已有角色（用于防撞名，也用于匹配用户要求或原文已明确的关系）】`;

  // 可压缩层：角色明细行按总预算裁剪（保留靠前角色），角色过多时不撑爆 prompt。
  const fixedLength = header.length + reservedNameBlock.length + fixedRules.length;
  const budget = Math.max(300, Math.round(maxChars));
  let keptLines = lines;
  for (let count = lines.length; count >= 1; count -= 1) {
    const candidate = lines.slice(0, count).join('\n');
    if (count === 1 || candidate.length + fixedLength <= budget) {
      keptLines = lines.slice(0, count);
      break;
    }
  }
  const dropped = lines.length - keptLines.length;

  return [
    header,
    ...keptLines,
    reservedNameBlock,
    ...(dropped > 0
      ? [`（另有 ${dropped} 位角色明细因字数限制省略，姓名仍列入【禁用姓名】）`]
      : []),
    fixedRules,
  ].join('\n');
}

/** 将续写分析产出的文风画像格式化为提示词块（无有效字段时返回空串）。 */
function formatStyleProfileForPrompt(profile?: NovelStyleProfile | null): string {
  if (!profile) {
    return '';
  }
  const parts = [
    profile.pointOfView?.trim() ? `视角：${profile.pointOfView.trim()}` : '',
    profile.sentenceLength?.trim() ? `句长：${profile.sentenceLength.trim()}` : '',
    profile.dialogueRatio?.trim() ? `对话比例：${profile.dialogueRatio.trim()}` : '',
    profile.pacing?.trim() ? `节奏：${profile.pacing.trim()}` : '',
    profile.languageFeatures?.trim() ? `语言风格：${profile.languageFeatures.trim()}` : '',
  ].filter(Boolean);
  return parts.length
    ? `【文风画像（设定描述须贴合小说正文风格）】${parts.join('；')}`
    : '';
}

function buildCharacterSystemPrompt(nsfwEnabled: boolean) {
  return buildCharacterGenerationSystemPrompt(nsfwEnabled);
}

/** Polish a novel narrative system prompt for injection into chat. */
export async function polishNovelSystemPrompt({
  apiSettings,
  novelCreateMaxTokens,
  draft,
  userNote = '',
  novelContext,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  draft: string;
  userNote?: string;
  /** Optional novel blurb so polish stays on-theme. */
  novelContext?: {
    name?: string;
    /** Unified work intro (display / create basis; not chat injection). */
    intro?: string;
    /** @deprecated Prefer intro */
    shortIntro?: string;
    /** @deprecated Prefer intro */
    detailedIntro?: string;
  };
}): Promise<string> {
  const seed = draft.trim() || DEFAULT_NOVEL_SYSTEM_PROMPT;
  const intro =
    novelContext?.intro?.trim() ||
    [novelContext?.shortIntro?.trim(), novelContext?.detailedIntro?.trim()]
      .filter(Boolean)
      .join('\n\n');
  const contextLines = [
    novelContext?.name?.trim() ? `名称：${novelContext.name.trim()}` : '',
    intro ? `作品介绍：${intro.slice(0, 600)}` : '',
  ].filter(Boolean);

  const raw = await requestPlainCompletion({
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
      maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 2500),
      temperature: Math.min(apiSettings.temperature, 0.65),
    },
    purpose: 'utility-create',
    messages: [
      {
        role: 'system',
        content: `你是互动小说「系统提示词」润色助手。把用户草稿润色成可直接注入叙事引擎的中文系统提示词。
要求：
1. 只输出润色后的提示词正文，不要 Markdown 代码块、标题、前后解释。
2. 默认第三人称小说叙事（不是第二人称带入扮演）；可保留用户指定的文风要求。
3. 只写叙事引擎规则：视角、连贯、人设/记忆一致性、可续写；附加规则由独立的破限词与 MOD 配置负责。
4. 可用简短条目，控制在约 150～350 字，避免空话与重复。`,
      },
      {
        role: 'user',
        content: [
          contextLines.length ? `【小说上下文】\n${contextLines.join('\n')}` : '',
          `【当前草稿】\n${seed}`,
          userNote.trim() ? `【用户补充要求】\n${userNote.trim()}` : '',
          '请润色为可注入的小说系统提示词。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const polished = raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!polished) {
    throw new Error('AI 未返回可用的提示词。');
  }

  return polished;
}

/**
 * Summarize a novel sample into a short【文风】directive for the system prompt.
 */
export async function summarizeWritingStyleFromNovelSample({
  apiSettings,
  novelCreateMaxTokens,
  sampleText,
  maxChars = 160,
  sourceName = '',
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  sampleText: string;
  maxChars?: number;
  sourceName?: string;
}): Promise<string> {
  const sample = sampleText.trim();
  if (!sample) {
    throw new Error('没有可用的小说样本文本。');
  }

  const cap = Math.max(60, Math.min(300, Math.round(maxChars)));
  const raw = await requestPlainCompletion({
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
      maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 800),
      temperature: Math.min(apiSettings.temperature, 0.55),
    },
    purpose: 'utility-create',
    messages: [
      {
        role: 'system',
        content: `你是网文/小说文风分析师。根据样本文本，提炼可注入叙事引擎的「文风指令」。
要求：
1. 只输出文风指令正文，不要标题、Markdown、书名号外的解释。
2. 写清：叙事人称与视角、句式节奏、用词气质、对话/心理/环境描写偏好、常见套路或禁忌（如少说教、少排比堆砌等）。
3. 不要复述剧情，不要抄长段原文，不要编造样本文没有的风格。
4. 全文不超过 ${cap} 个汉字（标点计入）。
5. 语气像系统指令，可分 3～6 条短句或短列表。
6. 若样本含多段截取（以 … 分隔），请归纳全书稳定文风，勿当成连续情节。`,
      },
      {
        role: 'user',
        content: [
          sourceName.trim() ? `【来源文件】${sourceName.trim()}` : '',
          `【字数上限】${cap}`,
          '【小说样本（全书多处截取，请归纳稳定文风）】',
          sample,
          '请输出可直接拼进系统提示词的文风指令。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const summary = raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^【文风】\s*/u, '')
    .trim();

  if (!summary) {
    throw new Error('AI 未返回可用的文风总结。');
  }

  return summary;
}

/** Edit an author-supplied writing extension without inventing new rules. */
export async function polishWritingExtensionPrompt({
  apiSettings,
  novelCreateMaxTokens,
  draft,
  userNote = '',
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  draft: string;
  userNote?: string;
}): Promise<string> {
  const seed = draft.trim();
  if (!seed) throw new Error('请先填写提示词。');
  const raw = await requestPlainCompletion({
    apiSettings: {
      ...apiSettings,
      streamingEnabled: false,
      thinkingDisabled: true,
      maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 1200),
      temperature: Math.min(apiSettings.temperature, 0.7),
    },
    purpose: 'utility-create',
    messages: [
      {
        role: 'system',
        content: `你是小说提示词编辑。整理用户提供的提示词草稿，使表达清晰、结构简洁。
要求：
1. 只输出润色后的提示词正文，不要 Markdown 代码块、标题或解释。
2. 保留用户原意与已有规则，不扩充新的要求。
3. 按草稿实际内容组织段落，消除重复和歧义。
4. 控制在约 200～500 字。`,
      },
      {
        role: 'user',
        content: [
          `【当前草稿】\n${seed}`,
          userNote.trim() ? `【用户补充要求】\n${userNote.trim()}` : '',
          '请整理这段小说提示词。',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  });

  const polished = raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!polished) {
    throw new Error('AI 未返回可用的提示词。');
  }

  return polished;
}

export async function generateNovelFramework({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  shortIntro,
  detailedIntro,
  userBrief = '',
  current,
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  /** Unified work intro — primary generation basis. */
  intro?: string;
  /** @deprecated Prefer intro */
  shortIntro?: string;
  /** @deprecated Prefer intro */
  detailedIntro?: string;
  /** Optional extra note; usually empty when intro is the brief. */
  userBrief?: string;
  current: NovelFrameworkDraft;
  /** 回调本次生成的 token 用量（供 UI 统计）。 */
  onUsage?: (usage: CreateAiUsage) => void;
}): Promise<NovelFrameworkDraft> {
  const workIntro =
    intro?.trim() ||
    [shortIntro?.trim(), detailedIntro?.trim()].filter(Boolean).join('\n\n');

  const userContent = [
    `【小说名称】${novelName.trim() || '未命名'}`,
    workIntro
      ? `【作品介绍】${workIntro}`
      : '【作品介绍】（未填写，请根据名称生成世界框架）',
    userBrief.trim() ? `【补充要求】${userBrief.trim()}` : '',
    `【当前已有设定（非空项请勿覆盖）】\n${JSON.stringify(
      {
        worldName: current.worldName,
        worldEra: current.worldEra,
        worldConflict: current.worldConflict,
        worldTone: current.worldTone,
        gameRules: current.gameRules,
      },
      null,
      2,
    )}`,
    '【硬性约束】worldEra / gameRules 中禁止出现任何具名人物；不要输出 mainPlot / initialStoryState / protagonist / player 字段。',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { raw, usage } = await requestCreateCompletion({
    apiSettings,
    maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 8000),
    temperature: Math.min(apiSettings.temperature, 0.85),
    purpose: NOVEL_CREATE_USAGE_TASKS.framework,
    systemPrompt: buildFrameworkSystemPrompt(),
    userContent,
    validate: (text) => {
      const payload = extractJsonObject(text);
      if (!isPlainObject(payload)) return false;
      return [payload.worldName, payload.worldEra, payload.gameRules]
        .some((value) => typeof value === 'string' && value.trim().length > 0);
    },
  });

  const parsed = extractJsonObject(raw) as FrameworkAiPayload;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回格式无效。');
  }

  const merged = mergeFrameworkDraft(current, parsed);
  onUsage?.(usage);
  return merged;
}

export async function generateNovelCastCharacter({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  shortIntro,
  detailedIntro,
  framework,
  current,
  existingCast = [],
  userBrief = '',
  nsfwEnabled = false,
  nsfwPrompt: _nsfwPrompt,
  onUsage,
  styleProfile,
  worldContext,
  contextMode = 'full',
  enableQualityAudit = false,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro?: string;
  /** @deprecated Prefer intro */
  shortIntro?: string;
  /** @deprecated Prefer intro */
  detailedIntro?: string;
  framework: Omit<NovelFrameworkDraft, 'cast'>;
  current: NovelCastCharacter;
  /** Other cast cards already on this novel — used to avoid clones. */
  existingCast?: NovelCastCharacter[];
  userBrief?: string;
  /** When true, AI should fill privacy erotic fields; when false, strip/ignore them. */
  nsfwEnabled?: boolean;
  /**
   * Ignored for cast create. Writing extensions only apply to prose generation;
   * dossiers use their own field-specific prompt.
   * @deprecated
   */
  nsfwPrompt?: string;
  /** 回调本次生成（含可选纠错/自检修订）累计 token 用量。 */
  onUsage?: (usage: CreateAiUsage) => void;
  /** 已有小说的文风画像（续写分析产物），注入生成提示词以保持文风一致。 */
  styleProfile?: NovelStyleProfile | null;
  /** Current quick-travel world context; kept separate from the novel-level framework. */
  worldContext?: string;
  /** Use a compact world-only context when generating from imported text. */
  contextMode?: 'full' | 'compact';
  /**
   * 是否在生成后同步执行关系校验与自检修订。默认关闭，避免一次点击
   * 串行触发多次模型请求；需要高质量复核时可由显式操作开启。
   */
  enableQualityAudit?: boolean;
}): Promise<NovelCastCharacter> {
  const allowNsfw = nsfwEnabled === true;
  const workIntro =
    intro?.trim() ||
    [shortIntro?.trim(), detailedIntro?.trim()].filter(Boolean).join('\n\n');
  const existingSummary = summarizeExistingCastForPrompt(
    existingCast,
    current.id,
    MAX_CAST_CONTEXT_CHARS,
  );
  const styleProfileBlock = formatStyleProfileForPrompt(styleProfile);
  const explicitBriefName = extractExplicitCharacterName(userBrief);
  const requestedName = (explicitBriefName || current.name.trim()).toLowerCase();
  const requestedExistingCharacter = existingCast.find(
    (item) => item.id !== current.id && item.name.trim().toLowerCase() === requestedName,
  );
  const reservedNames = new Set(
    existingCast
      .filter(
        (item) =>
          item.id !== current.id &&
          item.name.trim() &&
          item.id !== requestedExistingCharacter?.id,
      )
      .map((item) => item.name.trim().toLowerCase()),
  );
  const creatingNew = !current.name.trim();
  // The first protagonist card may still have an empty draft because the
  // user selects「是否主角」after opening the card. An empty cast is the
  // unambiguous first-card case; later supporting cards must remain free to
  // use their own names even if an old draft has no marked protagonist.
  const shouldAnchorFrameworkProtagonist = current.isProtagonist === true || existingCast.length === 0;
  const protagonistNameAnchor =
    current.name.trim() ||
    explicitBriefName ||
    (shouldAnchorFrameworkProtagonist ? framework.playerName.trim() : '');
  const explicitBriefGender = extractExplicitCharacterGender(userBrief);
  const protagonistGenderAnchor =
    current.gender.trim() ||
    explicitBriefGender ||
    (shouldAnchorFrameworkProtagonist
      ? framework.playerGender.trim()
      : '');
  const normalizedWorldContext = typeof worldContext === 'string' ? worldContext.trim() : '';
  const temperature = creatingNew
    ? Math.min(Math.max(apiSettings.temperature, 0.85), 1)
    : Math.min(apiSettings.temperature, 0.75);
  const quickTravelProtagonistCore = normalizedWorldContext && contextMode !== 'compact'
    ? {
        playerName: framework.playerName,
        playerPersona: framework.playerPersona,
        playerMotive: framework.playerMotive,
        playerGender: framework.playerGender,
        playerAge: framework.playerAge,
        playerPersonality: framework.playerPersonality,
        playerSpeechStyle: framework.playerSpeechStyle,
        playerBackground: framework.playerBackground,
        playerHabits: framework.playerHabits,
        playerStrengths: framework.playerStrengths,
        playerWeaknesses: framework.playerWeaknesses,
        playerSecrets: framework.playerSecrets,
      }
    : null;

  function resolveLockedRelations(nameHint?: string | null) {
    const subject = {
      id: current.id,
      name: nameHint?.trim() || current.name,
    };
    const fromCast = buildLockedReciprocalRelations(existingCast, subject);
    return fromCast;
  }

  async function requestOnce(extraUserNote = '') {
    const effectiveCurrent =
      creatingNew && (protagonistNameAnchor || protagonistGenderAnchor)
        ? {
            ...current,
            ...(protagonistNameAnchor ? { name: protagonistNameAnchor } : {}),
            ...(protagonistGenderAnchor ? { gender: protagonistGenderAnchor } : {}),
          }
        : current;
    const lockedRelations = resolveLockedRelations(effectiveCurrent.name);
    const lockedBlock = formatLockedRelationsForPrompt(lockedRelations);
    // Seed draft relations so AI sees locks even when current.relations is empty.
    const draftRelations =
      mergeRelationsWithLocked(current.relations, lockedRelations) ?? [];
    const effectiveWorldContext =
      normalizedWorldContext ||
      [
        framework.worldName?.trim() ? `世界名称：${framework.worldName.trim()}` : '',
        framework.worldEra?.trim() ? `时代与设定：${framework.worldEra.trim()}` : '',
        framework.gameRules?.trim() ? `世界规则：${framework.gameRules.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    // 上下文分层（借鉴续写管线 buildRewriteContext）：
    // 不可压缩层 = 必守约束（框架 / 已锁定关系 / 用户要求 / 当前草稿）；
    // 可压缩层 = 已有角色摘要（仅防撞名参考，受字符预算约束）。
    const protectedParts = [
      `【小说名称】${novelName.trim() || '未命名'}`,
      normalizedWorldContext
        ? ''
        : workIntro
          ? `【作品介绍】${workIntro}`
          : '',
      effectiveWorldContext
        ? `【当前小世界约束】\n${effectiveWorldContext}\n这里只能使用这个当前小世界的时代、规则、任务和身份设定。其他小世界、外层小说世界和完整原定剧情不属于本次角色生成上下文。当前角色必须服从这个小世界，不能继承外层无限流主世界的职业、背景、阵营或剧情。已有角色卡只以【已有角色】区块为准。`
        : `【世界与主角框架】\n${JSON.stringify(framework, null, 2)}`,
      quickTravelProtagonistCore
        ? `【跨世界主角核心】\n${JSON.stringify(quickTravelProtagonistCore, null, 2)}\n当前角色的姓名、职业、外貌、家庭和社会关系以当前小世界角色卡为准，不要把主角核心卡的身份字段直接复制成当前世界身份。`
        : '',
      lockedBlock,
      userBrief.trim()
        ? `【用户人物设定描述】${userBrief.trim()}`
        : '【用户人物设定描述】（未额外填写；请原创补全，与已有角色明显差分；关系勿硬挂已有角色）',
      protagonistNameAnchor
        ? `【角色姓名硬约束】${protagonistNameAnchor}\n这是作者已经确定的当前主角/角色姓名，必须原样保留，不得改成其他人物或另造姓名。`
        : '',
      protagonistGenderAnchor
        ? `【角色性别硬约束】${protagonistGenderAnchor}\n这是作者已经确定的当前主角/角色性别，必须保持一致，不得根据姓名或模型偏好改写。`
        : '',
      requestedExistingCharacter
        ? `【用户指定的当前世界已有角色】\n${JSON.stringify(requestedExistingCharacter, null, 2)}\n这是当前小世界中已经建立的角色卡。请沿用其姓名、身份、背景和关系进行补全，不要把它当作新角色，也不要改名。`
        : '',
      styleProfileBlock,
      `【内容模式】${allowNsfw ? 'NSFW（需补全隐私词条）' : 'SFW（禁止色情词条）'}`,
      `【当前角色草稿（非空项请勿覆盖）】\n${JSON.stringify(
        {
          name: effectiveCurrent.name,
          profession: effectiveCurrent.profession,
          age: effectiveCurrent.age,
          gender: effectiveCurrent.gender,
          height: effectiveCurrent.height,
          weight: effectiveCurrent.weight,
          birthplace: effectiveCurrent.birthplace ?? '',
          affiliation: effectiveCurrent.affiliation ?? '',
          appearance: effectiveCurrent.appearance,
          personality: effectiveCurrent.personality,
          speechStyle: effectiveCurrent.speechStyle,
          background: effectiveCurrent.background,
          motive: effectiveCurrent.motive ?? '',
          strengths: effectiveCurrent.strengths ?? '',
          weaknesses: effectiveCurrent.weaknesses ?? '',
          relations: draftRelations,
          dossierV2: normalizeCharacterDossierV2(effectiveCurrent.dossierV2, effectiveCurrent),
          aiSummary: effectiveCurrent.aiSummary,
        },
        null,
        2,
      )}`,
      creatingNew
        ? '这是新建角色：姓名留空时必须原创新名；严禁使用【禁用姓名】中的任何名字。用户描述或原文证据已明确人物关系时，必须原样写入 relations，不得随机换人或追加无关关系；完全没有关系信息时才补 1～2 条合理人际。'
        : '这是补全已有草稿：保留已有非空字段，只填空缺。',
      'background 只写此人自身出身与过往；人际写入 relations。用户要求、原文证据、当前草稿和已锁定关系的优先级高于自由补全。不要输出 habits / secrets / notes。',
      draftRelations.length || lockedRelations.length
        ? '已有明确关系：必须全部保留，不得为了凑数追加随机具名人物。'
        : '目前没有明确关系：只补充 1～2 条符合身份、背景和当前世界的合理人际，不得批量造人。',
      allowNsfw
        ? '请按专用档案规则补全 dossierV2.private 的空缺项。不要输出旧版 privacy / playerPrivacy 字段。'
        : '请补全空缺字段；不要输出任何色情词条。',
    ];
    const compressibleParts = [existingSummary];

    const userContent = [
      ...protectedParts,
      ...compressibleParts,
      extraUserNote,
    ]
      .filter(Boolean)
      .join('\n\n');

    const { raw, usage } = await requestCreateCompletion({
      apiSettings,
      maxTokens: resolveNovelCastMaxTokens(novelCreateMaxTokens),
      temperature,
      purpose: NOVEL_CREATE_USAGE_TASKS.cast,
      systemPrompt: buildCharacterSystemPrompt(allowNsfw),
      userContent,
      validate: (text) => {
        const parsed = extractJsonObject(text) as CharacterGenerationAiPayload | null;
        if (!parsed || !isPlainObject(parsed.cast)) return false;
        const name = fillIfEmpty(effectiveCurrent.name, asString(parsed.cast.name));
        return Boolean(name.trim());
      },
    });

    const parsed = extractJsonObject(raw) as CharacterGenerationAiPayload;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI 返回格式无效。');
    }

    const parsedCast = parsed.cast;
    if (!parsedCast || typeof parsedCast !== 'object') {
      throw new Error('AI 返回缺少 cast 角色字段。');
    }

    const payload: CharacterAiPayload = {
      ...parsedCast,
      relations: normalizeAiRelations(parsedCast.relations),
    };

    const mergedName = fillIfEmpty(effectiveCurrent.name, payload.name);
    // Re-resolve locks after name is known (new card may adopt an off-cast name).
    const lockedForMerge = resolveLockedRelations(mergedName);
    const merged = mergeCharacterDraft(
      effectiveCurrent,
      payload,
      parsed.dossierV2,
      parsed.aiSummary,
      allowNsfw,
      lockedForMerge,
    );
    if (!merged.name.trim()) {
      throw new Error('AI 未生成角色姓名。');
    }

    return { merged, usage };
  }

  let totalUsage: CreateAiUsage = { promptTokens: 0, completionTokens: 0 };

  const first = await requestOnce();
  totalUsage = mergeUsage(totalUsage, first.usage);
  let merged = first.merged;
  const collided = reservedNames.has(merged.name.trim().toLowerCase());
  if (collided) {
    const retry = await requestOnce(
      `【纠错】上一稿姓名「${merged.name.trim()}」与已有角色撞名。必须更换全新姓名，并加大外貌/性格/职业差分，禁止只改一两个字。`,
    );
    totalUsage = mergeUsage(totalUsage, retry.usage);
    merged = retry.merged;
    if (reservedNames.has(merged.name.trim().toLowerCase())) {
      throw new Error(
        `生成结果与已有角色「${merged.name.trim()}」重名。请换描述后再试，或先改姓名。`,
      );
    }
  }

  // 新建角色走「自检 → 修订 → 采用判定」闭环，保证与框架/已有卡一致、避免套话。
  if (creatingNew && enableQualityAudit) {
    const audited = await selfAuditAndReviseJson({
      apiSettings,
      maxTokens: resolveNovelCastMaxTokens(novelCreateMaxTokens, 3600),
      temperature,
      purpose: NOVEL_CREATE_USAGE_TASKS.cast,
      auditContext: [
        `【小说名称】${novelName.trim() || '未命名'}`,
        workIntro ? `【作品介绍】${workIntro}` : '',
        `【世界与主角框架】\n${JSON.stringify(framework, null, 2)}`,
        styleProfileBlock,
        `【已有角色（防撞名）】\n${existingSummary}`,
        `【内容模式】${allowNsfw ? 'NSFW（需补全隐私词条）' : 'SFW（禁止色情词条）'}`,
        `【本次约束】新角色须保留用户要求和原文中明确的人物关系；完全没有关系信息时才补 1～2 条合理人际。`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      draft: merged,
      encode: (draft) =>
        JSON.stringify(
          {
            cast: {
              name: draft.name,
              profession: draft.profession,
              age: draft.age,
              gender: draft.gender,
              height: draft.height,
              weight: draft.weight,
              birthplace: draft.birthplace,
              affiliation: draft.affiliation,
              appearance: draft.appearance,
              personality: draft.personality,
              speechStyle: draft.speechStyle,
              background: draft.background,
              motive: draft.motive,
              strengths: draft.strengths,
              weaknesses: draft.weaknesses,
              relations: draft.relations,
            },
            dossierV2: draft.dossierV2,
            aiSummary: draft.aiSummary,
          },
          null,
          2,
        ),
      decode: (raw) => {
        try {
          const parsed = extractJsonObject(raw) as CharacterGenerationAiPayload;
          const normalized = normalizeAiCastCharacter(parsed.cast);
          if (!normalized?.name?.trim()) {
            return null;
          }
          const revised: NovelCastCharacter = {
            ...merged,
            ...normalized,
            id: merged.id,
            isProtagonist: merged.isProtagonist === true,
            relations: normalizeAiRelations(parsed.cast?.relations) ?? merged.relations,
            portraitUri: merged.portraitUri,
            portraitFocus: merged.portraitFocus,
          };
          const dossierV2 = mergeCharacterDossierV2(
            merged.dossierV2,
            parsed.dossierV2,
            revised,
            { includePrivate: allowNsfw },
          );
          const withDossier = { ...revised, dossierV2 };
          return {
            ...withDossier,
            aiSummary: normalizeCharacterAiSummary(
              parsed.aiSummary ?? merged.aiSummary,
              withDossier,
              dossierV2,
            ),
          };
        } catch {
          return null;
        }
      },
    });
    merged = audited.value;
    totalUsage = mergeUsage(totalUsage, audited.usage);
  }

  const finalDossier = normalizeCharacterDossierV2(merged.dossierV2, merged);
  merged = {
    ...merged,
    dossierV2: finalDossier,
    aiSummary: normalizeCharacterAiSummary(merged.aiSummary, merged, finalDossier),
  };
  onUsage?.(totalUsage);
  return merged;
}

export function createEmptyCastCharacter(
  options?: { isProtagonist?: boolean },
): NovelCastCharacter {
  return {
    id: createCastId(),
    name: '',
    profession: '',
    age: '',
    gender: '',
    height: '',
    weight: '',
    birthplace: '',
    affiliation: '',
    appearance: '',
    personality: '',
    speechStyle: '',
    background: '',
    isProtagonist: options?.isProtagonist === true,
    motive: '',
    strengths: '',
    weaknesses: '',
  };
}

type LoreAiPayload = {
  type?: string;
  name?: string;
  aliases?: string[] | string;
  content?: string;
};

type LoreBatchAiEntry = {
  type?: string;
  name?: string;
  aliases?: string[] | string;
  content?: string;
};

type LoreBatchAiPayload = {
  entries?: LoreBatchAiEntry[];
};

export type NovelLoreBatchCounts = Record<NovelLoreTypeId, number>;

export type NovelLoreBatchDraft = {
  requested: NovelLoreBatchCounts;
  entries: NovelLoreEntry[];
};

function validateLoreBatchCounts(
  counts: NovelLoreBatchCounts,
): NovelLoreBatchCounts {
  const normalized = Object.fromEntries(
    NOVEL_LORE_TYPES.map((type) => [type, Number(counts[type])]),
  ) as NovelLoreBatchCounts;
  if (NOVEL_LORE_TYPES.some((type) => !Number.isInteger(normalized[type]) || normalized[type] < 0)) {
    throw new Error('各类设定数量必须是非负整数。');
  }

  const total = NOVEL_LORE_TYPES.reduce((sum, type) => sum + normalized[type], 0);
  if (total < 1) {
    throw new Error('请至少生成 1 条设定。');
  }
  if (total > MAX_NOVEL_LORE_BATCH_TOTAL) {
    throw new Error(`单次最多生成 ${MAX_NOVEL_LORE_BATCH_TOTAL} 条设定。`);
  }

  return normalized;
}

function readLoreBatchEntries(raw: string): LoreBatchAiEntry[] {
  const parsed = extractJsonObject(raw) as LoreBatchAiPayload;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error('AI 返回格式无效，缺少 entries 数组。');
  }
  return parsed.entries;
}

function normalizeLoreBatchAliases(value: string[] | string | undefined): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、|]/)
      : [];
  return raw
    .map((item) => asString(item))
    .filter(Boolean)
    .filter((item, index, list) =>
      list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index,
    )
    .slice(0, 3);
}

function parseLoreBatchChunk({
  raw,
  expectedType,
  expectedCount,
  reservedNames,
}: {
  raw: string;
  expectedType: NovelLoreTypeId;
  expectedCount: number;
  reservedNames: Set<string>;
}): NovelLoreEntry[] {
  const rows = readLoreBatchEntries(raw);
  const chunkNames = new Set<string>();
  const entries: NovelLoreEntry[] = [];
  rows.forEach((row) => {
    if (!row || typeof row !== 'object' || row.type !== expectedType) {
      return;
    }

    const name = asString(row.name);
    const content = asString(row.content).slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH);
    const normalizedName = name.toLowerCase();
    if (!name || !content) {
      return;
    }
    if (reservedNames.has(normalizedName) || chunkNames.has(normalizedName)) {
      return;
    }
    chunkNames.add(normalizedName);
    entries.push(normalizeLoreEntry({
      id: generateId('lore'),
      type: expectedType,
      name,
      aliases: normalizeLoreBatchAliases(row.aliases),
      content,
      enabled: true,
      updatedAt: new Date().toISOString(),
    }));
  });
  if (entries.length === 0) {
    throw new Error(`AI 返回的 ${expectedType} 设定没有可用条目（期望 ${expectedCount} 条）。`);
  }
  return entries.slice(0, expectedCount);
}

function buildLoreBatchSystemPrompt(type: NovelLoreTypeId, count: number) {
  const typeLabel = NOVEL_LORE_TYPE_LABELS[type];
  const focus: Record<NovelLoreTypeId, string> = {
    world: '世界规则、历史、制度、力量体系、社会秩序或重要文化。每条必须有可被剧情提及的专名。',
    location: '城池、区域、建筑或特殊空间。说明环境特征、限制，以及能够推动剧情的作用。',
    faction: '组织、门派、阵营或家族。说明目标、资源、内部秩序、外部关系与行动方式。',
    item: '兵器、法宝、道具、资源或遗物。说明外观、能力、限制、持有或流转关系。',
    lore: '制度、功法、习俗、传闻或历史事件。说明适用范围、影响与不能违反的边界。',
    custom: '根据用户指定的分卷主题生成可独立触发的资料。每条都要有明确专名和稳定事实。',
  };
  return `你是互动小说世界设定编辑。请生成恰好 ${count} 条${typeLabel}候选稿，供作者审阅，不得少于或多于 ${count} 条。
只输出一个 JSON 对象，不要 Markdown，不要解释。

JSON 格式：
{"entries":[{"type":"${type}","name":"专名","aliases":["简称"],"content":"设定正文"}]}

要求：
1. entries 数组长度必须恰好为 ${count}，每条 type 必须是 ${type}。
2. ${focus[type]}
3. 每条 content 不超过 ${MAX_NOVEL_LORE_CONTENT_LENGTH} 字，使用具体、可用于创作的细节。
4. 名称不得互相重复，也不得使用用户提供的已有名称。
5. aliases 提供 0 到 3 个自然简称或别称。
6. 禁止生成具名角色，不要堆砌百科条目，不要写空泛赞美。
7. 与小说已有世界设定保持一致，不要覆盖已有资料。
8. 必须输出完整可解析的 JSON。`;
}

/**
 * Generate world-building and location candidates without persisting them.
 * Results are split into small requests. Complete candidates survive damaged
 * rows and failed batches so the author can still review the usable results.
 */
export async function generateNovelLoreDraftBatch({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  worldName,
  worldEra,
  counts,
  existingEntries = [],
  userBrief = '',
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro?: string;
  worldName?: string;
  worldEra?: string;
  counts: NovelLoreBatchCounts;
  existingEntries?: NovelLoreEntry[];
  userBrief?: string;
  onUsage?: (usage: CreateAiUsage) => void;
}): Promise<NovelLoreBatchDraft> {
  const requested = validateLoreBatchCounts(counts);
  const reservedNames = new Set(
    existingEntries
      .map((item) => item.name.trim().toLowerCase())
      .filter(Boolean),
  );
  const existingSummary = existingEntries.length
    ? existingEntries
        .filter((item) => item.name.trim())
        .map((item) => `[${NOVEL_LORE_TYPE_LABELS[item.type]}] ${item.name.trim()}`)
        .join('、')
    : '暂无';
  const entries: NovelLoreEntry[] = [];

  const jobs: { type: NovelLoreTypeId; count: number }[] = [];
  for (const type of NOVEL_LORE_TYPES) {
    let remaining = requested[type];
    while (remaining > 0) {
      const count = Math.min(remaining, MAX_NOVEL_LORE_BATCH_CHUNK);
      jobs.push({ type, count });
      remaining -= count;
    }
  }

  let batchFailure: unknown;
  for (const job of jobs) {
    const userContent = [
      `【小说名称】${novelName.trim() || '未命名'}`,
      intro?.trim() ? `【作品介绍】${intro.trim()}` : '',
      worldName?.trim() ? `【世界名称】${worldName.trim()}` : '',
      worldEra?.trim() ? `【核心世界设定】${worldEra.trim()}` : '',
      `【已有设定名称】${existingSummary}`,
      entries.length
        ? `【本次已生成名称】${entries.map((item) => item.name).join('、')}`
        : '',
      userBrief.trim()
        ? `【本次创作要求】${userBrief.trim()}`
        : '【本次创作要求】围绕主线提供能推动剧情的具体资料。',
    ].filter(Boolean).join('\n\n');

    let decoded: NovelLoreEntry[] = [];
    let response: Awaited<ReturnType<typeof requestCreateCompletion>>;
    try {
      response = await requestCreateCompletion({
        apiSettings,
        maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 4000),
        temperature: Math.min(Math.max(apiSettings.temperature, 0.7), 0.9),
        purpose: NOVEL_CREATE_USAGE_TASKS.lore,
        systemPrompt: buildLoreBatchSystemPrompt(job.type, job.count),
        userContent,
        validate: (candidate) => {
          decoded = parseLoreBatchChunk({
            raw: candidate,
            expectedType: job.type,
            expectedCount: job.count,
            reservedNames,
          });
          return true;
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      batchFailure = error;
      continue;
    }
    const { raw, usage } = response;

    if (decoded.length === 0) {
      decoded = parseLoreBatchChunk({
        raw,
        expectedType: job.type,
        expectedCount: job.count,
        reservedNames,
      });
    }
    for (const entry of decoded) {
      reservedNames.add(entry.name.trim().toLowerCase());
      entries.push(entry);
    }
    onUsage?.(usage);
  }

  if (!entries.length && batchFailure) throw batchFailure;
  return { requested, entries };
}

function buildLoreSystemPrompt() {
  return `你是互动小说设定助手。根据小说背景与用户描述，为「当前正在编辑的这一条设定」生成/补全字段。
只输出一个 JSON 对象，不要 Markdown，不要解释。

JSON 字段：
{
  "type": "world|location|faction|item|lore|custom 之一",
  "name": "设定名称（专名，可作触发词）",
  "aliases": ["别名1", "别名2"],
  "content": "设定正文（简洁、可注入对话上下文）"
}

类型说明：
- world：平行世界 / 副本世界总纲（快穿等）
- location：地点、城池、空间
- faction：势力、门派、组织
- item：神器、兵器、关键道具
- lore：制度、历史、规则、功法等杂项设定
- custom：其他

硬性要求：
1. 只生成「当前这一条」，不要一次输出多条。
2. 禁止生成具名配角/人物卡；不要写角色外貌性格；可用「某人 / 守卫 / 宗门弟子」等泛称。
3. 当前草稿里已有非空字段不要改写成冲突内容；可省略这些键。
4. content 控制在 ${MAX_NOVEL_LORE_CONTENT_LENGTH} 字以内，具体可扮演，避免空话。
5. aliases 要覆盖对话里可能出现的叫法（简称、别称），通常 0～3 个。
6. 与给定小说世界一致；不要引入无关世界观。
7. 必须输出完整可解析的 JSON，不要截断。
8. 若用户已指定 type，保持该 type，不要擅自改类。
${CREATE_ANTI_AI_RULES}`;
}

function mergeLoreDraft(
  current: NovelLoreEntry,
  generated: LoreAiPayload,
  preferredType?: NovelLoreTypeId,
): NovelLoreEntry {
  const type: NovelLoreTypeId = isNovelLoreTypeId(preferredType)
    ? preferredType
    : isNovelLoreTypeId(generated.type)
      ? generated.type
      : current.type;

  const aliasesRaw = generated.aliases;
  const nextAliases = Array.isArray(aliasesRaw)
    ? aliasesRaw.map((item) => asString(item)).filter(Boolean)
    : typeof aliasesRaw === 'string'
      ? aliasesRaw
          .split(/[,，、|]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  return normalizeLoreEntry({
    ...current,
    type,
    name: fillIfEmpty(current.name, asString(generated.name)),
    aliases: current.aliases.length > 0 ? current.aliases : nextAliases,
    content: fillIfEmpty(current.content, asString(generated.content)),
    enabled: current.enabled !== false,
    updatedAt: new Date().toISOString(),
  });
}

export async function generateNovelLoreEntry({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  worldName,
  worldEra,
  current,
  existingEntries = [],
  userBrief = '',
  preferredType,
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro?: string;
  worldName?: string;
  worldEra?: string;
  current: NovelLoreEntry;
  existingEntries?: NovelLoreEntry[];
  userBrief?: string;
  preferredType?: NovelLoreTypeId;
  /** 回调本次生成 token 用量（供 UI 统计）。 */
  onUsage?: (usage: CreateAiUsage) => void;
}): Promise<NovelLoreEntry> {
  const workIntro = intro?.trim() || '';
  const reservedNames = new Set(
    existingEntries
      .filter((item) => item.id !== current.id && item.name.trim())
      .map((item) => item.name.trim().toLowerCase()),
  );
  const existingSummary =
    existingEntries.filter((item) => item.id !== current.id && item.name.trim()).length > 0
      ? [
          '【已有设定（禁止撞名）】',
          ...existingEntries
            .filter((item) => item.id !== current.id && item.name.trim())
            .map(
              (item, index) =>
                `${index + 1}. [${NOVEL_LORE_TYPE_LABELS[item.type]}] ${item.name.trim()}`,
            ),
          `【禁用名称】${[...reservedNames].join('、')}`,
        ].join('\n')
      : '【已有设定】（暂无）';

  const creatingNew = !current.name.trim();
  const lockedType = isNovelLoreTypeId(preferredType)
    ? preferredType
    : isNovelLoreTypeId(current.type)
      ? current.type
      : undefined;

  const userContent = [
    `【小说名称】${novelName.trim() || '未命名'}`,
    workIntro ? `【作品介绍】${workIntro}` : '',
    worldName?.trim() ? `【世界名称】${worldName.trim()}` : '',
    worldEra?.trim() ? `【世界设定】${worldEra.trim()}` : '',
    existingSummary,
    userBrief.trim()
      ? `【用户设定描述】${userBrief.trim()}`
      : '【用户设定描述】（未额外填写；请原创补全一条有用设定）',
    lockedType
      ? `【指定类型】${lockedType}（${NOVEL_LORE_TYPE_LABELS[lockedType]}）——必须使用此 type`
      : '',
    `【当前设定草稿（非空项请勿覆盖）】\n${JSON.stringify(
      {
        type: current.type,
        name: current.name,
        aliases: current.aliases,
        content: current.content,
      },
      null,
      2,
    )}`,
    creatingNew
      ? '这是新建设定：名称留空时必须原创新名；严禁使用【禁用名称】中的任何名字。'
      : '这是补全已有草稿：保留已有非空字段，只填空缺。',
    '禁止输出任何角色人设字段；不要编造具名配角。',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { raw, usage } = await requestCreateCompletion({
    apiSettings,
    maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 4000),
    temperature: creatingNew
      ? Math.min(Math.max(apiSettings.temperature, 0.75), 0.95)
      : Math.min(apiSettings.temperature, 0.7),
    purpose: NOVEL_CREATE_USAGE_TASKS.lore,
    systemPrompt: buildLoreSystemPrompt(),
    userContent,
    validate: (text) => {
      const payload = extractJsonObject(text) as LoreAiPayload;
      const merged = mergeLoreDraft(current, payload, lockedType);
      return Boolean(merged.name.trim() && merged.content.trim() && !reservedNames.has(merged.name.trim().toLowerCase()));
    },
  });

  const parsed = extractJsonObject(raw) as LoreAiPayload;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回格式无效。');
  }

  const merged = mergeLoreDraft(current, parsed, lockedType);
  if (!merged.name.trim()) {
    throw new Error('生成结果缺少设定名称。');
  }
  if (reservedNames.has(merged.name.trim().toLowerCase())) {
    throw new Error(
      `生成结果与已有设定「${merged.name.trim()}」重名。请换描述后再试，或先改名称。`,
    );
  }

  onUsage?.(usage);
  return merged;
}

const MAX_SUPPORTING_IMPORT_CANDIDATES = 6;
const MAX_SUPPORTING_IMPORT_SECTION_CHARS = 6500;

function truncateSupportingImportSection(content: string, maxChars = MAX_SUPPORTING_IMPORT_SECTION_CHARS) {
  const text = content.trim();
  if (text.length <= maxChars) {
    return text;
  }
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n…（中间内容已省略）…\n${text.slice(-tail)}`;
}

function buildCompactSupportingWorldContext(
  framework: Omit<NovelFrameworkDraft, 'cast'>,
  worldContext?: string,
) {
  return [
    framework.worldName?.trim() ? `世界名称：${framework.worldName.trim()}` : '',
    framework.worldEra?.trim() ? `时代与设定：${framework.worldEra.trim()}` : '',
    framework.worldTone?.trim() ? `世界基调：${framework.worldTone.trim()}` : '',
    framework.gameRules?.trim() ? `世界规则：${framework.gameRules.trim()}` : '',
    worldContext?.trim() ? `当前小世界补充：${worldContext.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2800) || '世界设定：未提供；请只做不违背原文的常规补全。';
}

function normalizeSupportingCandidate(
  value: unknown,
  sourceLabel: string,
  reservedNames: Set<string>,
): SupportingCharacterCandidate | null {
  if (!isPlainObject(value) || typeof value.name !== 'string') {
    return null;
  }
  const name = value.name.trim();
  if (
    !name ||
    name.length > 20 ||
    reservedNames.has(name.toLowerCase()) ||
    (/^[0-9一二三四五六七八九十百千万亿]+/.test(name) && name.length <= 4)
  ) {
    return null;
  }
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 260))
        .slice(0, 3)
    : [];
  return {
    name,
    role: typeof value.role === 'string' ? value.role.trim().slice(0, 80) : undefined,
    evidence,
    sourceLabel: sourceLabel.trim() || undefined,
  };
}

async function identifySupportingCharacterCandidates({
  apiSettings,
  novelCreateMaxTokens,
  sourceSections,
  existingCast,
  reservedNameHints = [],
  onUsage,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  sourceSections: SupportingCharacterSourceSection[];
  existingCast: NovelCastCharacter[];
  reservedNameHints?: string[];
  onUsage?: (usage: CreateAiUsage) => void;
}): Promise<SupportingCharacterCandidate[]> {
  const reservedNames = new Set(
    [
      ...existingCast.map((item) => item.name.trim()),
      ...reservedNameHints,
    ]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const candidates = new Map<string, SupportingCharacterCandidate>();
  const sections = sourceSections
    .map((section) => ({ label: section.label.trim(), content: section.content.trim() }))
    .filter((section) => section.content.length > 0);
  const batches: SupportingCharacterSourceSection[] = [];
  let batchLabel: string[] = [];
  let batchContent = '';
  for (const section of sections) {
    const nextContent = batchContent
      ? `${batchContent}\n\n【${section.label || '未标注来源'}】\n${section.content}`
      : section.content;
    if (batchContent && nextContent.length > MAX_SUPPORTING_IMPORT_SECTION_CHARS) {
      batches.push({ label: batchLabel.join('、'), content: batchContent });
      batchLabel = [];
      batchContent = section.content;
    } else {
      batchContent = nextContent;
    }
    if (section.label) {
      batchLabel.push(section.label);
    }
  }
  if (batchContent) {
    batches.push({ label: batchLabel.join('、'), content: batchContent });
  }

  for (const section of batches) {
    const systemPrompt = `你是小说正文中的人物候选识别器。只负责从给定片段中找出值得建立角色卡的新配角，不生成完整角色卡。
只输出 JSON 数组，每项格式：{"name":"人物姓名","role":"身份（可选）","evidence":["原文证据1","原文证据2"]}。
规则：
1. 必须有明确姓名，并且在片段中有实质性台词、行为、外貌或身份描写；路人、泛称和只被顺带提到的人忽略。
2. 已有角色名单中的人物不要输出。
3. evidence 必须逐字摘录片段中的短句，不要改写，不要补写；优先包含身份和人物关系证据，最多 3 条。
4. 不要生成身高、体重、关系、背景或其他完整设定。没有候选时输出 []。`;
    const userContent = [
      `【已有角色】${[...reservedNames].join('、') || '（暂无）'}`,
      `【正文片段｜${section.label || '未标注来源'}】\n${truncateSupportingImportSection(section.content)}`,
      '请只返回候选人物数组。',
    ].join('\n\n');

    const { raw, usage } = await requestCreateCompletion({
      apiSettings,
      maxTokens: Math.min(resolveNovelCreateMaxTokens(novelCreateMaxTokens, 1600), 2200),
      temperature: 0.2,
      purpose: 'create-supporting-candidates',
      systemPrompt,
      userContent,
      validate: (text) => {
        const parsed = extractJsonArray(text);
        if (!Array.isArray(parsed)) {
          throw new Error('候选人物结果不是数组');
        }
        return true;
      },
    });
    onUsage?.(usage);

    const parsed = extractJsonArray(raw);
    if (!Array.isArray(parsed)) {
      continue;
    }
    for (const rawCandidate of parsed) {
      const candidate = normalizeSupportingCandidate(rawCandidate, section.label, reservedNames);
      if (!candidate) {
        continue;
      }
      const key = candidate.name.toLowerCase();
      const previous = candidates.get(key);
      if (!previous) {
        candidates.set(key, candidate);
      } else {
        candidates.set(key, {
          ...previous,
          role: previous.role || candidate.role,
          evidence: [...new Set([...previous.evidence, ...candidate.evidence])].slice(0, 3),
        });
      }
      if (candidates.size >= MAX_SUPPORTING_IMPORT_CANDIDATES) {
        break;
      }
    }
    if (candidates.size >= MAX_SUPPORTING_IMPORT_CANDIDATES) {
      break;
    }
  }

  return [...candidates.values()];
}

async function generateSupportingCharactersByEvidence({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  framework,
  existingCast,
  recentReplyContent,
  currentChapter,
  nsfwEnabled,
  onUsage,
  styleProfile,
  worldContext,
  sourceSections,
  candidateHints,
  reservedNameHints,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro?: string;
  framework: Omit<NovelFrameworkDraft, 'cast'>;
  existingCast: NovelCastCharacter[];
  recentReplyContent: string;
  currentChapter?: string;
  nsfwEnabled: boolean;
  onUsage?: (usage: CreateAiUsage) => void;
  styleProfile?: NovelStyleProfile | null;
  worldContext?: string;
  sourceSections?: SupportingCharacterSourceSection[];
  candidateHints?: SupportingCharacterCandidate[];
  reservedNameHints?: string[];
}): Promise<NovelCastCharacter[]> {
  const sections = sourceSections?.length
    ? sourceSections
    : [{ label: currentChapter || '当前回复', content: recentReplyContent }];
  const candidates = candidateHints?.length
    ? candidateHints.slice(0, MAX_SUPPORTING_IMPORT_CANDIDATES)
    : await identifySupportingCharacterCandidates({
        apiSettings,
        novelCreateMaxTokens,
        sourceSections: sections,
        existingCast,
        reservedNameHints: [...(reservedNameHints ?? []), framework.playerName],
        onUsage,
      });

  if (candidates.length === 0) {
    throw new Error('正文中未检测到可建档的具名配角。');
  }

  const compactWorldContext = buildCompactSupportingWorldContext(framework, worldContext);
  const generated: NovelCastCharacter[] = [];
  const existingNames = new Set(
    [
      ...existingCast.map((item) => item.name.trim()),
      ...(reservedNameHints ?? []),
    ]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const candidate of candidates) {
    if (existingNames.has(candidate.name.trim().toLowerCase())) {
      continue;
    }
    const seed = createEmptyCastCharacter();
    seed.name = candidate.name;
    const evidenceBlock = candidate.evidence.length
      ? candidate.evidence.map((item) => `- ${item}`).join('\n')
      : '（原文没有可直接摘录的短句；请仅按上下文合理补全）';
    const userBrief = [
      `这是“从正文导入配角”流程，当前候选姓名已确定为「${candidate.name}」，不得改名。`,
      candidate.role ? `正文中显示的身份线索：${candidate.role}` : '',
      `原文证据（明确事实优先，保持原意）：\n${evidenceBlock}`,
      '请把原文明确内容优先写入对应字段；原文已明确的人名和关系必须原样写入 relations，不得换人或随机改关系。正文未写到的外貌、年龄、身高、体重、性格、背景等允许根据世界设定合理补全；如果完全没有人际信息，再补 1～2 条合理关系。',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const card = await generateNovelCastCharacter({
        apiSettings,
        novelCreateMaxTokens,
        novelName,
        intro,
        framework,
        current: seed,
        existingCast,
        userBrief,
        nsfwEnabled,
        onUsage,
        styleProfile,
        worldContext: compactWorldContext,
        contextMode: 'compact',
        enableQualityAudit: false,
      });
      generated.push({
        ...card,
        generatedFromReply: true,
        sourceChapter: candidate.sourceLabel?.trim() || currentChapter?.trim() || undefined,
      });
    } catch {
      // 单个候选失败不影响其余人物，避免一名坏候选阻塞整次导入。
    }
  }

  if (generated.length === 0) {
    throw new Error('候选人物均未能生成角色卡，请缩小正文范围后重试。');
  }
  return generated;
}

/**
 * Extract supporting characters from an AI reply and generate full dossiers
 * with the same completeness as normal AI character generation.
 * Returns an array of cast characters ready for user review before insertion.
 */
export async function generateSupportingCharacters({
  apiSettings,
  novelCreateMaxTokens,
  novelName,
  intro,
  framework,
  existingCast = [],
  recentReplyContent,
  currentChapter,
  nsfwEnabled = false,
  onUsage,
  styleProfile,
  worldContext,
  sourceSections,
  candidateHints,
}: {
  apiSettings: ApiSettings;
  novelCreateMaxTokens?: number;
  novelName: string;
  intro?: string;
  framework: Omit<NovelFrameworkDraft, 'cast'>;
  existingCast?: NovelCastCharacter[];
  recentReplyContent: string;
  /** 当前章节标题（如"第一章"），用于给生成角色打来源标签。 */
  currentChapter?: string;
  /** 是否 NSFW 模式——控制隐私词条生成。 */
  nsfwEnabled?: boolean;
  /** 回调本次生成 token 用量（供 UI 统计）。 */
  onUsage?: (usage: CreateAiUsage) => void;
  /** 已有小说的文风画像（续写分析产物），注入生成提示词。 */
  styleProfile?: NovelStyleProfile | null;
  /** 当前快穿世界完整设定。 */
  worldContext?: string;
  /** 正文导入时按来源分段，避免把整篇正文交给一次模型调用。 */
  sourceSections?: SupportingCharacterSourceSection[];
  /** 已有正文分析提供的候选人物；提供后跳过候选识别调用。 */
  candidateHints?: SupportingCharacterCandidate[];
}): Promise<NovelCastCharacter[]> {
  if (sourceSections?.length || candidateHints?.length) {
    return generateSupportingCharactersByEvidence({
      apiSettings,
      novelCreateMaxTokens,
      novelName,
      intro,
      framework,
      existingCast,
      recentReplyContent,
      currentChapter,
      nsfwEnabled: nsfwEnabled === true,
      onUsage,
      styleProfile,
      worldContext,
      sourceSections,
      candidateHints,
    });
  }

  const workIntro = intro?.trim() || '';
  const castNames = existingCast
    .map((item) => item.name.trim())
    .filter(Boolean);
  const castSummary = castNames.length
    ? `已有角色：${castNames.join('、')}`
    : '（暂无角色）';
  const styleProfileBlock = formatStyleProfileForPrompt(styleProfile);

  const allowNsfw = nsfwEnabled === true;

  const systemPrompt = buildSupportingCharacterGenerationSystemPrompt(allowNsfw);

  const userContent = [
    `【小说名称】${novelName.trim() || '未命名'}`,
    workIntro ? `【作品介绍】${workIntro}` : '',
    `【世界与主角框架】\n${JSON.stringify(framework, null, 2)}`,
    castSummary,
    styleProfileBlock,
    worldContext?.trim() ? `【当前快穿世界完整设定】\n${worldContext.trim()}` : '',
    `【正文片段】\n${recentReplyContent.slice(0, 4000)}`,
    '请从正文中提取应建档的配角，并为每位生成完整设定。',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { raw, usage } = await requestCreateCompletion({
    apiSettings,
    maxTokens: resolveNovelCreateMaxTokens(novelCreateMaxTokens, 8000),
    temperature: Math.min(apiSettings.temperature, 0.75),
    purpose: NOVEL_CREATE_USAGE_TASKS.supporting,
    systemPrompt,
    userContent,
    validate: (text) => {
      const parsed = extractJsonArray(text);
      return Array.isArray(parsed) && parsed.some((item) => isPlainObject(item) && isPlainObject(item.cast) && typeof item.cast.name === 'string' && item.cast.name.trim().length > 0);
    },
  });

  const parsed = extractJsonArray(raw) as CharacterGenerationAiPayload[];

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('未检测到可建档的配角。');
  }

  const reservedNames = new Set(castNames.map((n) => n.toLowerCase()));
  const timestamp = Date.now();

  const generated = parsed
    .filter((item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.cast?.name === 'string' &&
      item.cast.name.trim().length > 0,
    )
    .filter((item) => {
      const name = item.cast!.name!.trim();
      if (reservedNames.has(name.toLowerCase())) {
        return false;
      }
      if (/^[0-9一二三四五六七八九十百千万亿]+/.test(name) && name.length <= 4) {
        return false;
      }
      if (name.length > 20) {
        return false;
      }
      return true;
    })
    .map((item) => {
      const cast = item.cast!;
      const name = cast.name!.trim();
      const relations = normalizeAiRelations(cast.relations) ?? [];
      const base: NovelCastCharacter = {
        id: `supporting-${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
        name,
        aliases: normalizeAliases(cast.aliases)
          .filter((alias) => alias.toLowerCase() !== name.toLowerCase())
          .slice(0, 6),
        gender: typeof cast.gender === 'string' ? cast.gender.trim() : '',
        profession: typeof cast.profession === 'string' ? cast.profession.trim() : '',
        age: typeof cast.age === 'string'
          ? cast.age.trim()
          : typeof cast.age === 'number'
            ? String(cast.age)
            : '',
        height: typeof cast.height === 'string'
          ? cast.height.trim()
          : typeof cast.height === 'number'
            ? String(cast.height)
            : '',
        weight: typeof cast.weight === 'string'
          ? cast.weight.trim()
          : typeof cast.weight === 'number'
            ? String(cast.weight)
            : '',
        birthplace: typeof cast.birthplace === 'string' ? cast.birthplace.trim() : '',
        affiliation: typeof cast.affiliation === 'string' ? cast.affiliation.trim() : '',
        appearance: typeof cast.appearance === 'string' ? cast.appearance.trim() : '',
        personality: typeof cast.personality === 'string' ? cast.personality.trim() : '',
        speechStyle: typeof cast.speechStyle === 'string' ? cast.speechStyle.trim() : '',
        background: typeof cast.background === 'string' ? cast.background.trim() : '',
        motive: typeof cast.motive === 'string' ? cast.motive.trim() : '',
        strengths: typeof cast.strengths === 'string' ? cast.strengths.trim() : '',
        weaknesses: typeof cast.weaknesses === 'string' ? cast.weaknesses.trim() : '',
        isProtagonist: false,
        generatedFromReply: true,
        sourceChapter: currentChapter?.trim() || undefined,
        relations,
        portraitUri: '',
      };
      const dossierV2 = mergeCharacterDossierV2(undefined, item.dossierV2, base, {
        includePrivate: allowNsfw,
      });
      const withDossier = { ...base, dossierV2 };
      return {
        ...withDossier,
        aiSummary: normalizeCharacterAiSummary(item.aiSummary, withDossier, dossierV2),
      } satisfies NovelCastCharacter;
    });

  onUsage?.(usage);
  return generated;
}

function extractJsonArray(raw: string): unknown[] | null {
  return extractAiJsonArray(raw);
}

