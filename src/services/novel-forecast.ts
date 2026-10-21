import {
  FORECAST_DEFAULT_HORIZON,
  FORECAST_MAX_ROUTES,
  FORECAST_MIN_ROUTES,
} from '@/constants/novel-story-state';
import type {
  NovelChapter,
  NovelForecast,
  NovelForecastRoute,
  NovelRouteRisk,
  NovelStoryAnalysis,
} from '@/types/tavern';
import type { LlmCompletion, LlmMessage } from '@/services/novel-story-state';

// ─────────────────────────────────────────────────────────────────────────────
// 严格校验 —— 路线推演输出非法则整批丢弃
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`路线推演输出非法：字段 ${field} 应为字符串`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`路线推演输出非法：字段 ${field} 应为数字`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`路线推演输出非法：字段 ${field} 应为字符串数组`);
  }
  return value as string[];
}

function normalizeEnum<T extends string>(
  value: unknown,
  entries: readonly { value: T; aliases?: readonly string[] }[],
  fallback: T,
): T {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`路线推演输出非法：字段应为字符串`);
  }
  const normalized = value.trim().toLowerCase();
  for (const entry of entries) {
    if (entry.value === normalized || entry.aliases?.includes(normalized)) {
      return entry.value;
    }
  }
  return fallback;
}

function parseRisk(value: unknown): NovelRouteRisk {
  if (!isPlainObject(value)) {
    throw new Error('路线推演输出非法：risk 必须是对象');
  }
  const kind = normalizeEnum(
    value.kind,
    [
      { value: 'continuity', aliases: ['连贯', '连续性', '设定', '前后矛盾'] },
      { value: 'causality', aliases: ['因果', '因果性', '逻辑', 'causal'] },
      { value: 'character', aliases: ['人物', '角色', 'ooc', '人设'] },
    ],
    'continuity',
  );
  return {
    kind: kind as NovelRouteRisk['kind'],
    description: requireString(value.description, 'risk.description'),
  };
}

function parseRoute(value: unknown, routeId: string): NovelForecastRoute {
  if (!isPlainObject(value)) {
    throw new Error('路线推演输出非法：route 必须是对象');
  }
  const beatsValue = value.beats;
  if (!Array.isArray(beatsValue)) {
    throw new Error('路线推演输出非法：route.beats 应为数组');
  }
  const beats = beatsValue.map((beat) => {
    if (!isPlainObject(beat)) {
      throw new Error('路线推演输出非法：beat 必须是对象');
    }
    return {
      chapter: requireNumber(beat.chapter, 'beat.chapter'),
      summary: requireString(beat.summary, 'beat.summary'),
    };
  });
  if (beats.length === 0) {
    throw new Error('路线推演输出非法：route.beats 不能为空');
  }

  const decisionsValue = value.characterDecisions;
  const decisions = Array.isArray(decisionsValue)
    ? decisionsValue.map((item) => {
        if (!isPlainObject(item)) {
          throw new Error('路线推演输出非法：characterDecision 必须是对象');
        }
        return {
          character: requireString(item.character, 'characterDecision.character'),
          decision: requireString(item.decision, 'characterDecision.decision'),
        };
      })
    : [];

  const projected = value.projectedChanges;
  const projectedChanges = isPlainObject(projected)
    ? {
        characters: requireStringArray(projected.characters ?? [], 'projectedChanges.characters'),
        relationships: requireStringArray(
          projected.relationships ?? [],
          'projectedChanges.relationships',
        ),
        world: requireStringArray(projected.world ?? [], 'projectedChanges.world'),
      }
    : { characters: [] as string[], relationships: [] as string[], world: [] as string[] };

  const risksValue = value.risks;
  const risks = Array.isArray(risksValue) ? risksValue.map(parseRisk) : [];
  const intentScore = requireNumber(value.intentScore, 'route.intentScore');
  if (intentScore < 0 || intentScore > 100) {
    throw new Error('路线推演输出非法：route.intentScore 必须在 0-100');
  }

  return {
    routeId,
    title: requireString(value.title, 'route.title'),
    premise: requireString(value.premise, 'route.premise'),
    beats,
    characterDecisions: decisions,
    hookAdvance: requireStringArray(value.hookAdvance ?? [], 'route.hookAdvance'),
    projectedChanges,
    risks,
    intentScore,
    intentRationale: requireString(value.intentRationale, 'route.intentRationale'),
    ...(typeof value.endingNote === 'string' ? { endingNote: value.endingNote } : {}),
  };
}

