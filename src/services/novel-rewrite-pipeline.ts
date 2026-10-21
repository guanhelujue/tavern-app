import {
  ANTI_AI_RULES,
  NOVEL_LOOKBACK_MAX,
} from '@/constants/novel-continuation';
import { REWRITE_NET_IMPROVEMENT_EPSILON, REWRITE_PASS_SCORE } from '@/constants/novel-story-state';
import type {
  ApiSettings,
  ISODateString,
  NovelChapter,
  NovelContinuationPlan,
  NovelForecast,
  NovelRewriteAudit,
  NovelRewriteAuditIssue,
  NovelStoryAnalysis,
  NovelStoryFactProjection,
  NovelChapterMission,
  NovelCharacterRedLine,
  NovelHookTask,
} from '@/types/tavern';
import {
  mergeStoryAnalysisDelta,
  parseStoryAnalysisDelta,
  remapBatchDelta,
  type LlmCompletion,
  type LlmMessage,
  type StoryAnalysisDelta,
} from '@/services/novel-story-state';
import { buildNovelContextPack, type NovelContextPack } from '@/services/novel-context-pack';

// ─────────────────────────────────────────────────────────────────────────────
// 上下文组装 —— 不可压缩层 + 可压缩层（带字符预算）
// ─────────────────────────────────────────────────────────────────────────────

export type RewriteContextInput = {
  novelName: string;
  characterContext?: string;
  analysis: NovelStoryAnalysis | null;
  /** Active SQLite projection generation; preferred over stale analysis rows. */
  storyFacts?: NovelStoryFactProjection[];
  mission?: NovelChapterMission;
  characterRedLines?: NovelCharacterRedLine[];
  hookTasks?: NovelHookTask[];
  /** 选中路线计划 + 推演（非空则注入路线约束）。 */
  plan: NovelContinuationPlan | null;
  forecast: NovelForecast | null;
  /** 上一章（章末状态）。 */
  lastChapter: NovelChapter | null;
  /** 近 N 章正文片段（可压缩层）。 */
  recentChapters: NovelChapter[];
  /** 用户指导输入。 */
  userGuide: {
    endingPreference: string;
    targetLength: string;
    mustKeep: string;
    mustAvoid: string;
  };
  /** 目标字数。 */
  targetWords: number;
  /** Hard character budget for assembled rewrite context. */
  maxContextChars?: number;
  apiSettings?: Pick<ApiSettings, 'contextWindowTokens' | 'maxTokens'>;
};

