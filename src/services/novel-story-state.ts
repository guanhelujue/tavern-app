import {
  ANALYSIS_BATCH_CHAPTERS,
  ANALYSIS_CHAPTER_MAX_CHARS,
  computeStoryFingerprint,
  createEmptyStoryAnalysis,
} from '@/constants/novel-story-state';
import type { NovelStoryAnalysis } from '@/types/tavern';
import type { StoryAnalysisDelta } from './novel-story-state-delta';
import {
  dedupeCharactersInAnalysis,
  mergeDelta,
  parseStoryAnalysisDelta,
  remapBatchDelta,
} from './novel-story-state-delta';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** LLM 调用抽象（store action 注入真实实现，测试注入 fake）。 */
export type LlmCompletion = (
  messages: LlmMessage[],
  purpose: string,
) => Promise<{
  content: string;
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** 提供方返回的结束原因（如 'length' 表示被长度上限截断）。 */
  finishReason?: string;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// 严格校验器 —— 所有 LLM 结构化输出必须通过，解析失败不得写入正式状态
// ─────────────────────────────────────────────────────────────────────────────

export {
  dedupeCharactersInAnalysis,
  detectMisalignedStoryAnalysis,
  mapModelChapter,
  mergeStoryAnalysisDelta,
  normalizeAnalysisEntityIds,
  normalizeUniqueEntityIds,
  parseStoryAnalysisDelta,
  remapBatchDelta,
  resetMisalignedStoryAnalysis,
} from './novel-story-state-delta';
export type { StoryAnalysisDelta } from './novel-story-state-delta';

// ─────────────────────────────────────────────────────────────────────────────
// 分析 prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildAnalyzeSystemPrompt(): string {
  return `你是资深小说编辑与文学分析助手。用户会给你「一本已写过的小说的若干章正文」，你需要按章节顺序增量分析并输出结构化 JSON。
输出必须严格为以下 JSON 结构（不要输出其他文字）：
{
  "summaries": [{ "chapter": 数字, "title": "本章核心事件的一句话概括（必须与 events 一致）", "events": "关键事件", "stateChanges": "章末状态/局势落点", "hookActivity": "本章伏笔活动", "mood": "情绪基调" }],
  "worldFacts": [{ "id": "唯一id", "subject": "规则名", "content": "规则内容", "canon": true|false, "sourceChapter": 数字, "validFromChapter": 数字 }],
  "characters": [{ "id": "唯一id", "name": "角色名", "role": "主角/配角/反派…", "profile": "外貌/性格/出身等静态档案的合并摘要", "appearance": "外貌（可省略）", "personality": "性格（可省略）", "speechStyle": "说话方式（可省略）", "background": "出身/背景（可省略）", "motivation": "动机（可省略）", "affiliation": "阵营/所属（可省略）", "evidence": ["出现该角色的原文片段，1~3条（可省略）"] }],
  "characterStates": [{ "characterId": "对应角色id", "currentState": "当前状态", "goal": "当前目标", "motive": "动机", "speakingStyle": "说话方式", "knows": ["知道的信息"], "unknown": ["不知道的信息"], "atChapter": 数字 }],
  "relationships": [{ "id": "唯一id", "fromCharacter": "角色名", "toCharacter": "角色名", "relation": "师徒/宿敌…", "description": "关系状态", "atChapter": 数字 }],
  "timeline": [{ "id": "唯一id", "type": "timeline|location|faction|item|resource", "chapter": 数字, "subject": "对象", "event": "发生的事" }],
  "plotThreads": [{ "id": "唯一id", "title": "线名", "kind": "main|sub|arc", "description": "这条线的目标", "progress": "当前推进状态", "startChapter": 数字 }],
  "hooks": [{ "id": "唯一id", "keyword": "伏笔关键词", "description": "伏笔描述", "type": "mystery|promise|threat…", "status": "open|progressing|deferred|resolved", "startChapter": 数字, "lastAdvancedChapter": 数字, "expectedPayoff": "预期回收", "importance": "minor|major|core", "dependsOn": [], "supportingEvidence": ["原文证据片段"], "note": "" }],
  "styleProfile": { "pointOfView": "叙事视角", "sentenceLength": "句长特征", "dialogueRatio": "对话比例", "pacing": "节奏", "languageFeatures": "语言风格特征" }
}
要求：
- 只报告这批章节中「新出现或发生变化」的内容；已被完整描述的旧设定不要重复。
- 新埋下或推进的伏笔 status 用 open/progressing；已回收的用 resolved。
- 人物 knows/unknown 用于信息边界控制，要具体。
- 所有 id / 引用字段必须用字符串（如 "hook-1"），不要用数字。
- **人物 id 必须稳定唯一**：凡是【已分析到的当前状态摘要】里出现过的人物，必须沿用其已有 id（格式如 名称(人物id:xxx)），绝不能新建 id；只有全书全新角色才分配新 id。同一人物跨批、跨章都用同一个 id。
- **summaries.title 必须从 events 提炼**：标题是本条摘要的核心事件的一句话概括（5~12 字），只能概括 events 里实际发生的内容，绝不能引入 events 中不存在的人物或事件（例如 events 是「新辅导员到任」，title 就不能写「新室友」）；若原文章节标题本身有具体含义（不是「第x章」这类纯序号），优先沿用原文标题。
- **字段优先级**：优先保证 summaries.events、characters、characterStates、hooks、plotThreads 这些核心字段的准确性；worldFacts、relationships、timeline、mood、evidence 等次要字段量力输出，不确定就不要硬编，宁缺毋滥。
- 所有章节号字段（summaries.chapter、worldFacts.sourceChapter、characterStates.atChapter、relationships.atChapter、timeline.chapter、plotThreads.startChapter、hooks 的 startChapter/lastAdvancedChapter 等）一律填「本批内的相对编号」，即本批第 1 章填 1、第 2 章填 2，系统会自动换算为全书绝对章节号，不要填全书章号。
- timeline.type / plotThread.kind / hook.status / hook.importance 严格取对应枚举值，无法归类时 type 用 "timeline"、kind 用 "sub"、status 用 "open"、importance 用 "minor"。`;
}

