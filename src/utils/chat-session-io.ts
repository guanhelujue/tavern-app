import * as DocumentPicker from 'expo-document-picker';
import {
  EncodingType,
  StorageAccessFramework,
  cacheDirectory,
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { ChatSessionKind } from '@/constants/session-config';
import type {
  Message,
  Novel,
  NovelCharacterBiography,
  NovelConversation,
  NovelSlotBook,
  SessionCustomConfig,
} from '@/types/tavern';
import { stripNovelChapterExpansion } from '@/utils/novel-chapter-expansion';
import { stripAssistantContentForExport } from '@/utils/status-bar-html';
import { CHAT_IMPORT_LIMITS, parseChatSessionExportBundle } from '@/utils/chat-session-schema';

export type ChatSessionExportBundle = {
  /** v4 adds biographies; v5 is a lossless full backup. */
  version: 1 | 2 | 3 | 4 | 5;
  kind: ChatSessionKind;
  sessionId: string;
  exportedAt: string;
  title: string;
  config: SessionCustomConfig & {
    memory: string;
    longTermMemory?: string;
    midTermMemories?: string[];
    shortTermMemories?: string[];
  } & Partial<NovelConversation>;
  messages: Message[];
  /** Portable novel metadata. Present in v3 exports; absent in legacy session backups. */
  novel?: Novel;
  /** Character id -> reader-only biography collection. */
  characterBiographies?: Record<string, NovelCharacterBiography[]>;
  worldSessions?: Record<string, {
    messages: Message[];
    meta: NovelConversation;
    slotBook?: NovelSlotBook;
  }>;
};

export type ExportTranscriptFormat = 'txt' | 'md';

export type ExportTranscriptResult = {
  fileName: string;
  /** directory = Android SAF folder; share = system share sheet; download = browser */
  mode: 'directory' | 'share' | 'download';
  uri?: string;
};

export type ExportDirectorySettings = {
  /** Android SAF directory URI. Empty = use share / browser download. */
  directoryUri: string;
  /** Optional display label from the last folder pick. */
  directoryLabel: string;
};

export type ExportTranscriptOptions = {
  title: string;
  messages: Message[];
  directoryUri?: string;
  /** Force share sheet even when a directory is configured. */
  forceShare?: boolean;
  /** txt (default) or markdown. */
  format?: ExportTranscriptFormat;
  /** When true, append `-{timestamp}` to the file name (default true). */
  includeTimestamp?: boolean;
};

function sanitizeFileName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 48);

  return cleaned || 'tavern';
}

function collectAssistantBodies(messages: Message[]) {
  return messages
    .filter(
      (message) =>
        message.role === 'assistant' &&
        message.status !== 'error' &&
        message.content.trim().length > 0,
    )
    .map((message) => stripAssistantContentForExport(message.content))
    .filter((body) => body.length > 0);
}

/** Drop status-bar HTML / plain fields and 行动预测·建议路线 from assistant turns. */
function sanitizeMessagesForExport(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      const cleaned = stripNovelChapterExpansion(message.content);
      return cleaned === message.content ? message : { ...message, content: cleaned };
    }
    if (message.role !== 'assistant' || !message.content.trim()) {
      return message;
    }
    const cleaned = stripAssistantContentForExport(message.content);
    if (cleaned === message.content.trim()) {
      return message;
    }
    return { ...message, content: cleaned };
  });
}

/** Build a single TXT of AI replies only (skip user turns / errors / empty / status bars / routes). */
export function buildAssistantTranscriptText(title: string, messages: Message[]) {
  const chapters = collectAssistantBodies(messages);

  if (chapters.length === 0) {
    throw new Error('暂无可导出的 AI 正文。');
  }

  const body = chapters.join('\n\n────────\n\n');
  const heading = title.trim() ? `《${title.trim()}》\n\n` : '';
  return `${heading}${body}\n`;
}

