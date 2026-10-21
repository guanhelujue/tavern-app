export type NovelStreamSnapshot = {
  novelId: string;
  messageId: string;
  content: string;
  updatedAt: string;
};

const snapshots = new Map<string, NovelStreamSnapshot>();
const listeners = new Map<string, Set<() => void>>();

function notify(novelId: string) {
  for (const listener of listeners.get(novelId) ?? []) listener();
}

export function beginNovelStream(novelId: string, messageId: string, content = '') {
  snapshots.set(novelId, {
    novelId,
    messageId,
    content,
    updatedAt: new Date().toISOString(),
  });
  notify(novelId);
}

export function appendNovelStreamDelta(novelId: string, messageId: string, delta: string) {
  const current = snapshots.get(novelId);
  if (!current || current.messageId !== messageId) return;
  snapshots.set(novelId, {
    ...current,
    content: current.content + delta,
    updatedAt: new Date().toISOString(),
  });
  notify(novelId);
}


export function clearNovelStream(novelId: string, messageId?: string) {
  if (messageId && snapshots.get(novelId)?.messageId !== messageId) return;
  snapshots.delete(novelId);
  notify(novelId);
}

export function getNovelStreamSnapshot(novelId: string) {
  return snapshots.get(novelId) ?? null;
}

export function subscribeNovelStream(novelId: string, listener: () => void) {
  const set = listeners.get(novelId) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(novelId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(novelId);
  };
}