/**
 * 分析章节正文的截取策略：短章全文喂入；长章取「开头 + 结尾」并标注省略。
 * 章末状态/局势落点（summaries.stateChanges）依赖结尾信息，单纯截头会丢失收尾，
 * 导致摘要与续写上下文缺章末关键信息。
 */
export function truncateChapterForAnalysis(
  content: string,
  maxChars = ANALYSIS_CHAPTER_MAX_CHARS,
): string {
  if (content.length <= maxChars) {
    return content;
  }
  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = maxChars - headChars;
  const omitted = content.length - headChars - tailChars;
  return `${content.slice(0, headChars)}\n…（本章过长，中间约 ${omitted} 字已省略）…\n${content.slice(-tailChars)}`;
}

function buildAnalyzeUserPrompt(params: {
  novelName: string;
  chapters: { index: number; title: string; content: string }[];
  existingStateHint: string;
}): string {
  const chapterBlock = params.chapters
    .map(
      (chapter) =>
        `第${chapter.index}章 ${chapter.title}\n${truncateChapterForAnalysis(chapter.content)}`,
    )
    .join('\n\n');

  return `小说《${params.novelName}》。

【已分析到的当前状态摘要】${params.existingStateHint || '（首轮分析，无前序状态）'}

【本次待分析章节】
${chapterBlock}

请按规则增量分析上述章节，输出 JSON。`;
}

function buildExistingStateHint(analysis: NovelStoryAnalysis | null): string {
  if (!analysis || analysis.lastAnalyzedChapter === 0) {
    return '';
  }
  const parts: string[] = [];
  if (analysis.characters.length > 0) {
    parts.push(
      `人物：${analysis.characters
        .slice(0, 12)
        .map((item) => `${item.name}(人物id:${item.id})`)
        .join('、')}`,
    );
  }
  if (analysis.hooks.length > 0) {
    parts.push(
      `未回收伏笔：${analysis.hooks
        .filter((hook) => hook.status !== 'resolved')
        .slice(0, 8)
        .map((hook) => hook.keyword)
        .join('、')}`,
    );
  }
  if (analysis.plotThreads.length > 0) {
    parts.push(
      `剧情线：${analysis.plotThreads
        .slice(0, 8)
        .map((item) => item.title)
        .join('、')}`,
    );
  }
  return parts.join('；');
}

