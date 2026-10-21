import * as DocumentPicker from 'expo-document-picker';
import { clampStringToPunctuation } from '@/utils/helpers';

import { readTextFileAsync } from '@/utils/file-text';

/** Max Chinese chars for the style block appended to system prompt. */
export const WRITING_STYLE_SUMMARY_MAX_CHARS = 160;

/** Default / min / max chars sent to the utility model as novel sample. */
export const WRITING_STYLE_SAMPLE_INPUT_MAX_CHARS = 12000;
export const WRITING_STYLE_SAMPLE_INPUT_MIN_CHARS = 2000;
export const WRITING_STYLE_SAMPLE_INPUT_HARD_MAX_CHARS = 100_000;

const STYLE_BLOCK_HEADER = '【文风】';
const SAMPLE_WINDOW_COUNT = 5;
const SAMPLE_WINDOW_SEPARATOR = '\n\n…\n\n';

export function clampWritingStyleSampleMaxChars(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return WRITING_STYLE_SAMPLE_INPUT_MAX_CHARS;
  }

  return Math.min(
    WRITING_STYLE_SAMPLE_INPUT_HARD_MAX_CHARS,
    Math.max(WRITING_STYLE_SAMPLE_INPUT_MIN_CHARS, Math.round(value)),
  );
}

/**
 * Build a sample from a long novel: five evenly spaced windows
 * (start / ~25% / ~50% / ~75% / end) within the char budget.
 */
export function sampleNovelTextForStyle(
  raw: string,
  maxChars = WRITING_STYLE_SAMPLE_INPUT_MAX_CHARS,
): string {
  const text = raw.replace(/\u0000/g, '').trim();
  if (!text) {
    return '';
  }

  const budget = clampWritingStyleSampleMaxChars(maxChars);
  if (text.length <= budget) {
    return text;
  }

  const sepCost = SAMPLE_WINDOW_SEPARATOR.length * (SAMPLE_WINDOW_COUNT - 1);
  const perWindow = Math.max(200, Math.floor((budget - sepCost) / SAMPLE_WINDOW_COUNT));
  const lastStart = Math.max(0, text.length - perWindow);
  const starts = [0, 0.25, 0.5, 0.75].map((ratio) =>
    Math.min(lastStart, Math.floor(ratio * lastStart)),
  );
  starts.push(lastStart);

  // Dedupe overlapping window starts on shorter texts.
  const uniqueStarts: number[] = [];
  for (const start of starts) {
    const prev = uniqueStarts[uniqueStarts.length - 1];
    if (prev === undefined || start >= prev + Math.floor(perWindow * 0.5)) {
      uniqueStarts.push(start);
    }
  }
  if (uniqueStarts[uniqueStarts.length - 1] !== lastStart) {
    uniqueStarts.push(lastStart);
  }

  return uniqueStarts.map((start) => text.slice(start, start + perWindow)).join(SAMPLE_WINDOW_SEPARATOR);
}

/** Remove an existing 【文风】 block so re-import replaces instead of stacking. */
export function stripWritingStyleBlock(systemPrompt: string): string {
  const text = systemPrompt.trim();
  if (!text) {
    return '';
  }

  const start = text.indexOf(STYLE_BLOCK_HEADER);
  if (start < 0) {
    return text;
  }

  const afterHeader = start + STYLE_BLOCK_HEADER.length;
  const rest = text.slice(afterHeader);
  const nextSection = rest.search(/\n【[^】]+】/);
  const before = text.slice(0, start).trimEnd();
  const after = nextSection >= 0 ? rest.slice(nextSection).trimStart() : '';
  return [before, after].filter(Boolean).join('\n\n').trim();
}

export function clampWritingStyleSummary(
  summary: string,
  maxChars = WRITING_STYLE_SUMMARY_MAX_CHARS,
): string {
  const trimmed = summary
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^【文风】\s*/u, '')
    .trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return clampStringToPunctuation(trimmed, maxChars);
}

export function appendWritingStyleToSystemPrompt(
  systemPrompt: string,
  styleSummary: string,
  maxChars = WRITING_STYLE_SUMMARY_MAX_CHARS,
): string {
  const style = clampWritingStyleSummary(styleSummary, maxChars);
  if (!style) {
    return systemPrompt.trim();
  }

  const base = stripWritingStyleBlock(systemPrompt);
  const block = `${STYLE_BLOCK_HEADER}\n${style}`;
  return base ? `${base}\n\n${block}` : block;
}

export async function pickNovelTxtSample(
  maxChars = WRITING_STYLE_SAMPLE_INPUT_MAX_CHARS,
): Promise<{
  fileName: string;
  text: string;
  sampledChars: number;
  rawChars: number;
}> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/plain', 'text/*', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('已取消选择。');
  }

  const asset = result.assets[0];
  const fileName = asset.name?.trim() || 'novel.txt';
  if (fileName && !/\.(txt|text|md)$/i.test(fileName) && asset.mimeType && !/text\//i.test(asset.mimeType)) {
    // Allow anyway if user picked via */*; still try UTF-8 read.
  }

  const raw = await readTextFileAsync(asset.uri);
  const sampled = sampleNovelTextForStyle(raw, maxChars);
  if (!sampled.trim()) {
    throw new Error('文件为空或无法读取文本（请使用 UTF-8 编码的 txt）。');
  }

  return {
    fileName,
    text: sampled,
    sampledChars: sampled.length,
    rawChars: raw.length,
  };
}
