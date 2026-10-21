export type NovelPostTurnToken = {
  novelId: string;
  epoch: number;
  assistantMessageId: string;
  assistantContentFingerprint: string;
  activeSlotId: string | null;
  worldId: string;
};

export type NovelPostTurnCurrentState = {
  novelExists: boolean;
  assistantMessage?: { content: string; status?: string };
  activeSlotId: string | null;
  worldId: string;
};

const epochs = new Map<string, number>();

export function fingerprintNovelTurnContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}

export function captureNovelPostTurnToken(input: {
  novelId: string;
  assistantMessageId: string;
  assistantContent: string;
  activeSlotId: string | null;
  worldId: string;
}): NovelPostTurnToken {
  return {
    novelId: input.novelId,
    epoch: epochs.get(input.novelId) ?? 0,
    assistantMessageId: input.assistantMessageId,
    assistantContentFingerprint: fingerprintNovelTurnContent(input.assistantContent),
    activeSlotId: input.activeSlotId,
    worldId: input.worldId,
  };
}

/** Invalidates queued maintenance after branch-changing or destructive actions. */
export function invalidateNovelPostTurn(novelId: string): number {
  const next = (epochs.get(novelId) ?? 0) + 1;
  epochs.set(novelId, next);
  return next;
}

export function isNovelPostTurnTokenCurrent(
  token: NovelPostTurnToken,
  current: NovelPostTurnCurrentState,
): boolean {
  return (
    current.novelExists &&
    (epochs.get(token.novelId) ?? 0) === token.epoch &&
    current.activeSlotId === token.activeSlotId &&
    current.worldId === token.worldId &&
    current.assistantMessage?.status === 'complete' &&
    fingerprintNovelTurnContent(current.assistantMessage.content) === token.assistantContentFingerprint
  );
}