export type ForecastModelOutput = {
  routes: NovelForecastRoute[];
};

export function parseForecastOutput(raw: string, expectedCount: number): ForecastModelOutput {
  const jsonSlice = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (error) {
    throw new Error(`路线推演输出不是合法 JSON：${String(error)}`);
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.routes)) {
    throw new Error('路线推演输出缺少 routes 数组');
  }
  const routes = parsed.routes as unknown[];
  if (routes.length < FORECAST_MIN_ROUTES || routes.length > FORECAST_MAX_ROUTES) {
    throw new Error(`路线推演输出 routes 数量须在 ${FORECAST_MIN_ROUTES}-${FORECAST_MAX_ROUTES}`);
  }
  void expectedCount;
  return {
    routes: routes.map((item, index) => parseRoute(item, `route-${index + 1}`)),
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

// ─────────────────────────────────────────────────────────────────────────────
// 推演 prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildForecastSystemPrompt(mode: 'continue' | 'ending'): string {
  const endingExtra = mode === 'ending'
    ? `这是「结局重写」：故事要在此后收束为结局，请说明各主要人物弧与核心伏笔如何收束（endingNote）。`
    : `这是「断更续写」：从故事中断处继续推进。`;
  return `你是资深小说剧情推演师。用户给你当前小说状态与用户要求，你需要给出 ${FORECAST_MIN_ROUTES} 条互相独立、非正史的故事路线推演。
${endingExtra}
每条路线都是「候选设想」，不会被立即写入正文或正史。

输出必须严格为以下 JSON（不要输出其他文字）：
{
  "routes": [{
    "title": "路线名称",
    "premise": "核心前提（一句话）",
    "beats": [{ "chapter": 相对章节号1..N, "summary": "该节拍剧情概要" }],
    "characterDecisions": [{ "character": "角色名", "decision": "关键决定" }],
    "hookAdvance": ["推进/回收的伏笔关键词"],
    "projectedChanges": { "characters": ["人物状态变化"], "relationships": ["关系变化"], "world": ["世界状态变化"] },
    "risks": [{ "kind": "continuity| causality|character", "description": "风险描述" }],
    "intentScore": 0到100的整数,
    "intentRationale": "与用户意图匹配的理由"
    ${mode === 'ending' ? ',"endingNote": "各主要人物弧和核心伏笔如何收束"' : ''}
  }]
}
要求：三条路线在核心前提上必须明显区分；beats 覆盖未来 3-5 章；intentScore 体现与用户「必须保留/禁止发生」的吻合度。`;
}

/** 状态分析 → 结构化上下文摘要（路线推演与大纲生成共用，保证两者基于同一认知，减少偏差）。 */
export function buildStoryStateCanon(analysis: NovelStoryAnalysis | null): string {
  if (!analysis) {
    return '';
  }

  const canonParts: string[] = [];
  if (analysis.worldFacts.length > 0) {
    canonParts.push(
      `【世界规则与正史】\n${analysis.worldFacts
        .map((fact) => `- ${fact.subject}：${fact.content}`)
        .join('\n')}`,
    );
  }
  if (analysis.characters.length > 0) {
    canonParts.push(
      `【主要人物】\n${analysis.characters
        .map((character) => `- ${character.name}（${character.role}）：${character.profile}`)
        .join('\n')}`,
    );
  }
  if (analysis.characterStates.length > 0) {
    canonParts.push(
      `【人物当前状态】\n${analysis.characterStates
        .map(
          (state) =>
            `- ${state.characterId}：${state.currentState}；目标 ${state.goal}；知道[${state.knows.join('、')}]`,
        )
        .join('\n')}`,
    );
  }
  const openHooks = analysis.hooks.filter((hook) => hook.status !== 'resolved');
  if (openHooks.length > 0) {
    canonParts.push(
      `【未回收伏笔】\n${openHooks
        .map(
          (hook) =>
            `- ${hook.keyword}（${hook.status}，埋于第${hook.startChapter}章，最近推进第${hook.lastAdvancedChapter}章）：${hook.description}，预期回收：${hook.expectedPayoff}`,
        )
        .join('\n')}`,
    );
  }
  if (analysis.plotThreads.length > 0) {
    canonParts.push(
      `【剧情线】\n${analysis.plotThreads
        .map((thread) => `- ${thread.title}（${thread.kind}）：${thread.description}；当前：${thread.progress}`)
        .join('\n')}`,
    );
  }

  return canonParts.join('\n\n');
}

