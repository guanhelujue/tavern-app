import type { NovelCastCharacterPrivacy, NovelStoryCharacter } from '@/types/tavern';
import type { LlmCompletion, LlmMessage } from '@/services/novel-story-state';
import { extractAiJsonArray } from '@/utils/ai-json';

// ─────────────────────────────────────────────────────────────────────────────
// 全文检索 —— 定位角色在原文中的出现片段（纯函数，可单测）
// ─────────────────────────────────────────────────────────────────────────────

export type CharacterMentionKind = 'appearance' | 'dialogue' | 'other';

export type CharacterMention = {
  /** 来源章节（1-based）。 */
  chapter: number;
  /** 截取后的原文片段。 */
  snippet: string;
  kind: CharacterMentionKind;
  /** 命中的关键词（角色名 / 别名 / 预写种子词）。 */
  hits: string[];
};

/** 外貌类线索词：命中则片段优先归为 appearance。 */
const APPEARANCE_KEYWORDS = [
  '身着', '容貌', '模样', '面孔', '长相', '外貌', '相貌', '眉', '眸', '眼', '发',
  '唇', '肌肤', '皮肤', '身材', '身段', '身形', '姿态', '打扮', '衣', '裙', '袍',
  '甲', '冠', '佩剑', '脸色', '鬓',
];

/** 对话类线索：命中则片段优先归为 dialogue。 */
const DIALOGUE_PATTERNS = [/[「“]/, /[」”]/, /道[：:，]/, /说[：:，]/, /问[：:，]/, /喊[：:，]/];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从用户预写内容里抽取检索用关键词（短语切分 + 长度过滤 + 去重）。
 * 用户预写的是描述性句子，直接整句去匹配原文几乎不会命中，因此按标点拆词。
 */