/** Markdown variant: H1 title + `---` between turns (status bars already stripped). */
export function buildAssistantTranscriptMarkdown(title: string, messages: Message[]) {
  const chapters = collectAssistantBodies(messages);

  if (chapters.length === 0) {
    throw new Error('暂无可导出的 AI 正文。');
  }

  const heading = title.trim() ? `# 《${title.trim()}》\n\n` : '';
  const body = chapters
    .map((chapter, index) => `## ${index + 1}\n\n${chapter}`)
    .join('\n\n---\n\n');
  return `${heading}${body}\n`;
}

function buildTranscriptContent(
  title: string,
  messages: Message[],
  format: ExportTranscriptFormat,
) {
  return format === 'md'
    ? buildAssistantTranscriptMarkdown(title, messages)
    : buildAssistantTranscriptText(title, messages);
}

function resolveTranscriptFileName(
  title: string,
  format: ExportTranscriptFormat,
  includeTimestamp: boolean,
) {
  const base = sanitizeFileName(title);
  const ext = format === 'md' ? 'md' : 'txt';
  return includeTimestamp ? `${base}-${Date.now()}.${ext}` : `${base}.${ext}`;
}

function mimeForFormat(format: ExportTranscriptFormat) {
  return format === 'md' ? 'text/markdown' : 'text/plain';
}

async function writeCacheFile(fileName: string, content: string) {
  const baseDir = cacheDirectory || documentDirectory;

  if (!baseDir) {
    throw new Error('当前环境无法写入导出文件。');
  }

  const fileUri = `${baseDir}${fileName}`;
  await writeAsStringAsync(fileUri, content, { encoding: EncodingType.UTF8 });
  return fileUri;
}

