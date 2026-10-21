import type { Message } from '@/types/tavern';

/**
 * Returns the user turn immediately before the current navigation anchor.
 * With no anchor, the latest user turn is the first destination.
 */
export function findPreviousUserMessageId(
  messages: Message[],
  currentMessageId?: string | null,
): string | null {
  const userIndices = messages.reduce<number[]>((indices, message, index) => {
    if (message.role === 'user') indices.push(index);
    return indices;
  }, []);
  if (!userIndices.length) return null;
  if (!currentMessageId) return messages[userIndices.at(-1)!]?.id ?? null;

  const currentIndex = messages.findIndex((message) => message.id === currentMessageId);
  if (currentIndex < 0) return messages[userIndices.at(-1)!]?.id ?? null;

  // If an assistant bubble is used as the anchor, regard its turn's user
  // message as the current one and step to the user turn before it.
  const currentUserIndex = messages[currentIndex]?.role === 'user'
    ? currentIndex
    : [...userIndices].reverse().find((index) => index <= currentIndex);
  if (currentUserIndex === undefined) return null;
  const previousUserIndex = [...userIndices].reverse().find((index) => index < currentUserIndex);
  return previousUserIndex === undefined ? null : messages[previousUserIndex]?.id ?? null;
}
