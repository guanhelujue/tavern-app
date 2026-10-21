export type NormalizedNovelUserInput = {
  content: string;
  currentChapter?: string;
};

const CHAPTER_HEADER_RE =
  /^第\s*([一二三四五六七八九十百千\d]+)\s*章(?:\s*[：:]\s*(.+))?$/;
const CHAPTER_REFERENCE_RE = /第\s*([一二三四五六七八九十百千〇零\d]+)\s*章/u;

/** Normalizes the public chat input before a novel turn is created. */
export function normalizeNovelUserInput(value: string): NormalizedNovelUserInput | null {
  const content = value.trim();
  if (!content) return null;

  const match = content.match(CHAPTER_HEADER_RE);
  if (!match) {
    const reference = content.match(CHAPTER_REFERENCE_RE);
    return reference
      ? { content, currentChapter: `第${reference[1]}章` }
      : { content };
  }

  const chapter = `第${match[1]}章`;
  const title = match[2]?.trim();
  return {
    content,
    currentChapter: title ? `${chapter}：${title}` : chapter,
  };
}
