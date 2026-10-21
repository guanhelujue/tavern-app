import { Platform } from 'react-native';

import { getAppDatabase } from '@/db/database';
import { appendMessage, deleteMessage, getMessageById, upsertMessage } from '@/db/repositories/messages';
import { ensureNovelExists } from '@/db/repositories/novels';
import { recordNovelMessageEvent } from '@/services/novel-story-events';
import type { Message } from '@/types/tavern';

/** Converts the UI message shape into the append-only SQLite row shape. */
function toRow(novelId: string, message: Message, worldId = 'legacy') {
  return {
    id: message.id,
    novelId,
    worldId,
    role: message.role,
    content: message.content,
    reasoningContent: message.reasoningContent ?? null,
    status: message.status,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    promptTokens: message.promptTokens ?? null,
    completionTokens: message.completionTokens ?? null,
    modelId: message.modelId ?? null,
  };
}

export async function appendNovelMessage(novelId: string, message: Message, worldId = 'legacy') {
  if (Platform.OS === 'web') return -1;
  const db = await getAppDatabase();
  await ensureNovelExists(db, novelId);
  const existing = await getMessageById(db, message.id);
  let sequence: number;
  if (existing) {
    if (existing.novelId !== novelId) {
      throw new Error('Message id belongs to a different novel');
    }
    await upsertMessage(db, { ...toRow(novelId, message, worldId), sequenceNo: existing.sequenceNo });
    sequence = existing.sequenceNo;
  } else {
    sequence = await appendMessage(db, toRow(novelId, message, worldId));
  }
  if (message.status !== 'streaming') {
    try {
      await recordNovelMessageEvent(novelId, message);
    } catch (error) {
      console.error('[novel] failed to record message story event', error);
    }
  }
  return sequence;
}

export async function commitNovelMessage(novelId: string, message: Message, worldId = 'legacy') {
  return appendNovelMessage(novelId, message, worldId);
}

/** Removes a chat bubble from the prompt source. Story events remain as an audit trail. */
export async function deleteNovelMessage(messageId: string) {
  if (Platform.OS === 'web') return;
  const db = await getAppDatabase();
  await deleteMessage(db, messageId);
}

export async function markNovelMessageStatus(
  novelId: string,
  message: Message,
  status: Message['status'],
  worldId = 'legacy',
) {
  // Ensure cancellation/failure persists the already generated partial content as well.
  await appendNovelMessage(novelId, {
    ...message,
    status,
    updatedAt: new Date().toISOString(),
  }, worldId);
}