/** 组装续写 / 重写上下文。返回 system + user prompt。 */
export function buildRewriteContext(input: RewriteContextInput): {
  systemPrompt: string;
  userPrompt: string;
  contextPack: NovelContextPack;
} {
  const { analysis } = input;
  const activeFacts = (input.storyFacts ?? []).filter((fact) => !fact.stale);
  const decode = (fact: NovelStoryFactProjection) => {
    try {
      const value: unknown = JSON.parse(fact.contentJson);
      return value && typeof value === 'object' ? value as Record<string, unknown> : {};
    } catch {
      return {};
    }
  };
  const projected = (pattern: RegExp) => activeFacts.filter((fact) => pattern.test(fact.factType));
  const projectedCharacters = projected(/^character(?:-state)?$/).map((fact) => {
    const value = decode(fact);
    return {
      id: String(value.characterId ?? value.id ?? fact.subjectId ?? fact.id),
      name: String(value.name ?? value.characterId ?? fact.subjectId ?? fact.id),
      profile: String(value.currentState ?? value.profile ?? ''),
      currentState: String(value.currentState ?? value.profile ?? ''),
      stateVersion: fact.stateVersion,
      locked: fact.locked,
      stale: fact.stale,
      sourceEventIds: [fact.sourceEventId],
    };
  });
  const projectedWorldFacts = projected(/^world-fact$/).map((fact) => {
    const value = decode(fact);
    return {
      id: fact.id,
      subject: String(value.subject ?? fact.subjectId ?? fact.id),
      content: String(value.content ?? ''),
      stateVersion: fact.stateVersion,
      locked: fact.locked || value.canon === true,
      stale: fact.stale,
      sourceEventIds: [fact.sourceEventId],
    };
  });
  const projectedHooks = projected(/^hook$/).map((fact) => {
    const value = decode(fact);
    return {
      id: String(value.id ?? fact.subjectId ?? fact.id),
      keyword: String(value.keyword ?? fact.subjectId ?? ''),
      description: String(value.description ?? ''),
      status: String(value.status ?? 'open'),
      stateVersion: fact.stateVersion,
      stale: fact.stale,
      sourceEventIds: [fact.sourceEventId],
    };
  });
  const usableAnalysis = analysis
    ? {
        characters: analysis.characterStates.filter((item) => !item.stale),
        worldFacts: analysis.worldFacts.filter((item) => !item.stale),
        hooks: analysis.hooks.filter((item) => !item.stale),
      }
    : null;
  const contextPack = buildNovelContextPack(
    input.apiSettings ?? { contextWindowTokens: Math.max(4096, Math.ceil((input.maxContextChars ?? 6000) / 2) + 2048), maxTokens: 2048 },
    {
      currentChapterGoal: input.lastChapter?.goal || input.plan?.routeId || '',
      currentScene: input.lastChapter?.content.slice(-1200) ?? '',
      recentChapterSummaries: analysis?.chapterSummaries.map((row) => ({
        chapter: row.chapter, title: row.title, summary: `${row.events}；${row.stateChanges}`,
        stateVersion: analysis.stateVersion,
      })),
      activeCharacters: projectedCharacters.length ? projectedCharacters : usableAnalysis?.characters.map((state) => ({
        id: state.characterId,
        name: analysis?.characters.find((item) => item.id === state.characterId)?.name ?? state.characterId,
        currentState: `${state.currentState}；目标：${state.goal}；动机：${state.motive}`,
        stateVersion: analysis?.stateVersion,
      })),
      lockedWorldFacts: projectedWorldFacts.length ? projectedWorldFacts : usableAnalysis?.worldFacts.map((fact) => ({
        id: fact.id, subject: fact.subject, content: fact.content,
        locked: fact.canon, stale: fact.stale, stateVersion: analysis?.stateVersion,
      })),
      relevantRelations: analysis?.relationships.map((relation) => ({
        id: relation.id, fromCharacter: relation.fromCharacter, toCharacter: relation.toCharacter,
        relation: relation.relation, description: relation.description, stateVersion: analysis.stateVersion,
      })),
      unresolvedHooks: projectedHooks.length ? projectedHooks : usableAnalysis?.hooks.map((hook) => ({
        id: hook.id, keyword: hook.keyword, description: hook.description,
        status: hook.status, stateVersion: analysis?.stateVersion,
      })),
      styleConstraints: analysis ? [
        `视角：${analysis.styleProfile.pointOfView}；节奏：${analysis.styleProfile.pacing}；语言：${analysis.styleProfile.languageFeatures}`,
      ] : [],
      retrievalQuery: [
        input.lastChapter?.goal,
        input.lastChapter?.content.slice(-1200),
        input.plan?.routeId,
        input.userGuide.mustKeep,
        input.userGuide.mustAvoid,
      ].filter(Boolean).join('\n'),
    },
  );

  // ── 不可压缩层：正史与世界规则 ──────────────────────────────────────────
  const protectedParts: string[] = [];
  if (input.mission) {
    protectedParts.push(
      `【本章任务卡】\n目标：${input.mission.goal}\n必须出场：${input.mission.mustAppearCharacterIds.join('、') || '无'}\n` +
      `必须推进剧情线：${input.mission.mustAdvanceThreadIds.join('、') || '无'}\n必须推进伏笔：${input.mission.mustAdvanceHookIds.join('、') || '无'}`,
    );
  }
  if (input.characterRedLines?.length) {
    protectedParts.push(`【人物红线卡】\n${input.characterRedLines.map((card) =>
      `- ${card.name}(${card.characterId})：不可变[${card.immutable.join('；') || '无'}]；当前[${card.currentState || '未知'}]；知道[${card.knows.join('、')}]；不知道[${card.unknown.join('、')}]`,
    ).join('\n')}`);
  }
  if (input.hookTasks?.length) {
    protectedParts.push(`【伏笔任务卡】\n${input.hookTasks.map((task) =>
      `- ${task.keyword}(${task.hookId})：${task.instruction}；逾期 ${task.overdueBy} 章；依赖[${task.dependsOn.join('、') || '无'}]；预期[${task.expectedPayoff || '未指定'}]`,
    ).join('\n')}`);
  }
  {
    const canonFacts = contextPack.lockedWorldFacts.slice(0, 20);
    if (canonFacts.length > 0) {
      protectedParts.push(
        `【正史与世界规则（不可违反）】\n${canonFacts
          .map((fact) => `- ${fact.text.slice(0, 200)}`)
          .join('\n')}`,
      );
    }

    const states = contextPack.activeCharacters.slice(0, 12);
    if (states.length > 0) {
      protectedParts.push(
        `【人物当前状态与信息边界】\n${states
          .map((state) => `- ${state.text.slice(0, 240)}`)
          .join('\n')}`,
      );
    }

    const openHooks = contextPack.unresolvedHooks.slice(0, 12);
    if (openHooks.length > 0) {
      protectedParts.push(
        `【未回收伏笔】\n${openHooks
          .map((hook) => `- ${hook.text.slice(0, 220)}`)
          .join('\n')}`,
      );
    }
  }

  // ── 不可压缩层：用户要求 + 选中路线 ─────────────────────────────────────
  const guideLines = [
    `结局倾向：${input.userGuide.endingPreference || '（未指定）'}`,
    `预计篇幅：${input.userGuide.targetLength || '（未指定）'}`,
    `必须保留：${input.userGuide.mustKeep || '（无）'}`,
    `禁止发生：${input.userGuide.mustAvoid || '（无）'}`,
  ].join('\n');
  protectedParts.push(`【用户要求】\n${guideLines}`);

  const routePlan = input.plan;
  const routeForecast = input.forecast;
  const route =
    routePlan && routeForecast
      ? routeForecast.routes.find((item) => item.routeId === routePlan.routeId)
      : undefined;
  if (route) {
    const routeParts: string[] = [
      `路线：${route.title}`,
      `核心前提：${route.premise}`,
      `关键决定：${route.characterDecisions.map((item) => `${item.character}：${item.decision}`).join('；')}`,
      `推进/回收伏笔：${route.hookAdvance.join('、')}`,
      `未来节拍：${route.beats.map((beat) => `第${beat.chapter}拍 ${beat.summary}`).join('；')}`,
    ];
    if (route.endingNote) {
      routeParts.push(`结局收束：${route.endingNote}`);
    }
    protectedParts.push(`【选中的续写路线】\n${routeParts.join('\n')}`);
  }

  // ── 不可压缩层：上一章结尾 ──────────────────────────────────────────────
  if (input.lastChapter) {
    protectedParts.push(
      `【上一章结尾】第${input.lastChapter.index}章 ${input.lastChapter.title}\n${input.lastChapter.content.slice(-1200)}`,
    );
  }

  // ── 可压缩层：历史摘要 + 剧情线 + 相关事件 ──────────────────────────────
  const compressibleParts: string[] = [];
  if (analysis) {
    const summaries = analysis.chapterSummaries
      .filter((row) => row.chapter < (input.lastChapter?.index ?? 0))
      .slice(-5);
    if (summaries.length > 0) {
      compressibleParts.push(
        `【历史章节摘要】\n${summaries
          .map(
            (row) =>
              `第${row.chapter}章 ${row.title}：${row.events.slice(0, 120)}；章末：${row.stateChanges.slice(0, 80)}`,
          )
          .join('\n')}`,
      );
    }
    if (analysis.plotThreads.length > 0) {
      compressibleParts.push(
        `【剧情线】\n${analysis.plotThreads
          .map((thread) => `- ${thread.title}（${thread.kind}）：${thread.description.slice(0, 100)}｜当前：${thread.progress.slice(0, 80)}`)
          .join('\n')}`,
      );
    }
    const timeline = analysis.timeline.slice(-6);
    if (timeline.length > 0) {
      compressibleParts.push(
        `【近期事件】\n${timeline
          .map((event) => `第${event.chapter}章 ${event.subject}：${event.event.slice(0, 100)}`)
          .join('\n')}`,
      );
    }
    const style = analysis.styleProfile;
    if (style.pointOfView || style.sentenceLength) {
      compressibleParts.push(
        `【文风画像】视角：${style.pointOfView}；句长：${style.sentenceLength}；对话比例：${style.dialogueRatio}；节奏：${style.pacing}；语言：${style.languageFeatures}`,
      );
    }
  }

  // ── 可压缩层：近 N 章正文片段 ───────────────────────────────────────────
  const lookback = Math.min(input.recentChapters.length, NOVEL_LOOKBACK_MAX);
  const window = input.recentChapters.slice(-lookback);
  if (window.length > 0) {
    compressibleParts.push(
      `【近期正文片段】\n${window
        .map((chapter) => `第${chapter.index}章 ${chapter.title}\n${chapter.content.slice(-2200)}`)
        .join('\n\n')}`,
    );
  }

  // ── 系统提示组装 ─────────────────────────────────────────────────────────
  const systemParts = [
    `你是《${input.novelName}》的续写作者。请严格遵循「正史与世界规则」「人物状态与信息边界」「未回收伏笔」「选中的路线」「用户要求」写作，保持原作文风，续写约 ${input.targetWords} 字。`,
    ...protectedParts,
    ...compressibleParts,
    ANTI_AI_RULES,
  ];

  const packSections = [
    ...contextPack.currentChapterGoal,
    ...contextPack.currentScene,
    ...contextPack.recentChapterSummaries,
    ...contextPack.activeCharacters,
    ...contextPack.lockedWorldFacts,
    ...contextPack.relevantRelations,
    ...contextPack.unresolvedHooks,
    ...contextPack.styleConstraints,
  ];
  if (packSections.length) {
    systemParts.splice(1, 0, `【统一 Context Pack】\n${packSections.map((item) => `- ${item.text}`).join('\n')}`);
  }

  const userPrompt = `请根据以上约束，续写下一章正文。
- 只输出正文本身，不要输出章节标题、注释或解释。
- 保持叙事视角与语言风格与前文一致。
- 若为结局路线，本章需朝选定的结局收束推进。
- 不要使用「（本章完）」类结尾标注。`;

  const maxContextChars = Math.max(1000, input.maxContextChars ?? 6000);
  const systemPrompt = systemParts.join('\n\n');
  const boundedPrompt = systemPrompt.length > maxContextChars
    ? `${systemPrompt.slice(0, maxContextChars - 18)}\n【上下文已按预算裁剪】`
    : systemPrompt;
  return {
    systemPrompt: [input.characterContext, boundedPrompt].filter(Boolean).join('\n\n'),
    userPrompt,
    contextPack,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 维审查 —— 严格校验审计输出
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_CATEGORIES = new Set(['ooc', 'timeline', 'world', 'info', 'hook', 'plot', 'pacing', 'drift']);
const AUDIT_SEVERITIES = new Set(['critical', 'warning', 'info']);
const AUDIT_SCOPES = new Set(['local', 'structural']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAuditIssue(value: unknown, index: number): NovelRewriteAuditIssue {
  if (!isPlainObject(value)) {
    throw new Error(`审查输出非法：第 ${index} 个问题不是对象`);
  }
  const severity = value.severity;
  const category = value.category;
  const repairScope = value.repairScope ?? 'local';
  if (typeof severity !== 'string' || !AUDIT_SEVERITIES.has(severity)) {
    throw new Error(`审查输出非法：问题 ${index} 的 severity 非法`);
  }
  if (typeof category !== 'string' || !AUDIT_CATEGORIES.has(category)) {
    throw new Error(`审查输出非法：问题 ${index} 的 category 非法`);
  }
  if (typeof repairScope !== 'string' || !AUDIT_SCOPES.has(repairScope)) {
    throw new Error(`审查输出非法：问题 ${index} 的 repairScope 非法`);
  }
  return {
    id: `audit-issue-${Date.now()}-${index}`,
    severity: severity as NovelRewriteAuditIssue['severity'],
    category: category as string,
    description: typeof value.description === 'string' ? value.description : '',
    evidence: typeof value.evidence === 'string' ? value.evidence : '',
    suggestion: typeof value.suggestion === 'string' ? value.suggestion : '',
    repairScope: repairScope as NovelRewriteAuditIssue['repairScope'],
  };
}

export type RewriteAuditOutput = {
  issues: NovelRewriteAuditIssue[];
  score: number;
};

export function parseRewriteAudit(raw: string): RewriteAuditOutput {
  const jsonSlice = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (error) {
    throw new Error(`审查输出不是合法 JSON：${String(error)}`);
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.issues)) {
    throw new Error('审查输出缺少 issues 数组');
  }
  const issues = parsed.issues.map((item, index) => parseAuditIssue(item, index));
  const score =
    typeof parsed.score === 'number' && Number.isFinite(parsed.score)
      ? Math.max(0, Math.min(100, parsed.score))
      : 100;
  return { issues, score };
}

export type AuditRewriteOptions = {
  novelName: string;
  chapter: NovelChapter;
  analysis: NovelStoryAnalysis | null;
  plan: NovelContinuationPlan | null;
  forecast: NovelForecast | null;
  recentChapters: NovelChapter[];
  userGuide: { endingPreference: string; targetLength: string; mustKeep: string; mustAvoid: string };
  completion: LlmCompletion;
};

/** 8 维审查（LLM）。 */
export async function auditRewriteChapter(
  options: AuditRewriteOptions,
): Promise<{ issues: NovelRewriteAuditIssue[]; score: number; passed: boolean; modelId?: string; tokens: number }> {
  const context = buildRewriteContext({
    novelName: options.novelName,
    analysis: options.analysis,
    plan: options.plan,
    forecast: options.forecast,
    lastChapter: options.recentChapters[options.recentChapters.length - 1] ?? null,
    recentChapters: options.recentChapters.slice(-3),
    userGuide: options.userGuide,
    targetWords: 0,
  });

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `你是小说质量审查官。按以下 8 个维度审查给定章节：人设/OOC、时间线与因果、世界规则冲突、角色信息越界、伏笔推进与回收、主线和支线偏移、节奏/重复/流水账、偏离路线与用户要求。
输出严格为 JSON：
{
  "score": 0到100的整数,
  "issues": [
    { "severity": "critical|warning|info", "category": "ooc|timeline|world|info|hook|plot|pacing|drift", "description": "问题描述", "evidence": "对应原文证据片段", "suggestion": "修改建议", "repairScope": "local|structural" }
  ]
}
- critical = 必须修复（否则不能入库）；warning = 建议修复；info = 提示。
- repairScope: local = 局部文字问题可自动修复；structural = 涉及情节/人物决定/结局方向，须用户确认。`,
    },
    {
      role: 'user',
      content: `${context.systemPrompt}\n\n【待审查章节】第${options.chapter.index}章 ${options.chapter.title}\n${options.chapter.content}\n\n请审查并输出 JSON。`,
    },
  ];

  const result = await options.completion(messages, 'rewrite-audit');
  const parsed = parseRewriteAudit(result.content);

  return {
    ...parsed,
    passed: parsed.score >= REWRITE_PASS_SCORE && !parsed.issues.some((issue) => issue.severity === 'critical'),
    modelId: result.modelId,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 修订 —— 局部问题自动修复；结构性修改提示用户
// ─────────────────────────────────────────────────────────────────────────────

export type ReviseRewriteOptions = {
  novelName: string;
  chapter: NovelChapter;
  audit: NovelRewriteAudit;
  completion: LlmCompletion;
  /** 用户确认后允许修订的结构性问题（默认仅 local）。 */
  allowStructural?: boolean;
};

export async function reviseRewriteChapter(
  options: ReviseRewriteOptions,
): Promise<{ content: string; modelId?: string; tokens: number }> {
  const repairIssues = options.audit.issues.filter((issue) => {
    if (issue.severity === 'info') {
      return false;
    }
    return issue.repairScope === 'local' || options.allowStructural;
  });

  if (repairIssues.length === 0) {
    return { content: options.chapter.content, tokens: 0 };
  }

  const issueBlock = repairIssues
    .map(
      (issue, index) =>
        `${index + 1}. [${issue.severity}/${issue.category}] ${issue.description}\n   证据：${issue.evidence}\n   建议：${issue.suggestion}`,
    )
    .join('\n');

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `你是小说修订编辑。根据审查问题修改给定章节，保持原文风格与整体结构。只输出修订后的完整正文，不要输出解释。只修有问题的地方，不要重写无关段落。`,
    },
    {
      role: 'user',
      content: `【审查问题】\n${issueBlock}\n\n【原章节】\n${options.chapter.content}\n\n请输出修订后的完整正文。`,
    },
  ];

  const result = await options.completion(messages, 'rewrite-revise');
  return {
    content: result.content,
    modelId: result.modelId,
    tokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
  };
}

