import { tryParseAiJson } from '@/utils/ai-json';
import {
  DEFAULT_CHAPTER_RULES,
  FORESHADOWING_OVERDUE_AFTER_CHAPTERS,
  NOVEL_LOOKBACK_MAX,
  NOVEL_TARGET_WORDS_RANGE,
  type ChapterRule,
} from '@/constants/novel-continuation';
import {
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from '@/features/character-dossier-v2/ai-summary';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import { formatProtagonistAuthority } from '@/utils/novel-player';
import { getNarrativeNovel, NOVEL_CAST_IDENTITY_RULE } from '@/utils/novel-narrative-context';
import { buildActiveNovelFoundation } from '@/features/novel-creation/legacy-novel-adapter';
import { formatNovelForeshadowingContext } from '@/utils/novel-foreshadowing-workspace';
import { requestCompletionWithUsage } from '@/services/llm';
import { parseNovelOutlineChapterRevision } from '@/services/novel-outline-chapter-revision';
import { buildStoryStateCanon } from '@/services/novel-forecast';
import {
  normalizeNovelOutlineOptions,
} from '@/utils/novel-outline-options';
import type {
  ApiSettings,
  Novel,
  NovelAuditIssue,
  NovelChapter,
  NovelContinuationSettings,
  NovelForeshadowing,
  NovelForecastRoute,
  NovelOutline,
  NovelVolumeChapter,
  NovelVolumePlan,
  NovelStoryAnalysis,
} from '@/types/tavern';

// ─────────────────────────────────────────────────────────────────────────────
// JSON helpers (shared by all extractors)
// ─────────────────────────────────────────────────────────────────────────────

function extractJsonObject(text: string): unknown {
  return tryParseAiJson(text) ?? null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactCharacterAnchor(character: Novel['cast'][number], maxChars: number): string {
  if (character.aiSummary && character.dossierV2) {
    const dossier = normalizeCharacterDossierV2(character.dossierV2, character);
    return `${character.isProtagonist ? `【主角·${character.name}】\n` : ''}${formatCharacterAiSummaryForPrompt(
      normalizeCharacterAiSummary(character.aiSummary, character, dossier),
    )}`.slice(0, maxChars);
  }
  const details = [character.personality, character.motive, character.affiliation]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('；')
    .slice(0, maxChars);
  return `- ${character.name}：${details}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings resolution
// ─────────────────────────────────────────────────────────────────────────────

export function resolveContinuationSettings(novel: Novel): NovelContinuationSettings {
  const stored = novel.continuationSettings;
  return {
    lookbackChapters: clampInt(stored?.lookbackChapters, 3, 0, NOVEL_LOOKBACK_MAX),
    targetWords: clampInt(
      stored?.targetWords,
      1800,
      NOVEL_TARGET_WORDS_RANGE[0],
      NOVEL_TARGET_WORDS_RANGE[1],
    ),
    autoAudit: stored?.autoAudit ?? true,
    autoForeshadowingTrack: stored?.autoForeshadowingTrack ?? true,
    useAntiAiRules: stored?.useAntiAiRules ?? true,
    useOutline: stored?.useOutline ?? true,
    maxContextChars: clampInt(stored?.maxContextChars, 6000, 1000, 20000),
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getFinalChapters(novel: Novel): NovelChapter[] {
  return (novel.chapters ?? [])
    .filter((chapter) => chapter.status === 'final')
    .sort((a, b) => a.index - b.index);
}

export function getDraftChapters(novel: Novel): NovelChapter[] {
  return (novel.chapters ?? [])
    .filter((chapter) => chapter.status === 'draft')
    .sort((a, b) => a.index - b.index);
}

export function getNextChapterIndex(novel: Novel): number {
  const maxIndex = (novel.chapters ?? []).reduce((max, chapter) => Math.max(max, chapter.index), 0);
  return maxIndex + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — rule audit (regex engine)
// ─────────────────────────────────────────────────────────────────────────────

export function auditChapterWithRules(
  chapter: Pick<NovelChapter, 'content' | 'title'>,
  rules: ChapterRule[] = DEFAULT_CHAPTER_RULES,
): NovelAuditIssue[] {
  const issues: NovelAuditIssue[] = [];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const matchCount = countMatches(rule.pattern, chapter.content);
    if (matchCount === 0) {
      continue;
    }
    issues.push({
      id: `${rule.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: rule.category,
      severity: rule.severity,
      message: `${rule.label}：${rule.hint}（命中 ${matchCount} 处）`,
    });
  }

  // Word-count sanity check.
  const chineseChars = chapter.content.replace(/\s/g, '').length;
  if (chineseChars < 50) {
    issues.push({
      id: `too-short-${Date.now()}`,
      category: 'rhythm',
      severity: 'high',
      message: `本章过短（仅约 ${chineseChars} 字），可能被截断或内容空洞。`,
    });
  }

  return issues;
}