// ─────────────────────────────────────────────────────────────────────────────
// 增量分析引擎
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyzeStoryStateOptions = {
  novelName: string;
  /** 全部定稿章节（按 index 升序）。 */
  chapters: { index: number; title: string; content: string }[];
  /** 已有分析（未分析过则为 null）。 */
  existingAnalysis: NovelStoryAnalysis | null;
  completion: LlmCompletion;
  /** 每批完成时的回调（progress 0-1）。 */
  onProgress?: (progress: number, chapter: number, status: string) => void;
  /** 每批校验通过后回调当前分析结果（用于断点落盘：中途失败也可从断点续传）。 */
  onCheckpoint?: (analysis: NovelStoryAnalysis) => void;
  /** 是否允许取消（返回 true 表示应中断，paused）。 */
  shouldCancel?: () => boolean;
};

export type AnalyzeStoryStateResult = {
  analysis: NovelStoryAnalysis;
  /** 是否真正执行了模型调用。false = 指纹未变化，直接复用缓存。 */
  ran: boolean;
  /** 中断标记：true = 未完成，可按 checkpoint 恢复。 */
  paused: boolean;
};

/**
 * 增量状态分析：
 * 1. 若已有分析且 checkpoint 指纹与当前正史一致 → 从 checkpoint 后续继续；
 *    若指纹不一致 → 从分歧点重新分析。
 * 2. 每批 ANALYSIS_BATCH_CHAPTERS 章调用一次 LLM，strict 校验后合并。
 * 3. 每次批量写 checkpoint；中断/取消时返回 paused，可恢复。
 */
export async function analyzeStoryStateIncrementally(
  options: AnalyzeStoryStateOptions,
): Promise<AnalyzeStoryStateResult> {
  const { chapters } = options;
  const now = new Date().toISOString();

  // 无正文 → 返回空分析，不触发调用。
  if (chapters.length === 0) {
    const empty = options.existingAnalysis ?? createEmptyStoryAnalysis(0);
    return {
      analysis: {
        ...empty,
        manifest: { ...empty.manifest, status: 'complete', progress: 1, updatedAt: now },
      },
      ran: false,
      paused: false,
    };
  }

  const total = chapters.length;
  let analysis =
    options.existingAnalysis ?? createEmptyStoryAnalysis(total);

  // ── 起点计算：指纹是否仍有效 ────────────────────────────────────────────
  let startFrom = analysis.lastAnalyzedChapter;
  const checkpoint = analysis.checkpoint;
  if (checkpoint && checkpoint.chapter > 0 && checkpoint.chapter <= total) {
    const prefixFingerprint = computeStoryFingerprint(chapters.slice(0, checkpoint.chapter));
    if (prefixFingerprint !== checkpoint.fingerprint) {
      // 分歧点前章节已变化 → 从分歧点重新分析。
      startFrom = checkpoint.chapter - 1;
      analysis = {
        ...analysis,
        lastAnalyzedChapter: startFrom,
        worldFacts: [],
        characters: [],
        characterStates: [],
        relationships: [],
        timeline: [],
        plotThreads: [],
        hooks: [],
        chapterSummaries: [],
      };
    } else if (analysis.lastAnalyzedChapter < checkpoint.chapter) {
      startFrom = checkpoint.chapter;
    }
  }

  // ── 已全部分析且指纹未变化 → 复用缓存 ──────────────────────────────────
  if (startFrom >= total) {
    return {
      analysis: {
        ...analysis,
        manifest: { ...analysis.manifest, status: 'complete', progress: 1, updatedAt: now },
        checkpoint: {
          chapter: total,
          fingerprint: computeStoryFingerprint(chapters),
          createdAt: now,
        },
      },
      ran: false,
      paused: false,
    };
  }

  const effectiveAnalysis = {
    ...analysis,
    manifest: { ...analysis.manifest, status: 'running' as const, progress: startFrom / total },
  };

  let paused = false;
  for (let cursor = startFrom; cursor < total; cursor += ANALYSIS_BATCH_CHAPTERS) {
    if (options.shouldCancel?.()) {
      paused = true;
      break;
    }

    const batch = chapters.slice(cursor, cursor + ANALYSIS_BATCH_CHAPTERS);
    const upToChapter = batch[batch.length - 1].index;

    const systemPrompt = buildAnalyzeSystemPrompt();
    const userPrompt = buildAnalyzeUserPrompt({
      novelName: options.novelName,
      chapters: batch,
      existingStateHint: buildExistingStateHint(effectiveAnalysis),
    });

    const result = await options.completion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      'story-state-analyze',
    );

    // 严格校验：解析失败自动重试一次（部分截断 / 格式抖动可自愈），仍失败才抛错。
    let delta: StoryAnalysisDelta;
    try {
      delta = parseStoryAnalysisDelta(result.content);
    } catch {
      const retryResult = await options.completion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: result.content },
          {
            role: 'user',
            content: '上次输出未通过 JSON 校验。请修复格式并保留已经完整的字段和条目，只补足原文能够支持的缺失内容，不要编造事实。只输出完整 JSON 对象。',
          },
        ],
        'story-state-analyze-retry',
      );
      try {
        delta = parseStoryAnalysisDelta(retryResult.content);
      } catch (error) {
        const truncationHint =
          retryResult.finishReason === 'length'
            ? '；本次输出因长度上限被截断（finish_reason=length），请到系统设置调大「对话长度上限」后重试'
            : '';
        const message =
          error instanceof Error ? error.message : `分析输出不是合法 JSON：${String(error)}`;
        throw new Error(`${message}${truncationHint}`);
      }
    }

    // 章节号映射：兼容模型输出「批内相对编号」与「绝对编号」两种习惯，
    // 不再无条件 +offset（后者会把章号整体推高，导致 32 章被记到 62 章）。
    const shiftedDelta = remapBatchDelta(delta, batch[0].index, batch.length);

    const merged = mergeDelta(effectiveAnalysis, shiftedDelta, upToChapter, now);
    // 人物归一化：模型跨批 id 漂移时，characters / characterStates 同步合并，
    // 避免「同人不同 id」累积出重复人物与重复状态（一人被记多次的根因之一）。
    const normalized = dedupeCharactersInAnalysis(merged);
    normalized.checkpoint = {
      chapter: upToChapter,
      fingerprint: computeStoryFingerprint(chapters.slice(0, upToChapter)),
      createdAt: now,
    };

    options.onProgress?.(upToChapter / total, upToChapter, 'analyzing');
    // 断点落盘：每批成功后把当前分析结果交给调用方保存，中途失败可从断点续传。
    options.onCheckpoint?.({ ...normalized });
    void cursor;

    // 更新 effectiveAnalysis 供下一批 existingStateHint 使用。
    Object.assign(effectiveAnalysis, normalized);
  }

  const complete = !paused;
  const finalAnalysis: NovelStoryAnalysis = {
    ...effectiveAnalysis,
    manifest: {
      ...effectiveAnalysis.manifest,
      status: complete ? 'complete' : 'paused',
      progress: complete ? 1 : (effectiveAnalysis.lastAnalyzedChapter ?? 0) / total,
      updatedAt: now,
    },
    checkpoint: {
      chapter: effectiveAnalysis.lastAnalyzedChapter,
      fingerprint: computeStoryFingerprint(chapters.slice(0, effectiveAnalysis.lastAnalyzedChapter)),
      createdAt: now,
    },
  };

  return { analysis: finalAnalysis, ran: true, paused };
}