function buildForecastUserPrompt(params: {
  novelName: string;
  mode: 'continue' | 'ending';
  divergenceChapter: number;
  analysis: NovelStoryAnalysis | null;
  recentChapters: NovelChapter[];
  userGuide: { endingPreference: string; targetLength: string; mustKeep: string; mustAvoid: string };
}): string {
  const { analysis } = params;

  const canon = buildStoryStateCanon(analysis);

  const recentBlock =
    params.recentChapters.length > 0
      ? `\n【最近剧情结尾】\n${params.recentChapters
          .map((chapter) => `第${chapter.index}章 ${chapter.title}\n${chapter.content.slice(-1500)}`)
          .join('\n\n')}`
      : '';

  const guideLines = [
    `结局倾向：${params.userGuide.endingPreference || '（未指定）'}`,
    `预计篇幅：${params.userGuide.targetLength || '（未指定）'}`,
    `必须保留：${params.userGuide.mustKeep || '（无）'}`,
    `禁止发生：${params.userGuide.mustAvoid || '（无）'}`,
  ].join('\n');

  return `小说《${params.novelName}》，分歧点：第 ${params.divergenceChapter} 章之后。

${canon || '（尚无结构化状态分析，依据原始正文推演）'}
${recentBlock}

【用户要求】
${guideLines}

请给出 ${FORECAST_MIN_ROUTES} 条独立候选路线，输出 JSON。`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 推演主流程
// ─────────────────────────────────────────────────────────────────────────────

export type GenerateForecastOptions = {
  novelName: string;
  mode: 'continue' | 'ending';
  divergenceChapter: number;
  stateVersion: number;
  /** 推演时的正史指纹（stale 判定用）。 */
  fingerprint: string;
  analysis: NovelStoryAnalysis | null;
  /** 分歧点附近章节（用于「最近剧情结尾」）。 */
  recentChapters: NovelChapter[];
  userGuide: { endingPreference: string; targetLength: string; mustKeep: string; mustAvoid: string };
  completion: LlmCompletion;
  horizon?: number;
};

export async function generateForecastRoutes(
  options: GenerateForecastOptions,
): Promise<NovelForecast[]> {
  const horizon = Math.max(1, Math.min(options.horizon ?? FORECAST_DEFAULT_HORIZON, 10));

  const systemPrompt = buildForecastSystemPrompt(options.mode);
  const userPrompt = buildForecastUserPrompt({
    novelName: options.novelName,
    mode: options.mode,
    divergenceChapter: options.divergenceChapter,
    analysis: options.analysis,
    recentChapters: options.recentChapters,
    userGuide: options.userGuide,
  });

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const result = await options.completion(messages, 'story-forecast');
  const parsed = parseForecastOutput(result.content, FORECAST_MIN_ROUTES);
  const now = new Date().toISOString();

  const forecast: NovelForecast = {
    forecastId: `forecast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: options.mode,
    divergenceChapter: options.divergenceChapter,
    stateVersion: options.stateVersion,
    fingerprint: options.fingerprint,
    status: 'active',
    userGuide: options.userGuide,
    routes: parsed.routes.map((route) => ({
      ...route,
      beats: route.beats.slice(0, horizon),
    })),
    createdAt: now,
  };

  return [forecast];
}

