import { Platform } from 'react-native';

import { getAppDatabase } from '@/db/database';
import { appendStoryEvent } from '@/db/repositories/story-events';
import { projectStoryEvent } from '@/services/novel-story-projection';
import type { Message } from '@/types/tavern';

function preview(value: string, max = 1200) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n[content-truncated]`;
}

async function appendAndProject(input: {
  id: string;
  novelId: string;
  chapterId?: string | null;
  eventType: string;
  payloadJson: string;
  sourceMessageId?: string | null;
  createdAt: string;
}) {
  if (Platform.OS === 'web') return;
  const db = await getAppDatabase();
  const normalized = {
    ...input,
    chapterId: input.chapterId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
  };
  const sequence = await appendStoryEvent(db, normalized);
  await projectStoryEvent(db, { ...normalized, sequence });
}

export async function recordNovelMessageEvent(novelId: string, message: Message) {
  await appendAndProject({
    id: `${message.id}:event:${message.updatedAt}`,
    novelId,
    eventType: `message:${message.role}`,
    payloadJson: JSON.stringify({
      messageId: message.id,
      role: message.role,
      contentPreview: preview(message.content),
      facts: [],
    }),
    sourceMessageId: message.id,
    createdAt: message.updatedAt,
  });
}
