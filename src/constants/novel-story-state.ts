import type {
  NovelStoryAnalysis,
  NovelStyleProfile,
} from '@/types/tavern';

/** 空文风画像。 */
export const EMPTY_STYLE_PROFILE: NovelStyleProfile = {
  pointOfView: '',
  sentenceLength: '',
  dialogueRatio: '',
  pacing: '',
  languageFeatures: '',
};

/**
 * 创建一个空的 StoryState 分析产物。
 * schemaVersion 固定 1；totalChapters 用于 manifest 进度展示。
 */
export function createEmptyStoryAnalysis(totalChapters = 0): NovelStoryAnalysis {
  const now = new Date().toISOString();
  return {
    stateVersion: 0,
    lastAnalyzedChapter: 0,
    manifest: {
      schemaVersion: 1,
      status: 'idle',
      progress: 0,
      totalChapters,
      updatedAt: now,
    },
    worldFacts: [],
    characters: [],
    characterStates: [],
    relationships: [],
    timeline: [],
    plotThreads: [],
    hooks: [],
    chapterSummaries: [],
    styleProfile: { ...EMPTY_STYLE_PROFILE },
    checkpoint: undefined,
  };
}

/** 单章内容指纹：基于标题与正文的轻量哈希，用于检测章节变化。 */
export function computeChapterFingerprint(title: string, content: string): string {
  const source = `${title}\n${content}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  // 加长度分量，避免纯字符内容撞哈希。
  return `${(hash >>> 0).toString(16)}-${source.length}`;
}

/** 正史指纹：拼接全部定稿章节的内容指纹。 */
export function computeStoryFingerprint(
  chapters: readonly { title: string; content: string }[],
): string {
  return chapters
    .map((chapter) => computeChapterFingerprint(chapter.title, chapter.content))
    .join('|');
}

/** 路线推演 / 计划 stale 判定阈值相关常量。 */
export const FORECAST_MIN_ROUTES = 3;
export const FORECAST_MAX_ROUTES = 5;
export const FORECAST_DEFAULT_HORIZON = 5;

/** 分析任务单章最大正文字符数（超出则截断进分析上下文）。 */
export const ANALYSIS_CHAPTER_MAX_CHARS = 8000;
/** 分析单轮最多同时处理的章节数。 */
export const ANALYSIS_BATCH_CHAPTERS = 3;

/** 伏笔逾期提醒阈值（超过 N 章未推进则提示）。 */
export const HOOK_OVERDUE_AFTER_CHAPTERS = 8;

/** 8 维审查（postive.md：MVP 八维度）。 */
export const REWRITE_AUDIT_DIMENSIONS = [
  { id: 'ooc', label: '人设 / OOC', category: 'character' },
  { id: 'timeline', label: '时间线与因果', category: 'continuity' },
  { id: 'world', label: '世界规则冲突', category: 'consistency' },
  { id: 'info', label: '角色信息越界', category: 'consistency' },
  { id: 'hook', label: '伏笔推进与回收', category: 'foreshadowing' },
  { id: 'plot', label: '主线和支线偏移', category: 'structure' },
  { id: 'pacing', label: '节奏 / 重复 / 流水账', category: 'rhythm' },
  { id: 'drift', label: '偏离路线与要求', category: 'structure' },
] as const;

/** 审查严重度。 */
export const REWRITE_AUDIT_SEVERITIES = ['critical', 'warning', 'info'] as const;

/** 审查得分通过线 / 净提升阈值（InkOS 同款思想：保留更高分版本）。 */
export const REWRITE_PASS_SCORE = 85;
export const REWRITE_NET_IMPROVEMENT_EPSILON = 3;

/** 续写路线生成 prompt 模板占位（写入 pipeline，不落这里）。 */