/**
 * 决定是否采用修订版本：只有修订版明确更好时才替换，避免修复一个问题又变差。
 * 纯函数，供 store 与测试共用。
 */
export function shouldAdoptRevision(params: {
  originalScore: number;
  revisedScore: number;
  originalPassed: boolean;
  revisedPassed: boolean;
}): boolean {
  const { originalScore, revisedScore, originalPassed, revisedPassed } = params;
  // 明确更优：分数净提升超过容差，或从“未通过”升为“通过”。
  return revisedScore > originalScore + REWRITE_NET_IMPROVEMENT_EPSILON || (!originalPassed && revisedPassed);
}

// ─────────────────────────────────────────────────────────────────────────────
// 确认后状态增量提取 —— 从最终正文提取人物/伏笔/时间线/摘要增量
// ─────────────────────────────────────────────────────────────────────────────

export async function extractChapterStateDelta(options: {
  novelName: string;
  chapter: NovelChapter;
  analysis: NovelStoryAnalysis | null;
  completion: LlmCompletion;
}): Promise<StoryAnalysisDelta> {
  const systemPrompt = `你是小说状态抽取器。阅读给定章节正文，抽取本轮状态增量，供记忆库更新。
输出严格为 JSON（字段与分析引擎一致，只输出本章新出现或变化的内容）：
{
  "summaries": [{ "chapter": 1, "title": "章名", "events": "", "stateChanges": "", "hookActivity": "", "mood": "" }],
  "worldFacts": [{ "id": "", "subject": "", "content": "", "canon": true, "sourceChapter": 1, "validFromChapter": 1 }],
  "characters": [{ "id": "", "name": "", "role": "", "profile": "" }],
  "characterStates": [{ "characterId": "", "currentState": "", "goal": "", "motive": "", "speakingStyle": "", "knows": [], "unknown": [], "atChapter": 1 }],
  "relationships": [{ "id": "", "fromCharacter": "", "toCharacter": "", "relation": "", "description": "", "atChapter": 1 }],
  "timeline": [{ "id": "", "type": "timeline|location|faction|item|resource", "chapter": 1, "subject": "", "event": "" }],
  "plotThreads": [{ "id": "", "title": "", "kind": "main|sub|arc", "description": "", "progress": "", "startChapter": 1 }],
  "hooks": [{ "id": "", "keyword": "", "description": "", "type": "", "status": "open|progressing|deferred|resolved", "startChapter": 1, "lastAdvancedChapter": 1, "expectedPayoff": "", "importance": "minor|major|core", "dependsOn": [], "supportingEvidence": [], "note": "" }],
  "styleProfile": { "pointOfView": "", "sentenceLength": "", "dialogueRatio": "", "pacing": "", "languageFeatures": "" }
}`;

  const userPrompt = `《${options.novelName}》第${options.chapter.index}章 ${options.chapter.title}\n${options.chapter.content}\n\n请抽取本章状态增量，输出 JSON（chapter 从 1 开始即可，系统会换算绝对章节）。`;

  const result = await options.completion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    'story-state-delta',
  );

  // 严格校验；解析失败不写入状态。
  const delta = parseStoryAnalysisDelta(result.content);
  return shiftDeltaChapters(delta, options.chapter.index - 1);
}