export function extractSeedKeywords(seed: string, max = 8): string[] {
  const parts = seed
    .split(/[，。！？、；：…\n\s"「」『』（）()·—\-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 8);
  return [...new Set(parts)].slice(0, max);
}

function makeSnippet(paragraph: string, keywords: string[], max = 180): string {
  const clean = paragraph.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) {
    return clean;
  }
  let hitIndex = -1;
  for (const keyword of keywords) {
    const index = clean.indexOf(keyword);
    if (index >= 0) {
      hitIndex = index;
      break;
    }
  }
  const start = Math.max(0, hitIndex - 60);
  const end = Math.min(clean.length, start + max);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

function kindOf(snippet: string): CharacterMentionKind {
  if (APPEARANCE_KEYWORDS.some((keyword) => snippet.includes(keyword))) {
    return 'appearance';
  }
  if (DIALOGUE_PATTERNS.some((pattern) => pattern.test(snippet))) {
    return 'dialogue';
  }
  return 'other';
}

export type CharacterRetrievalInput = {
  id: string;
  name: string;
  aliases?: string[];
  /** 用户预写内容抽出的检索关键词（配合种子文本命中更多相关段落）。 */
  seeds?: string[];
};

/**
 * 按「角色名 + 别名 + 预写种子词」在全书定稿章节中定位出现片段。
 * 片段按「外貌 > 对话 > 其他」优先排序，同优先级按命中词数降序、章节升序。
 */
export function collectCharacterMentions(
  chapters: readonly { index: number; content: string }[],
  characters: readonly CharacterRetrievalInput[],
  options?: { maxPerCharacter?: number },
): Map<string, CharacterMention[]> {
  const maxPerCharacter = options?.maxPerCharacter ?? 6;
  const result = new Map<string, CharacterMention[]>();

  for (const character of characters) {
    const keywords = [character.name, ...(character.aliases ?? []), ...(character.seeds ?? [])]
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length >= 2);
    if (keywords.length === 0) {
      continue;
    }

    const seen = new Set<string>();
    const mentions: CharacterMention[] = [];

    for (const chapter of chapters) {
      const paragraphs = chapter.content
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const hits = keywords.filter((keyword) => paragraph.includes(keyword));
        if (hits.length === 0) {
          return;
        }
        const key = `${chapter.index}-${paragraphIndex}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        mentions.push({
          chapter: chapter.index,
          snippet: makeSnippet(paragraph, hits),
          kind: kindOf(paragraph),
          hits,
        });
      });
    }

    const rank: Record<CharacterMentionKind, number> = { appearance: 0, dialogue: 1, other: 2 };
    mentions.sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] || b.hits.length - a.hits.length || a.chapter - b.chapter,
    );
    result.set(character.id, mentions.slice(0, maxPerCharacter));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM 精炼 —— 把命中片段 + 用户预写整理成结构化角色档案
// ─────────────────────────────────────────────────────────────────────────────

const PRIVACY_KEYS: (keyof NovelCastCharacterPrivacy)[] = [
  'genitals',
  'chest',
  'erogenousZones',
  'scent',
  'xp',
  'masturbationHabits',
  'taboo',
];

function parsePrivacy(value: unknown): NovelCastCharacterPrivacy | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const result: NovelCastCharacterPrivacy = {};
  for (const key of PRIVACY_KEYS) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      result[key] = raw.trim().slice(0, 600);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseEnrichedCharacter(
  value: unknown,
  batch: readonly { id: string; name: string }[],
): Partial<NovelStoryCharacter> | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const target = batch.find((item) => item.id === id && item.name.trim() === name);
  if (!target) {
    return null;
  }

  const takeString = (field: string, max = 800): string | undefined => {
    const raw = value[field];
    if (typeof raw !== 'string' || !raw.trim()) {
      return undefined;
    }
    return raw.trim().slice(0, max);
  };
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 3)
    : [];

  return {
    id,
    name,
    ...(takeString('appearance') !== undefined ? { appearance: takeString('appearance') } : {}),
    ...(takeString('personality') !== undefined ? { personality: takeString('personality') } : {}),
    ...(takeString('speechStyle') !== undefined ? { speechStyle: takeString('speechStyle') } : {}),
    ...(takeString('background') !== undefined ? { background: takeString('background') } : {}),
    ...(takeString('motivation') !== undefined ? { motivation: takeString('motivation') } : {}),
    ...(takeString('affiliation') !== undefined ? { affiliation: takeString('affiliation') } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

function buildEnrichSystemPrompt(nsfwEnabled: boolean): string {
  const privacyRule = nsfwEnabled
    ? '当前为 NSFW 模式：若原文含身体/亲密/性癖描写，可输出 privacy 对象（genitals/chest/erogenousZones/scent/xp/masturbationHabits/taboo），逐条 1~3 句；勿把隐私内容写进 appearance 等公开字段。'
    : '当前为 SFW 模式：禁止输出 privacy 字段及任何色情词条。';
  return `你是小说「人物档案精修」助手。用户会给你若干角色在原文中的出现片段，以及用户预写的内容。你需要把这些材料整理成结构化的角色档案 JSON。
规则：
- 只依据给定的原文片段归纳，不得编造原文没有的设定；原文没有的信息留空字符串。
- 每个字段 1~3 句，具体可感，避免空话。
- appearance 只写外貌；personality 写性格；speechStyle 写说话方式；background 写出身/背景；motivation 写动机/目标；affiliation 写阵营/所属。
- 用户预写内容（SFW/NSFW）是必须覆盖的要点：原文有对应描写则引用进对应字段；原文没有的，直接采用用户预写内容。
- evidence：从片段中挑选 1~3 条最能支撑该角色档案的原文，逐字保留，禁止改写。
${privacyRule}
只输出 JSON 数组：[{"id":"角色id","name":"角色名","appearance":"…","personality":"…","speechStyle":"…","background":"…","motivation":"…","affiliation":"…","evidence":["原文片段"],"privacy":{…}}]，不要 Markdown，不要解释。`;
}

/**
 * 全文检索 + LLM 精炼：把命中片段与用户预写整理成结构化角色档案。
 * 分批调用（默认每批 4 个角色）；任何一批失败都静默跳过，绝不抛出。
 */
export async function enrichCharactersFromText(params: {
  completion: LlmCompletion;
  novelName: string;
  chapters: readonly { index: number; content: string }[];
  characters: readonly NovelStoryCharacter[];
  nsfwEnabled: boolean;
  maxPerBatch?: number;
}): Promise<{
  /** 被增强的角色（只含发生变化的字段；无变化的角色不返回）。 */
  characters: Partial<NovelStoryCharacter>[];
  promptTokens: number;
  completionTokens: number;
  modelId?: string;
}> {
  const { completion, novelName, chapters, characters, nsfwEnabled } = params;
  const maxPerBatch = params.maxPerBatch ?? 4;

  const mentionsMap = collectCharacterMentions(
    chapters,
    characters.map((character) => ({
      id: character.id,
      name: character.name,
      aliases: [],
      seeds: [...extractSeedKeywords(character.sfwSeed ?? ''), ...extractSeedKeywords(character.nsfwSeed ?? '')],
    })),
  );

  const batches = characters.filter(
    (character) => character.name.trim() && (mentionsMap.get(character.id)?.length ?? 0) > 0,
  );

  const enriched: Partial<NovelStoryCharacter>[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let modelId: string | undefined;
  let completedBatches = 0;
  const failedBatches: string[] = [];

  for (let offset = 0; offset < batches.length; offset += maxPerBatch) {
    const batch = batches.slice(offset, offset + maxPerBatch);
    const blocks = batch.map((character) => {
      const mentions = mentionsMap.get(character.id) ?? [];
      const snippets = mentions
        .map((mention) => `- 第${mention.chapter}章：${mention.snippet}`)
        .join('\n');
      return [
        `【角色】${character.name}（id: ${character.id}）｜${character.role || '角色'}`,
        `原文片段：\n${snippets || '（无）'}`,
        character.sfwSeed ? `用户预写 SFW：${character.sfwSeed}` : '',
        character.nsfwSeed ? `用户预写 NSFW：${character.nsfwSeed}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    });

    const messages: LlmMessage[] = [
      { role: 'system', content: buildEnrichSystemPrompt(nsfwEnabled) },
      {
        role: 'user',
        content: `小说《${novelName}》。以下是各角色的原文节选与用户预写内容：\n\n${blocks.join('\n\n')}`,
      },
    ];

    try {
      let result = await completion(messages, 'character-enrich');
      promptTokens += result.promptTokens ?? 0;
      completionTokens += result.completionTokens ?? 0;
      modelId = result.modelId ?? modelId;

      let parsed = extractAiJsonArray(result.content);
      if (!parsed) {
        result = await completion([
          ...messages,
          { role: 'assistant', content: result.content },
          { role: 'user', content: '请只修复上一条角色档案 JSON 的格式，保留已返回的完整角色，不要编造信息；只输出完整 JSON 数组。' },
        ], 'character-enrich-repair');
        promptTokens += result.promptTokens ?? 0;
        completionTokens += result.completionTokens ?? 0;
        modelId = result.modelId ?? modelId;
        parsed = extractAiJsonArray(result.content);
      }
      if (!Array.isArray(parsed)) {
        failedBatches.push(batch.map((character) => character.name).join('、'));
        continue;
      }
      completedBatches += 1;
      for (const item of parsed) {
        const partial = parseEnrichedCharacter(item, batch);
        if (partial) {
          const privacy = parsePrivacy((item as Record<string, unknown>).privacy);
          enriched.push({ ...partial, ...(privacy && nsfwEnabled ? { privacy } : {}) });
        }
      }
    } catch {
      failedBatches.push(batch.map((character) => character.name).join('、'));
    }
  }

  if (batches.length > 0 && completedBatches === 0 && failedBatches.length > 0) {
    throw new Error(`角色档案精炼失败：${failedBatches.join('；')}。请重试。`);
  }
  return { characters: enriched, promptTokens, completionTokens, modelId };
}
