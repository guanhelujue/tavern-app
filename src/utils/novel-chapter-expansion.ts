const EXPANSION_START = '<novel-chapter-expansion>';
const EXPANSION_END = '</novel-chapter-expansion>';



export function stripNovelChapterExpansion(content: string) {
  const start = content.lastIndexOf(EXPANSION_START);
  if (start < 0) return content;
  const end = content.indexOf(EXPANSION_END, start + EXPANSION_START.length);
  if (end < 0) return content;

  return `${content.slice(0, start)}${content.slice(end + EXPANSION_END.length)}`.trim();
}
