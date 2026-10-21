import * as DocumentPicker from 'expo-document-picker';

import { readTextFileAsync } from '@/utils/file-text';

export type ImportedNovelChapter = {
  title: string;
  content: string;
};

export type ImportedNovelText = {
  fileName: string;
  /** Display title derived from the file name (extension stripped). */
  title: string;
  chapters: ImportedNovelChapter[];
  /** Total characters across all chapters (excludes separators). */
  totalChars: number;
};

const CHAPTER_HEADING_PATTERNS: RegExp[] = [
  // Markdown headings: `# 第一章` / `## 初见`
  /^#{1,3}\s+(.+)$/,
  // Chinese chapter headings: 第一章 / 第十二节 / 第三回 / 卷一
  /^第\s*(?:[0-9零〇一二两三四五六七八九十百千万亿]+|[一二两三四五六七八九十百千万亿零〇]+)\s*[章节回卷篇部](?:\s*[^。！？!?,，\n]{0,40})?$/,
  /^卷\s*(?:[0-9零〇一二两三四五六七八九十百千万亿]+|[一二两三四五六七八九十百千万亿零〇]+)(?:\s*[^。！？!?,，\n]{0,40})?$/,
  // English chapter headings: Chapter 1 / CHAPTER 1 / Volume I
  /^(?:Chapter|CHAPTER|CH\.|Vol\.?|Volume)\s*[0-9ivxlcdmIVXLCDM]+(?:\s+[^.?!,\n]{0,40})?$/i,
];

function detectHeadingTitle(trimmedLine: string): string | null {
  for (const pattern of CHAPTER_HEADING_PATTERNS) {
    if (pattern.test(trimmedLine)) {
      return trimmedLine.replace(/^#{1,3}\s*/, '').trim();
    }
  }
  return null;
}

/** Split plain-text / markdown novel body into chapters. */
export function splitNovelTextIntoChapters(rawText: string): ImportedNovelChapter[] {
  const text = rawText.replace(/\r\n?/g, '\n').trim();

  if (!text) {
    return [];
  }

  const lines = text.split('\n');
  const headings: { lineIndex: number; title: string }[] = [];

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const title = detectHeadingTitle(trimmed);
    if (title) {
      headings.push({ lineIndex, title });
    }
  });

  if (headings.length < 2) {
    const clean = text.replace(/^#+\s*/, '').trim();
    return clean ? [{ title: '正文', content: clean }] : [];
  }

  const chapters: ImportedNovelChapter[] = [];

  headings.forEach((heading, index) => {
    const start = heading.lineIndex + 1;
    const end = index + 1 < headings.length ? headings[index + 1].lineIndex : lines.length;
    const content = lines.slice(start, end).join('\n').trim();

    if (content) {
      chapters.push({ title: heading.title, content });
    }
  });

  return chapters;
}

function stripExtension(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

/** Pick a TXT / Markdown file and return its chapters. */
export async function pickNovelTextFile(): Promise<ImportedNovelText | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/plain', 'text/markdown', 'text/x-markdown', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const raw = await readTextFileAsync(asset.uri);
  const chapters = splitNovelTextIntoChapters(raw);
  const fileName = asset.name ?? '未命名.txt';

  return {
    fileName,
    title: stripExtension(fileName),
    chapters,
    totalChars: chapters.reduce((sum, chapter) => sum + chapter.content.length, 0),
  };
}