async function downloadOnWeb(fileName: string, content: string, mimeType: string) {
  if (typeof document === 'undefined') {
    throw new Error('Web 环境无法导出文件。');
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveToAndroidDirectory(
  directoryUri: string,
  fileName: string,
  content: string,
  mimeType: string,
) {
  const fileUri = await StorageAccessFramework.createFileAsync(
    directoryUri,
    fileName,
    mimeType,
  );
  await writeAsStringAsync(fileUri, content, { encoding: EncodingType.UTF8 });
  return fileUri;
}

async function shareFile(fileUri: string, mimeType: string) {
  const canShare = await Sharing.isAvailableAsync();

  if (!canShare) {
    throw new Error('当前设备不支持系统分享，文件已写入应用缓存。');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: '导出正文到阅读软件',
    UTI: mimeType === 'text/markdown' ? 'net.daringfireball.markdown' : 'public.plain-text',
  });
}

/**
 * Export AI-only transcript.
 * Strips status-bar HTML/plain fields and 行动预测 / 【建议路线】 blocks.
 */
export async function exportAssistantTranscript(
  options: ExportTranscriptOptions,
): Promise<ExportTranscriptResult> {
  const format = options.format === 'md' ? 'md' : 'txt';
  const includeTimestamp = options.includeTimestamp !== false;
  const fileName = resolveTranscriptFileName(options.title, format, includeTimestamp);
  const content = buildTranscriptContent(options.title, options.messages, format);
  const mimeType = mimeForFormat(format);
  const directoryUri = options.directoryUri?.trim() ?? '';

  if (Platform.OS === 'web') {
    await downloadOnWeb(fileName, content, mimeType);
    return { fileName, mode: 'download' };
  }

  if (!options.forceShare && Platform.OS === 'android' && directoryUri) {
    try {
      const uri = await saveToAndroidDirectory(directoryUri, fileName, content, mimeType);
      return { fileName, mode: 'directory', uri };
    } catch {
      // Permission may have been revoked; fall through to share.
    }
  }

  const fileUri = await writeCacheFile(fileName, content);
  await shareFile(fileUri, mimeType);
  return { fileName, mode: 'share', uri: fileUri };
}

/** Pick an Android folder for future TXT/MD exports (SAF). */
export async function pickExportDirectory(): Promise<ExportDirectorySettings> {
  if (Platform.OS !== 'android') {
    throw new Error('自定义保存位置仅支持 Android。iOS / Web 请用系统分享或浏览器下载。');
  }

  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();

  if (!permissions.granted || !permissions.directoryUri) {
    throw new Error('已取消选择目录。');
  }

  const directoryUri = permissions.directoryUri;
  const labelMatch = decodeURIComponent(directoryUri).match(/\/([^/]+)$/);

  return {
    directoryUri,
    directoryLabel: labelMatch?.[1] ?? '已选择的文件夹',
  };
}


export function buildChatSessionExportBundle(input: {
  kind: ChatSessionKind;
  sessionId: string;
  title: string;
  config: ChatSessionExportBundle['config'] & {
    suggestedRoutes?: string[];
    isSuggestingRoutes?: boolean;
  } & Partial<NovelConversation>;
  messages: Message[];
  /** Include the complete novel record when a full作品备份 is desired. */
  novel?: Novel;
  characterBiographies?: Record<string, NovelCharacterBiography[]>;
  worldSessions?: ChatSessionExportBundle['worldSessions'];
}): ChatSessionExportBundle {
  // Ephemeral UI + UI chrome artifacts — omit from backup JSON.
  const {
    suggestedRoutes: _suggestedRoutes,
    isSuggestingRoutes: _isSuggestingRoutes,
    ...config
  } = input.config;

  return {
    version: input.novel || input.worldSessions ? 5 : 2,
    kind: input.kind,
    sessionId: input.sessionId,
    exportedAt: new Date().toISOString(),
    title: input.title,
    config,
    // Full backups are lossless; plain session exports retain historical cleaning.
    messages: input.novel || input.worldSessions ? input.messages : sanitizeMessagesForExport(input.messages),
    ...(input.novel
      ? {
          // Device-local cover/background URIs cannot be resolved on another device.
          novel: {
            ...input.novel,
            coverImageUri: undefined,
            chatBackgroundUri: undefined,
          },
        }
      : {}),
    ...(input.novel && input.characterBiographies
      ? { characterBiographies: input.characterBiographies }
      : {}),
    ...(input.worldSessions ? { worldSessions: input.worldSessions } : {}),
  };
}

/** Export full session JSON (for backup / import). */
export async function exportChatSessionBundle(
  bundle: ChatSessionExportBundle,
  directoryUri?: string,
): Promise<ExportTranscriptResult> {
  const fileName = `${sanitizeFileName(bundle.title || bundle.sessionId)}-session-${Date.now()}.json`;
  const content = serializeChatSessionBundleForExport(bundle);
  const mimeType = 'application/json';
  const dir = directoryUri?.trim() ?? '';

  if (Platform.OS === 'web') {
    await downloadOnWeb(fileName, content, mimeType);
    return { fileName, mode: 'download' };
  }

  if (Platform.OS === 'android' && dir) {
    try {
      const uri = await saveToAndroidDirectory(dir, fileName, content, mimeType);
      return { fileName, mode: 'directory', uri };
    } catch {
      // fall through
    }
  }

  const fileUri = await writeCacheFile(fileName, content);
  await shareFile(fileUri, mimeType);
  return { fileName, mode: 'share', uri: fileUri };
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Validate and size-check a complete backup before handing it to a platform writer. */
export function serializeChatSessionBundleForExport(bundle: ChatSessionExportBundle) {
  const validated = parseChatSessionExportBundle(bundle);
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  JSON.parse(content) as unknown;
  if (utf8ByteLength(content) > CHAT_IMPORT_LIMITS.maxBytes) {
    throw new Error('导出文件超过大小限制，无法生成可导入备份。');
  }
  return content;
}

export async function importChatSessionBundle(): Promise<ChatSessionExportBundle> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('已取消导入。');
  }

  const asset = result.assets[0];
  const uri = asset.uri;
  // On web, expo-document-picker returns the selected File directly while
  // expo-file-system/legacy does not provide readAsStringAsync. Native
  // platforms continue to read the copied cache URI.
  const raw =
    Platform.OS === 'web'
      ? asset.file
        ? await asset.file.text()
        : await (await fetch(uri)).text()
      : await readAsStringAsync(uri, { encoding: EncodingType.UTF8 });
  const byteLength = utf8ByteLength(raw);
  if (byteLength > CHAT_IMPORT_LIMITS.maxBytes) {
    throw new Error('导入文件超过大小限制。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('导入文件不是有效的 JSON。');
  }
  return parseChatSessionExportBundle(parsed);
}