function countMatches(pattern: RegExp, text: string): number {
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    count += 1;
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += 1;
    }
    if (count > 50) {
      break;
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — LLM fact-check (L1 per chapter, utility model)
// ─────────────────────────────────────────────────────────────────────────────

export type FactCheckResult = {
  issues: NovelAuditIssue[];
  passed: boolean;
  foreshadowings: { keyword: string; description: string; planted: boolean }[];
  modelId?: string;
  tokens: number;
};

const FACT_CHECK_SYSTEM_PROMPT = `你是小说一致性审查助手。用户提供「本章正文」与「前文关键设定」，请逐项核对一致性并输出 JSON。

输出结构：
{
  "issues": [
    { "category": "consistency|rhythm|continuity|character|foreshadowing|structure", "severity": "high|medium|low", "message": "具体矛盾或问题描述，注明涉及的原文" }
  ],
  "foreshadowings": [
    { "keyword": "新埋设或已回收的伏笔关键词", "description": "一句话说明", "planted": true }
  ]
}

要求：
- 只核对确有依据的问题，不要泛泛而谈；没有发现就返回空数组。
- 关注：人物死亡后复现、已换地点仍在旧地点、称呼/身份前后矛盾、上一章承诺未兑现、时间线错乱。
- 最多输出 8 条 issue。不要输出 JSON 以外的任何文字。`;

export async function factCheckChapter({
  apiSettings,
  novel,
  chapter,
  recentChapters,
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  chapter: Pick<NovelChapter, 'content' | 'title' | 'index'>;
  recentChapters: NovelChapter[];
}): Promise<FactCheckResult> {
  const anchorText = (novel.cast ?? [])
    .slice(0, 8)
    .map((character) => compactCharacterAnchor(character, 500))
    .join('\n');

  const recentText = recentChapters
    .slice(-2)
    .map((item) => `第${item.index}章 ${item.title}\n${item.content.slice(0, 800)}`)
    .join('\n\n');

  const userPrompt = `【前文关键设定】
${anchorText || '（无角色锚点）'}

【最近前文】
${recentText || '（无前文）'}

【待审章节】
第${chapter.index}章 ${chapter.title}
${chapter.content.slice(0, 4000)}

请按系统要求输出 JSON。`;

  const result = await requestCompletionWithUsage({ responseFormat: 'json',
    apiSettings,
    messages: [
      { role: 'system', content: FACT_CHECK_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    purpose: 'fact-check',
    allowPartialJson: false,
    validateJson: (value) => Boolean(value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).issues)),
    maxTokens: 1024,
    temperature: 0.2,
  });

  const raw = extractJsonObject(result.content);
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).issues)) {
    throw new Error('审查结果尚不完整，已保留章节，请重试审查。');
  }
  const payload = (raw ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(payload.issues)
    ? payload.issues
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          const category = asString(entry.category);
          const severity = asString(entry.severity);
          return {
            id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            category: (['consistency', 'rhythm', 'continuity', 'character', 'foreshadowing', 'structure'].includes(category)
              ? category
              : 'consistency') as NovelAuditIssue['category'],
            severity: (['high', 'medium', 'low'].includes(severity) ? severity : 'medium') as NovelAuditIssue['severity'],
            message: asString(entry.message),
          };
        })
        .filter((item) => item.message.length > 0)
        .slice(0, 8)
    : [];

  const foreshadowings = Array.isArray(payload.foreshadowings)
    ? payload.foreshadowings
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          return {
            keyword: asString(entry.keyword),
            description: asString(entry.description),
            planted: entry.planted !== false,
          };
        })
        .filter((item) => item.keyword.length > 0)
    : [];

  return {
    issues,
    passed: issues.length === 0,
    foreshadowings,
    modelId: result.model,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — foreshadowing ledger sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge LLM-reported hooks into the ledger:
 * - planted hooks that already exist are kept (dedupe by keyword).
 * - hooks whose keyword matches an open entry are marked fulfilled.
 * - open entries older than FORESHADOWING_OVERDUE_AFTER_CHAPTERS get a note.
 */
export function syncForeshadowings(
  current: NovelForeshadowing[],
  reported: { keyword: string; description: string; planted: boolean }[],
  chapterIndex: number,
): NovelForeshadowing[] {
  const next = current.map((item) => ({ ...item }));

  for (const entry of reported) {
    const keyword = entry.keyword.trim();
    if (!keyword) {
      continue;
    }
    // Author-maintained decisions take precedence over automatic audit reports.
    if (next.some((item) => item.keyword === keyword && (item.locked || item.status !== 'open'))) continue;

    if (entry.planted) {
      const existing = next.find(
        (item) =>
          item.keyword === keyword && item.status === 'open',
      );
      if (existing) {
        existing.description = entry.description || existing.description;
        continue;
      }
      next.push({
        id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        keyword,
        description: entry.description,
        status: 'open',
        plantedChapterIndex: chapterIndex,
        createdAt: new Date().toISOString(),
        note: '',
      });
    } else {
      const target = next.find((item) => item.keyword === keyword && item.status === 'open');
      if (target) {
        target.status = 'fulfilled';
        target.fulfilledChapterIndex = chapterIndex;
        target.note = entry.description || '本章已回收';
      }
    }
  }

  return next.map((item) => {
    if (!item.locked && item.status === 'open' && item.plantedChapterIndex > 0 && chapterIndex - item.plantedChapterIndex >= FORESHADOWING_OVERDUE_AFTER_CHAPTERS) {
      return { ...item, note: `已超 ${FORESHADOWING_OVERDUE_AFTER_CHAPTERS} 章未推进` };
    }
    return item;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase D — outline generation
// ─────────────────────────────────────────────────────────────────────────────

function buildOutlineSystemPrompt(
  targetChapterCount?: number,
  chapterCountRange?: { min: number; max: number },
): string {
  const chapterStructure = targetChapterCount
    ? `本次请求必须恰好生成 ${targetChapterCount} 章；可按剧情合理拆分为多卷，每卷章数不固定，但所有章序号必须连续递增。`
    : chapterCountRange
      ? `本次只生成当前卷，不要拆分成多卷；本卷章节数可根据剧情在 ${chapterCountRange.min}-${chapterCountRange.max} 章之间自然决定，不得为了凑数硬拆或压缩情节，所有章序号必须连续递增。`
      : 'volumes 只生成 1-3 卷；每卷 chapters 生成 3-6 章。';

  return `你是长篇小说大纲规划师。基于用户提供的前文、状态分析摘要与设定，规划后续卷纲与逐章细纲，只输出 JSON：
{
  "summary": "全书核心主线一句话 + 未解决冲突清单，2-4 句",
  "volumes": [
    {
      "title": "卷名",
      "summary": "本卷要解决的冲突与看点，1-2 句",
      "tone": "本卷节奏或情绪基调（可选）",
      "foreshadowing": "本卷伏笔边界（可选）",
      "chapters": [
        { "index": 章序号, "title": "章名", "goal": "本章叙事目标一句话（推进什么/埋下什么钩子）", "sceneEnd": true/false, "characterChange": "人物变化（可选）", "foreshadowing": "本章线索（可选）", "endingHook": "章末衔接（可选）" }
      ]
    }
  ]
}
要求：
- ${chapterStructure}
- sceneEnd 只在完整叙事场景收束、转场或卷末章标为 true，不要每章都标记。
- 章序号从下一章编号开始连续递增（如前文已到第 12 章，则从 13 开始）。
- 大纲必须贴合【状态分析摘要】：明确推进/回收其中的未回收伏笔，符合人物当前状态与目标，沿既有剧情线演进。
- 用户提供的世界设定、项目 brief、角色卡和知识库是硬约束；不得用无依据的新世界、势力、规则替换或稀释它们。
- 你输出的是编辑器待确认的候选提案，不是对正史的直接写入；不得擅自把用户没有要求的内容改成另一种价值取向或叙事方向。
- 如果用户给了“当前卷现有大纲”，优先在其上做局部修订；没有被提示明确要求的字段保持原意，不要为了凑 JSON 而整卷重写。
- 每章都必须能指出它推进了哪条既有主线、冲突、角色目标或伏笔；缺少依据时优先留白，不要凭空扩展另一套世界观。
- 目标要具体可执行，别写空话。不要输出 JSON 以外的文字。`;
}

function formatOutlineContext(novel: Novel, canon: string): string {
  novel = getNarrativeNovel(novel);
  const setting = [
    ['小说名', novel.name],
    ['世界名', novel.worldName],
    ['时代与技术', novel.worldEra],
    ['世界冲突', novel.worldConflict],
    ['叙事基调', novel.worldTone],
    ['核心主线', novel.mainPlot],
    ['初始故事状态', novel.projectBrief?.firstChapterGoal || novel.initialStoryState],
    ['世界规则', novel.gameRules],
    ['写作风格', novel.writingStyle],
  ]
    .filter(([, value]) => asString(value).length > 0)
    .map(([label, value]) => `${label}：${asString(value).slice(0, 1200)}`)
    .join('\n');

  const castText = (novel.cast ?? [])
    .slice(0, 16)
    .map((character) => {
      if (character.aiSummary && character.dossierV2) {
        return compactCharacterAnchor(character, 800);
      }
      const details = [
        asString(character.profession),
        asString(character.affiliation),
        `外貌：${asString(character.appearance)}`,
        `性格：${asString(character.personality)}`,
        `说话方式：${asString(character.speechStyle)}`,
        `背景：${asString(character.background)}`,
        `动机：${asString(character.motive)}`,
        `优势：${asString(character.strengths)}`,
        `弱点：${asString(character.weaknesses)}`,
      ]
        .filter((part) => part.length > 0)
        .join('；');
      return `- ${character.name}${character.isProtagonist ? '（主角）' : ''}：${details}`;
    })
    .join('\n');

  const loreText = (novel.loreEntries ?? [])
    .filter((entry) => entry.enabled !== false)
    .slice(0, 24)
    .map((entry) => `- ${entry.name}：${asString(entry.content).slice(0, 800)}`)
    .join('\n');

  const foundation = buildActiveNovelFoundation(novel);

  return [
    `【小说世界与作者约束】\n${setting || '（未填写结构化世界设定）'}`,
    foundation ? `【当前创作契约·由现有设定与角色卡生成】\n${foundation.slice(0, 12000)}` : '',
    formatNovelForeshadowingContext(novel),
    `【角色卡】\n${castText || '（无）'}`,
    formatProtagonistAuthority(novel.cast),
    NOVEL_CAST_IDENTITY_RULE,
    loreText ? `【知识库设定】\n${loreText}` : '',
    canon ? `【状态分析摘要】\n${canon}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function generateOutline({
  apiSettings,
  novel,
  nextChapterIndex,
  route,
  analysis,
  worldContext,
  userBrief,
  targetChapterCount,
  targetWords,
  chapterCountRange,
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  nextChapterIndex: number;
  /** 已选路线上下文：节拍 / 伏笔推进 / 风险，用于把大纲贴合到该路线。 */
  route?: NovelForecastRoute | null;
  /** 结构化状态分析（与路线推演同源），用于消除大纲与路线的认知偏差。 */
  analysis?: NovelStoryAnalysis | null;
  /** Optional bounded setting used by quick-travel world outlines. */
  worldContext?: string;
  /** Author-provided outline seed. Empty means the model plans autonomously. */
  userBrief?: string;
  /** Requested total chapter count for a self-contained world arc. */
  targetChapterCount?: number;
  /** Requested total word count for a self-contained world arc. */
  targetWords?: number;
  /** Bounded variable chapter count used when restructuring an existing volume. */
  chapterCountRange?: { min: number; max: number };
}): Promise<{ outline: NovelOutline; tokens: number }> {
  const resolvedOptions = normalizeNovelOutlineOptions({ targetChapterCount, targetWords, userBrief });
  targetChapterCount = resolvedOptions.targetChapterCount;
  targetWords = resolvedOptions.targetWords;
  userBrief = resolvedOptions.userBrief;
  const normalizedChapterCountRange = chapterCountRange
    ? {
        min: Math.max(1, Math.trunc(chapterCountRange.min)),
        max: Math.max(1, Math.trunc(chapterCountRange.max)),
      }
    : undefined;
  if (normalizedChapterCountRange && normalizedChapterCountRange.max < normalizedChapterCountRange.min) {
    normalizedChapterCountRange.max = normalizedChapterCountRange.min;
  }

  const sample = getFinalChapters(novel)
    .slice(-4)
    .map((chapter) => `第${chapter.index}章 ${chapter.title}\n${chapter.content.slice(0, 900)}`)
    .join('\n\n');

  // 与路线推演同源的结构化上下文，并始终带入世界、项目 brief、角色和 lore。
  const canon = buildStoryStateCanon(analysis ?? null);
  const contextBlock = formatOutlineContext(novel, canon);

  const routeText = route
    ? `\n\n【已选续写路线】\n路线名称：${route.title}\n核心前提：${route.premise}\n剧情节拍：${route.beats
        .map((beat) => `第${beat.chapter}拍 ${beat.summary}`)
        .join('；')}\n角色关键决定：${route.characterDecisions
        .map((item) => `${item.character}：${item.decision}`)
        .join('；')}\n推进/回收伏笔：${route.hookAdvance.join('、')}\n风险提示：${route.risks
        .map((risk) => `[${risk.kind}] ${risk.description}`)
        .join('；')}\n\n请围绕该路线规划后续卷纲与逐章细纲，节拍应按路线推进。`
    : '';

  const worldPlanRequirement = targetChapterCount
    ? `\n\n【本次大纲规格】\n${worldContext ? '这是一个独立小世界，只规划当前小世界。' : '这是正文与续写共同使用的全书大纲。'}必须恰好生成 ${targetChapterCount} 章，总字数目标约 ${targetWords || '未指定'} 字；每章都要有具体标题与可执行的叙事目标。`
    : normalizedChapterCountRange
      ? `\n\n【本次大纲规格】\n这是对现有卷结构的重构提案，只规划当前卷；章节数必须在 ${normalizedChapterCountRange.min}-${normalizedChapterCountRange.max} 章之间，由剧情需要决定，总字数目标约 ${targetWords || '未指定'} 字。可以新增、合并、删除或改写章节，但必须保留未被作者指令否定的核心冲突与人物动机。`
    : '';
  const authorBriefBlock = targetChapterCount || normalizedChapterCountRange
    ? userBrief?.trim()
      ? `\n\n【本次作者指令（上下文末尾，必须执行）】\n${userBrief.trim()}`
      : `\n\n【本次作者指令（上下文末尾）】\n作者未提供额外梗概：请根据${worldContext ? '当前世界设定、任务和人物' : '全书设定、人物与核心冲突'}自主设计完整故事。`
    : '';
  const userPrompt = `${contextBlock}

【前文最近章节】
${sample || '（无前文）'}

【当前进度】前文已到第 ${nextChapterIndex - 1} 章，请从第 ${nextChapterIndex} 章开始规划。${routeText}${worldContext ? `\n\n【当前小世界设定】\n${worldContext}` : ''}${worldPlanRequirement}${authorBriefBlock}`;

  const result = await requestCompletionWithUsage({ responseFormat: 'json',
    apiSettings,
    messages: [
      { role: 'system', content: buildOutlineSystemPrompt(targetChapterCount, normalizedChapterCountRange) },
      { role: 'user', content: userPrompt },
    ],
    purpose: 'outline',
    maxTokens: targetChapterCount || normalizedChapterCountRange
      ? Math.min(8192, Math.max(2048, (targetChapterCount ?? normalizedChapterCountRange!.max) * 150))
      : 2048,
    temperature: 0.6,
  });

  const payload = (extractJsonObject(result.content) ?? {}) as Record<string, unknown>;
  const volumes = Array.isArray(payload.volumes)
    ? payload.volumes.map((volume) => {
        const entry = (volume ?? {}) as Record<string, unknown>;
        const chapters = Array.isArray(entry.chapters)
          ? entry.chapters
              .map((chapter) => {
                const plan = (chapter ?? {}) as Record<string, unknown>;
                const index = Number(plan.index);
                return {
                  index: Number.isFinite(index) ? index : nextChapterIndex,
                  title: asString(plan.title),
                  goal: asString(plan.goal),
                  sceneEnd: typeof plan.sceneEnd === 'boolean' ? plan.sceneEnd : undefined,
                  characterChange: asString(plan.characterChange) || undefined,
                  foreshadowing: asString(plan.foreshadowing) || undefined,
                  endingHook: asString(plan.endingHook) || undefined,
                };
              })
              .filter((plan) => plan.title.length > 0)
          : [];
        return {
          id: `volume-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: asString(entry.title) || '未命名卷',
          summary: asString(entry.summary),
          tone: asString(entry.tone) || undefined,
          foreshadowing: asString(entry.foreshadowing) || undefined,
          chapters,
        };
      })
    : [];

  if (volumes.length === 0) {
    throw new Error('大纲生成结果为空，请重试或换用更强的模型。');
  }

  const chapters = volumes.flatMap((volume) => volume.chapters);
  if (targetChapterCount !== undefined && chapters.length !== targetChapterCount) {
    throw new Error(`大纲生成结果包含 ${chapters.length} 章，目标为 ${targetChapterCount} 章，请重试。`);
  }

  if (targetChapterCount !== undefined) {
    const expectedIndexes = Array.from(
      { length: targetChapterCount },
      (_, offset) => nextChapterIndex + offset,
    );
    const actualIndexes = chapters.map((chapter) => chapter.index);
    if (actualIndexes.some((index, position) => index !== expectedIndexes[position])) {
      throw new Error(`大纲章节序号必须从第 ${nextChapterIndex} 章连续递增，请重试。`);
    }
  }

  if (normalizedChapterCountRange) {
    if (
      chapters.length < normalizedChapterCountRange.min
      || chapters.length > normalizedChapterCountRange.max
    ) {
      throw new Error(
        `重构结果包含 ${chapters.length} 章，允许范围为 ${normalizedChapterCountRange.min}-${normalizedChapterCountRange.max} 章，请重试。`,
      );
    }
    const expectedIndexes = Array.from(
      { length: chapters.length },
      (_, offset) => nextChapterIndex + offset,
    );
    const actualIndexes = chapters.map((chapter) => chapter.index);
    if (actualIndexes.some((index, position) => index !== expectedIndexes[position])) {
      throw new Error(`重构后的章节序号必须从第 ${nextChapterIndex} 章连续递增，请重试。`);
    }
  }

  return {
    outline: {
      summary: asString(payload.summary),
      volumes,
      updatedAt: new Date().toISOString(),
    },
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
  };
}

/** Generate only one user-owned volume and return a bounded handoff for the next one. */
export async function generateNovelOutlineVolume(
  input: Parameters<typeof generateOutline>[0] & {
    volumeId: string;
    volumeNumber: number;
    chapterCount: number;
    wordsPerChapter: number;
    incomingHandoff?: string;
    /** Existing volume supplied for an explicit revision proposal. */
    existingVolume?: NovelVolumePlan;
    operation?: 'create' | 'revise' | 'reshape' | 'append';
    /** Allow the model to choose a bounded chapter count instead of replacing one-for-one. */
    allowVariableChapterCount?: boolean;
  },
): Promise<{ volume: NovelVolumePlan; tokens: number }> {
  const {
    volumeId,
    volumeNumber,
    chapterCount,
    wordsPerChapter,
    incomingHandoff,
    existingVolume,
    allowVariableChapterCount = false,
    operation = existingVolume ? 'revise' : 'create',
    ...baseInput
  } = input;
  const safeChapterCount = Math.max(1, Math.trunc(chapterCount));
  const safeWordsPerChapter = Math.max(1, Math.trunc(wordsPerChapter));
  const existingChapterCount = existingVolume?.chapters.length ?? safeChapterCount;
  const variableChapterCountRange = allowVariableChapterCount
    ? {
        // Keep one request bounded enough for the outline model, while leaving
        // real room for a volume to contract or expand around its current size.
        min: 1,
        max: Math.min(80, Math.max(existingChapterCount + 12, 60)),
      }
    : undefined;
  const continuityBrief = [
    existingVolume
      ? `【当前卷现有大纲】\n卷名：${existingVolume.title}\n卷摘要：${existingVolume.summary}\n章节：${existingVolume.chapters
        .map((chapter) => `第${chapter.index}章《${chapter.title}》：${chapter.goal}${chapter.characterChange ? `；人物变化：${chapter.characterChange}` : ''}${chapter.foreshadowing ? `；伏笔：${chapter.foreshadowing}` : ''}${chapter.endingHook ? `；章末衔接：${chapter.endingHook}` : ''}`)
          .join('\n')}\n\n这是一次“${operation === 'append' ? '追加章节' : allowVariableChapterCount ? '修改本卷结构' : '修订章节'}”提案。只修改作者提示明确要求的部分，未提及的卷名、摘要、章节目标和交接信息尽量保留，不要因为重新生成而静默丢失作者内容。${allowVariableChapterCount ? '本次允许为了叙事完整性增加、合并或删除章节，不要求与原章节数相同。' : ''}`
      : '',
    allowVariableChapterCount
      ? `这是第 ${volumeNumber} 卷，只生成这一卷；章节数在 ${variableChapterCountRange!.min}-${variableChapterCountRange!.max} 章之间，由剧情自然决定。`
      : `这是第 ${volumeNumber} 卷，只生成这一卷的 ${safeChapterCount} 章。`,
    incomingHandoff?.trim()
      ? `【上一卷交接】\n${incomingHandoff.trim()}`
      : '',
    baseInput.userBrief?.trim()
      ? `【本次作者修订指令】\n${baseInput.userBrief.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await generateOutline({
    ...baseInput,
    targetChapterCount: allowVariableChapterCount ? undefined : safeChapterCount,
    targetWords: safeChapterCount * safeWordsPerChapter,
    ...(variableChapterCountRange ? { chapterCountRange: variableChapterCountRange } : {}),
    userBrief: continuityBrief || undefined,
  });
  const chapters = result.outline.volumes.flatMap((volume) => volume.chapters);
  const modelTitle = result.outline.volumes[0]?.title;
  const modelSummary = result.outline.volumes
    .map((volume) => volume.summary)
    .filter(Boolean)
    .join('\n');
  const lastChapter = chapters[chapters.length - 1];
  const outgoingHandoff = [
    result.outline.summary,
    modelSummary,
    lastChapter
      ? `卷末：第${lastChapter.index}章《${lastChapter.title}》——${lastChapter.goal}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);

  return {
    volume: {
      id: volumeId,
      title: modelTitle || existingVolume?.title || `第 ${volumeNumber} 卷`,
      summary: modelSummary || result.outline.summary,
      tone: result.outline.volumes[0]?.tone ?? existingVolume?.tone,
      foreshadowing: result.outline.volumes[0]?.foreshadowing ?? existingVolume?.foreshadowing,
      chapters,
      plannedChapterCount: allowVariableChapterCount ? chapters.length : safeChapterCount,
      wordsPerChapter: safeWordsPerChapter,
      status: 'ready',
      handoff: {
        ...(incomingHandoff?.trim() ? { incoming: incomingHandoff.trim() } : {}),
        outgoing: outgoingHandoff,
      },
      generationError: undefined,
    },
    tokens: result.tokens,
  };
}

/**
 * Revise one chapter plan without asking the model to regenerate its volume.
 * The surrounding outline is context only; the returned patch is locked to the
 * requested chapter index before it can enter the proposal workflow.
 */
export async function generateNovelOutlineChapterRevision({
  apiSettings,
  novel,
  volume,
  chapterIndex,
  instruction,
  analysis,
  worldContext,
}: {
  apiSettings: ApiSettings;
  novel: Novel;
  volume: NovelVolumePlan;
  chapterIndex: number;
  instruction: string;
  analysis?: NovelStoryAnalysis | null;
  worldContext?: string;
}): Promise<{ chapter: NovelVolumeChapter; tokens: number }> {
  const targetPosition = volume.chapters.findIndex((chapter) => chapter.index === chapterIndex);
  const target = volume.chapters[targetPosition];
  if (!target) throw new Error(`找不到第 ${chapterIndex} 章的大纲。`);

  const canon = buildStoryStateCanon(analysis ?? null);
  const contextBlock = formatOutlineContext(novel, canon);
  const recentText = getFinalChapters(novel)
    .slice(-3)
    .map((chapter) => `第${chapter.index}章 ${chapter.title}\n${chapter.content.slice(0, 700)}`)
    .join('\n\n');
  const volumeOutline = volume.chapters
        .map((chapter) => `${chapter.index === chapterIndex ? '→' : '-'} 第${chapter.index}章《${chapter.title}》：${chapter.goal}${chapter.characterChange ? `；人物变化：${chapter.characterChange}` : ''}${chapter.foreshadowing ? `；伏笔：${chapter.foreshadowing}` : ''}${chapter.endingHook ? `；章末衔接：${chapter.endingHook}` : ''}${chapter.sceneEnd ? '［场景收束］' : ''}`)
    .join('\n');

  const result = await requestCompletionWithUsage({ responseFormat: 'json',
    apiSettings,
    messages: [
      {
        role: 'system',
        content: `你是小说章节大纲编辑。你只修改作者指定的一章，不得生成、删除、重排或改写其他章节。只输出 JSON：\n{\n  "index": ${chapterIndex},\n  "title": "章节标题",\n  "goal": "具体、可执行的本章叙事目标",\n  "sceneEnd": true/false,\n  "characterChange": "人物变化（可选）",\n  "foreshadowing": "本章线索（可选）",\n  "endingHook": "章末衔接（可选）"\n}\nindex 必须保持为 ${chapterIndex}；title 与 goal 必须完整。修改应服从作者指令，同时与相邻章节、卷目标、人物和世界设定连续。不要输出 JSON 以外的文字。`,
      },
      {
        role: 'user',
        content: `${contextBlock}\n\n【最近正文】\n${recentText || '（尚无正文）'}${worldContext ? `\n\n【当前小世界设定】\n${worldContext}` : ''}\n\n【当前卷】\n卷名：${volume.title}\n卷目标：${volume.summary || '（未填写）'}\n节奏基调：${volume.tone || '（未填写）'}\n伏笔边界：${volume.foreshadowing || '（未填写）'}\n卷末状态：${volume.handoff?.outgoing || '（未填写）'}\n\n【本卷章节坐标】\n${volumeOutline}\n\n【只允许修改】\n第${target.index}章《${target.title}》\n当前目标：${target.goal}\n当前人物变化：${target.characterChange || '（未填写）'}\n当前伏笔：${target.foreshadowing || '（未填写）'}\n当前章末衔接：${target.endingHook || '（未填写）'}\n当前是否场景收束：${target.sceneEnd ? '是' : '否'}\n\n【作者修改指令】\n${instruction.trim()}`,
      },
    ],
    purpose: 'outline',
    maxTokens: 900,
    temperature: 0.45,
  });

  const chapter = parseNovelOutlineChapterRevision(extractJsonObject(result.content), target);

  return {
    chapter,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
  };
}

/** Generate a long outline in bounded, context-carrying volume batches. */
export async function generateOutlineInVolumes(
  input: Parameters<typeof generateOutline>[0] & {
    chaptersPerVolume?: number;
    onProgress?: (completedChapters: number, totalChapters: number, currentVolume: number) => void;
  },
): Promise<{ outline: NovelOutline; tokens: number }> {
  const {
    targetChapterCount,
    chaptersPerVolume: requestedBatchSize = 20,
    onProgress,
    ...baseInput
  } = input;

  if (targetChapterCount === undefined) {
    throw new Error('按卷生成必须指定 targetChapterCount。');
  }

  const totalChapters = normalizeNovelOutlineOptions({ targetChapterCount }).targetChapterCount!;
  const batchSize = Math.min(totalChapters, Math.max(1, Math.trunc(requestedBatchSize)));
  const allVolumes: NovelOutline['volumes'] = [];
  const summaries: string[] = [];
  let completedChapters = 0;
  let tokens = 0;
  let nextChapterIndex = baseInput.nextChapterIndex;
  const originalUserBrief = baseInput.userBrief?.trim() ?? '';
  let previousHandoff = '';
  let allocatedWords = 0;

  for (let offset = 0, volumeNumber = 1; offset < totalChapters; offset += batchSize, volumeNumber += 1) {
    const chapterCount = Math.min(batchSize, totalChapters - offset);
    const targetWords = baseInput.targetWords === undefined
      ? undefined
      : offset + chapterCount >= totalChapters
        ? baseInput.targetWords - allocatedWords
        : Math.round(baseInput.targetWords * chapterCount / totalChapters);
    const result = await generateOutline({
      ...baseInput,
      nextChapterIndex,
      targetChapterCount: chapterCount,
      targetWords,
      userBrief: [originalUserBrief, previousHandoff].filter(Boolean).join('\n') || undefined,
    });

    allVolumes.push(...result.outline.volumes);
    summaries.push(...result.outline.volumes.map((volume) => volume.summary).filter(Boolean));
    tokens += result.tokens;
    if (targetWords !== undefined) {
      allocatedWords += targetWords;
    }
    completedChapters += chapterCount;
    onProgress?.(completedChapters, totalChapters, volumeNumber);

    const chapters = result.outline.volumes.flatMap((volume) => volume.chapters);
    const lastChapter = chapters[chapters.length - 1];
    const lastSummary = result.outline.volumes[result.outline.volumes.length - 1]?.summary ?? result.outline.summary;
    previousHandoff = [
      `【上一批摘要】${result.outline.summary}`,
      `【上一卷摘要】${lastSummary}`,
      lastChapter ? `【上一卷末章】第${lastChapter.index}章《${lastChapter.title}》：${lastChapter.goal}` : '',
    ].filter(Boolean).join('\n');
    nextChapterIndex += chapterCount;
  }

  return {
    outline: {
      summary: summaries.join('\n'),
      volumes: allVolumes,
      updatedAt: new Date().toISOString(),
    },
    tokens,
  };
}
