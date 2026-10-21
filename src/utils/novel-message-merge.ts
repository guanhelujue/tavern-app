import type { Message } from '@/types/tavern';

/**
 * Merge database, legacy Zustand and transient streaming messages by id.
 * Deleted ids are kept as tombstones for the lifetime of the mounted screen
 * so a stale initial database page cannot resurrect a removed bubble.
 */
export function mergeMessages(
  dbMessages: Message[],
  fallback: Message[],
  transient: Message[],
  deletedMessageIds?: ReadonlySet<string>,
) {
  const map = new Map<string, Message>();
  for (const message of dbMessages) map.set(message.id, message);
  for (const message of fallback) map.set(message.id, message);
  for (const message of transient) map.set(message.id, message);

  return [...map.values()]
    .filter((message) => !deletedMessageIds?.has(message.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
