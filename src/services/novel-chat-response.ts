export type NovelChatOutputErrorCode =
  | 'novel_model_refusal'
  | 'novel_provider_block'
  | 'novel_length_limit'
  | 'novel_incomplete_chapter'
  | 'novel_short_chapter';

export class NovelChatOutputError extends Error {
  readonly code: NovelChatOutputErrorCode;
  readonly partialContent: string;

  constructor(code: NovelChatOutputErrorCode, message: string, content: string) {
    super(message);
    this.name = 'NovelChatOutputError';
    this.code = code;
    this.partialContent = content;
  }
}

/** Flag only large chapter deficits; small variation around the target is normal. */
const MIN_CHAPTER_LENGTH_RATIO = 0.6;
/** An open sentence is suspicious below target, but not on a full-length draft. */
const OPEN_SENTENCE_LENGTH_RATIO = 0.9;

function looksLikeModelRefusal(content: string) {
  const opening = content.trim().slice(0, 160);
  return /^(?:抱歉|很抱歉|对不起|我无法满足|我无法为你|我无法按|我不能为你|我不能按|根据安全规范)/u.test(opening) &&
    /请求|生成|创作|描写|提供|安全|限制/u.test(opening);
}

function isLengthFinishReason(reason: string) {
  return /^(?:length|max_tokens|max_output_tokens|max_completion_tokens|token_limit|incomplete_max_output_tokens)$/u.test(reason);
}

/** Validate completed novel-chat replies before they can become canonical chapter text. */
export function validateNovelChatResponse({
  content,
  finishReason,
  targetWords,
}: {
  content: string;
  finishReason?: string;
  targetWords?: number;
}) {
  const clean = content.trim();
  const reason = (finishReason ?? '').trim().toLowerCase().replace(/[-\s]+/gu, '_');

  if (/content_filter|safety|prohibited_content|blocklist/u.test(reason)) {
    throw new NovelChatOutputError(
      'novel_provider_block',
      '上游以内容审查原因结束了生成；这段回复未作为完整正文保存。请调整本章要求或更换写作模型。',
      clean,
    );
  }
  if (looksLikeModelRefusal(clean)) {
    throw new NovelChatOutputError(
      'novel_model_refusal',
      '模型返回的是拒绝说明，而不是小说正文；本轮未作为完整章节保存。请调整本章要求或更换写作模型。',
      clean,
    );
  }

  // A word-count contract only exists for outline-driven chapter turns.
  if (!targetWords || !Number.isFinite(targetWords) || targetWords <= 0) return;

  if (isLengthFinishReason(reason)) {
    throw new NovelChatOutputError(
      'novel_length_limit',
      '模型触及输出长度上限，章节可能未写完；已保留正文片段，但未作为完整章节保存。请调高对话长度上限后重试。',
      clean,
    );
  }

  const writtenChars = clean.replace(/\s/gu, '').length;
  const hasSentenceEnding = /[。！？!?…」”』）)]$/u.test(clean);
  if (!hasSentenceEnding && writtenChars < targetWords * OPEN_SENTENCE_LENGTH_RATIO) {
    throw new NovelChatOutputError(
      'novel_incomplete_chapter',
      `章节疑似中途断流：目标约 ${targetWords} 字，实际约 ${writtenChars} 字，末句未写完（上游报告 ${finishReason || '未知结束原因'}）。已保留片段，未作为完整章节保存。`,
      clean,
    );
  }
  if (writtenChars < targetWords * MIN_CHAPTER_LENGTH_RATIO) {
    throw new NovelChatOutputError(
      'novel_short_chapter',
      `章节篇幅明显不足：目标约 ${targetWords} 字，实际约 ${writtenChars} 字。已保留片段，未作为完整章节保存；可重试或换模型。`,
      clean,
    );
  }
}