/**
 * 将 delta 中的章节号换算为绝对章节号（offset = 绝对起点 - 1）。
 * 与状态分析一致，兼容模型输出「相对编号」与「绝对编号」两种习惯，
 * 避免模型按绝对章号输出时被无条件 +offset 推高。
 */
export function shiftDeltaChapters(delta: StoryAnalysisDelta, offset: number): StoryAnalysisDelta {
  return remapBatchDelta(delta, offset + 1, 1);
}

/** 确认章节后更新 StoryState：合并状态增量、stateVersion+1、推进 checkpoint。 */
export function applyChapterToStoryState(params: {
  analysis: NovelStoryAnalysis;
  chapter: NovelChapter;
  delta: StoryAnalysisDelta;
  now?: ISODateString;
}): NovelStoryAnalysis {
  const now = params.now ?? new Date().toISOString();
  const merged = mergeStoryAnalysisDelta(
    params.analysis,
    params.delta,
    params.chapter.index,
    now,
  );
  const nextStateVersion = merged.stateVersion + 1;
  const layeredSummaries = buildLayeredSummaries(merged.chapterSummaries, nextStateVersion);
  return {
    ...merged,
    stateVersion: nextStateVersion,
    layeredSummaries,
    lastAnalyzedChapter: Math.max(merged.lastAnalyzedChapter, params.chapter.index),
    manifest: {
      ...merged.manifest,
      status: 'complete',
      progress: 1,
      updatedAt: now,
    },
    checkpoint: merged.checkpoint
      ? {
          ...merged.checkpoint,
          chapter: params.chapter.index,
          fingerprint: merged.checkpoint.fingerprint,
        }
      : merged.checkpoint,
  };
}

export function buildLayeredSummaries(rows: NovelStoryAnalysis['chapterSummaries'], stateVersion: number) {
  const sorted = [...rows].sort((a, b) => a.chapter - b.chapter);
  const group = (size: number, prefix: string) => {
    const result: { id: string; fromChapter: number; toChapter: number; summary: string; stateVersion: number }[] = [];
    for (let index = 0; index < sorted.length; index += size) {
      const slice = sorted.slice(index, index + size);
      if (!slice.length) continue;
      result.push({
        id: `${prefix}-${slice[0].chapter}-${slice.at(-1)!.chapter}`,
        fromChapter: slice[0].chapter,
        toChapter: slice.at(-1)!.chapter,
        summary: slice.map((row) => `第${row.chapter}章：${row.events}；${row.stateChanges}`).join(' ').slice(0, prefix === 'scene' ? 1200 : 3000),
        stateVersion,
      });
    }
    return result;
  };
  const scenes = group(5, 'scene');
  const volumes = group(25, 'volume');
  return {
    scenes,
    volumes,
    book: {
      summary: volumes.map((item) => item.summary).join(' ').slice(-6000),
      throughChapter: sorted.at(-1)?.chapter ?? 0,
      stateVersion,
    },
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