/** 章节变化后失效分析：从指定章节开始重分析。 */
export function invalidateStoryAnalysis(
  analysis: NovelStoryAnalysis | null,
  fromChapterIndex: number,
): NovelStoryAnalysis | null {
  if (!analysis) {
    return null;
  }
  const startFrom = Math.max(0, fromChapterIndex - 1);
  return {
    ...analysis,
    lastAnalyzedChapter: Math.min(analysis.lastAnalyzedChapter, startFrom),
    manifest: {
      ...analysis.manifest,
      status: 'paused',
      progress: analysis.lastAnalyzedChapter > 0 ? startFrom / analysis.lastAnalyzedChapter : 0,
      updatedAt: new Date().toISOString(),
    },
    checkpoint:
      startFrom > 0 && analysis.checkpoint
        ? {
            chapter: startFrom,
            fingerprint: analysis.checkpoint.fingerprint,
            createdAt: analysis.checkpoint.createdAt,
          }
        : undefined,
  };
}

/** 正史是否已完整分析且指纹未变（可复用缓存）。 */
export function isStoryAnalysisFresh(
  analysis: NovelStoryAnalysis | null,
  finalChapters: readonly { title: string; content: string }[],
): boolean {
  if (!analysis) {
    return false;
  }
  if (analysis.manifest.status !== 'complete') {
    return false;
  }
  if (analysis.lastAnalyzedChapter !== finalChapters.length) {
    return false;
  }
  if (analysis.checkpoint) {
    return analysis.checkpoint.fingerprint === computeStoryFingerprint(finalChapters);
  }
  return false;
}
