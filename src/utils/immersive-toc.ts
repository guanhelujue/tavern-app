import type { Message } from '@/types/tavern';
import { stripAssistantContentForExport } from '@/utils/status-bar-html';

export type ImmersiveTocEntry = {
  messageId: string;
  label: string;
  hasChapterTitle: boolean;
};

/**
 * Best-effort chapter title from the start of an assistant reply.
 * Supports `# 标题` / `## 标题` / `**标题**` / `《标题》`.
 */
export function extractChapterTitle(content: string): string | null {
  const body = stripAssistantContentForExport(content).trim();
  if (!body) {
    return null;
  }

  const heading = body.match(/^#{1,3}\s+(.+?)\s*$/m);
  if (heading?.[1]) {
    const title = cleanTitle(heading[1]);
    if (title) {
      return title;
    }
  }

  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  const bold = firstLine.match(/^\*\*(.+?)\*\*\s*$/);
  if (bold?.[1]) {
    const title = cleanTitle(bold[1]);
    if (title) {
      return title;
    }
  }

  const book = firstLine.match(/^《([^》]{1,40})》\s*$/);
  if (book?.[1]) {
    return book[1].trim();
  }

  return null;
}

function cleanTitle(raw: string) {
  const title = raw.replace(/\*+/g, '').replace(/^#+\s*/, '').trim();
  if (!title || title.length > 40) {
    return null;
  }
  // Avoid treating long narrative first lines as titles.
  if (/[。！？.!?；;]/.test(title)) {
    return null;
  }
  return title;
}

function previewLabel(content: string) {
  const body = stripAssistantContentForExport(content)
    .replace(/^#{1,3}\s+.+?\n+/, '')
    .replace(/^\*\*.+?\*\*\s*\n+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) {
    return '（空）';
  }
  return body.length > 18 ? `${body.slice(0, 18)}…` : body;
}

/** Build TOC from assistant replies: chapter titles when present, else 回复 N. */
export function buildImmersiveToc(messages: Message[]): ImmersiveTocEntry[] {
  const assistants = messages.filter(
    (message) =>
      message.role === 'assistant' &&
      message.status !== 'streaming' &&
      message.content.trim().length > 0,
  );

  return assistants.map((message, index) => {
    const chapter = extractChapterTitle(message.content);
    if (chapter) {
      return {
        messageId: message.id,
        label: chapter,
        hasChapterTitle: true,
      };
    }

    return {
      messageId: message.id,
      label: `回复 ${index + 1} · ${previewLabel(message.content)}`,
      hasChapterTitle: false,
    };
  });
}
