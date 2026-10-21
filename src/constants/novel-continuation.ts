import type { NovelAuditCategory, NovelContinuationSettings } from '@/types/tavern';

/** Default pipeline settings applied to every novel (may be overridden per novel). */
export const DEFAULT_NOVEL_CONTINUATION_SETTINGS: NovelContinuationSettings = {
  lookbackChapters: 3,
  targetWords: 1800,
  autoAudit: true,
  autoForeshadowingTrack: true,
  useAntiAiRules: true,
  useOutline: true,
  maxContextChars: 6000,
};

/** Hard caps for lookback / context so a mis-set value cannot blow the prompt. */
export const NOVEL_LOOKBACK_MAX = 20;
export const NOVEL_CONTEXT_MAX_CHARS = 20000;
/**
 * 目标字数允许范围。上限配合分段续写：超过单段安全字数会自动拆分，
 * 因此允许填到「分段上限 × 单段字数」（8 × 2500）。
 */
export const NOVEL_TARGET_WORDS_RANGE: [number, number] = [400, 20000];

/**
 * 单段续写的安全字数上界：超过时按目标字数自动拆分为多段顺序生成，
 * 段与段衔接（携带已写正文），最后合并为一章草稿，规避长文漂移 / 超时 / 截断。
 */
export const NOVEL_SEGMENT_MAX_WORDS = 2500;
/** 分段上限，防止极端目标字数把一次续写拖成几十次请求。 */
export const NOVEL_SEGMENT_MAX_COUNT = 8;

/**
 * 长章节自动分段：目标字数超过单段安全上界时拆成多段顺序生成。
 * 返回段数与每段目标字数（至少 200 字），段数不超过上限。纯函数，便于单测。
 */
export function resolveWriteSegments(
  targetWords: number,
  maxSegmentWords = NOVEL_SEGMENT_MAX_WORDS,
  maxSegments = NOVEL_SEGMENT_MAX_COUNT,
): { segments: number; perSegmentWords: number } {
  const safeWords = Number.isFinite(targetWords) && targetWords > 0 ? targetWords : 1800;
  const segments = Math.max(1, Math.min(maxSegments, Math.ceil(safeWords / maxSegmentWords)));
  const perSegmentWords = Math.max(200, Math.ceil(safeWords / segments));
  return { segments, perSegmentWords };
}

/** Chapter considered overdue after N chapters have passed since planting. */
export const FORESHADOWING_OVERDUE_AFTER_CHAPTERS = 8;

/** Regex rule engine — each rule can abort / trigger an auto-rewrite. */
export type ChapterRule = {
  id: string;
  label: string;
  category: NovelAuditCategory;
  severity: 'high' | 'medium' | 'low';
  pattern: RegExp;
  /** Human-readable explanation of what a match means. */
  hint: string;
};

export const DEFAULT_CHAPTER_RULES: ChapterRule[] = [
  {
    id: 'missing-characters',
    label: '主角名缺失',
    category: 'character',
    severity: 'high',
    pattern: /\b\S{2,4}\b(?!.*主角)/g,
    hint: '正则引擎占位规则，交由 LLM fact-check 复核人物是否全员在场。',
  },
  {
    id: 'word-count-absurd',
    label: '字数异常',
    category: 'rhythm',
    severity: 'low',
    pattern: /\n{4,}/g,
    hint: '存在大段连续空行，正文分段可能失控。',
  },
  {
    id: 'meta-leak',
    label: '元信息泄漏',
    category: 'consistency',
    severity: 'high',
    pattern: /(作为\s*AI|我是\s*(?:AI|语言模型|模型)|提示词|Token|用户提示|训练数据)/gi,
    hint: '正文疑似跳出叙事、出现模型元信息。',
  },
  {
    id: 'meta-leak-english',
    label: '英文元信息泄漏',
    category: 'consistency',
    severity: 'high',
    pattern: /(as an? ai|language model|prompt|token\b|finetune|fine-tune)/gi,
    hint: '正文疑似出现英文模型元信息。',
  },
  {
    id: 'second-person-slip',
    label: '人称漂移',
    category: 'character',
    severity: 'medium',
    pattern: /(?<![\n。！？“”])\b你\b/g,
    hint: '出现第二人称「你」，可能从第三人称叙事漂移。',
  },
  {
    id: 'repetitive-open',
    label: '重复开场',
    category: 'structure',
    severity: 'medium',
    pattern: /(.{8,})\1{1,}/g,
    hint: '检测到疑似重复段落（简单指纹匹配）。',
  },
  {
    id: 'out-of-scene',
    label: '世界观词越界',
    category: 'consistency',
    severity: 'low',
    pattern: /(21世纪|智能手机|互联网|外卖平台|蓝牙)/g,
    hint: '正文出现现代科技词，可能与架空世界观冲突。',
  },
];

/** Anti-AI rules injected into continuation prompts to reduce template / explanation feel. */
export const ANTI_AI_RULES = `【反 AI 味规则】
- 禁止「突然」「仿佛」「似乎」堆叠的廉价强调；用具体动作与环境细节代替心理直白。
- 禁止每段都用「他/她」开头，变化主语与句式节奏。
- 对话要有潜台词，避免一问一答的说明书式对白；说话间带动作与停顿。
- 禁止解释动机的总结句（如「他终于明白……」），让读者自己读出。
- 不要滥用排比与「像……一样」比喻；比喻一次一处足够。
- 避免模板式结尾（「而这一切，才刚刚开始」类）。`;

/** Prompt used to fill an empty chapter goal when the outline has none. */
export const DEFAULT_CHAPTER_GOAL_PROMPT = `请为第 {chapterIndex} 章「{chapterTitle}」写 1 句本章叙事目标（一句话说明本章要推进什么、埋下什么钩子），不要解释。`;

/** Tasks routed to the utility (cheap) model. */
export const CONTINUATION_UTILITY_TASKS = {
  extractContext: 'extract-context',
  ruleAudit: 'rule-audit',
  factCheck: 'fact-check',
  foreshadowing: 'foreshadowing',
  outline: 'outline',
  styleExtract: 'style-extract',
  dialogueExtract: 'dialogue-extract',
} as const;

/** Tasks routed to the main (novel default) model. */
export const CONTINUATION_MAIN_TASKS = {
  chapterWrite: 'chapter-write',
  rewrite: 'rewrite',
} as const;
