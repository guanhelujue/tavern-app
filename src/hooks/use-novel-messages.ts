import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { loadRecentNovelMessages } from '@/db/novel-read-repository';
import { NOVEL_MESSAGE_PAGE_SIZE } from '@/constants/novel-chat';
import type { Message } from '@/types/tavern';
import {
  getNovelStreamSnapshot,
  subscribeNovelStream,
} from '@/services/novel-stream-buffer';
import { mergeMessages } from '@/utils/novel-message-merge';

const EMPTY_DELETED_MESSAGE_IDS = new Set<string>();

export type NovelMessagesState = {
  messages: Message[];
  isLoading: boolean;
  isLoadingEarlier: boolean;
  isLoadingLater: boolean;
  hasEarlier: boolean;
  hasLater: boolean;
  error: Error | null;
  loadEarlier: () => Promise<void>;
  loadLater: () => Promise<void>;
  setTransientMessages: (messages: Message[]) => void;
  removeMessage: (messageId: string) => void;
};

function toMessage(row: Awaited<ReturnType<typeof loadRecentNovelMessages>>['items'][number]): Message {
  return {
    id: row.id,
    characterId: '',
    role: row.role as Message['role'],
    content: row.content,
    reasoningContent: row.reasoningContent ?? undefined,
    status: row.status as Message['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    promptTokens: row.promptTokens ?? undefined,
    completionTokens: row.completionTokens ?? undefined,
    modelId: row.modelId ?? undefined,
  };
}

export function useNovelMessages(
  novelId: string | undefined,
  options?: { fallbackMessages?: Message[]; pageSize?: number; worldId?: string; revision?: number },
): NovelMessagesState {
  const pageSize = Math.max(10, Math.min(100, Math.round(options?.pageSize ?? NOVEL_MESSAGE_PAGE_SIZE)));
  const fallbackMessages = options?.fallbackMessages;
  const worldId = options?.worldId;
  const revision = options?.revision ?? 0;
  const streamSnapshot = useSyncExternalStore(
    useCallback(
      (listener) => (novelId ? subscribeNovelStream(novelId, listener) : () => undefined),
      [novelId],
    ),
    useCallback(() => (novelId ? getNovelStreamSnapshot(novelId) : null), [novelId]),
    () => null,
  );
  const [dbMessages, setDbMessages] = useState<Message[]>([]);
  const [transientMessages, setTransientMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [newerCursor, setNewerCursor] = useState<number | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [hasLater, setHasLater] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [isLoadingLater, setIsLoadingLater] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const scopeKey = `${novelId ?? ''}\u0000${worldId ?? ''}\u0000${revision}`;
  const [deletedMessageState, setDeletedMessageState] = useState<{
    scopeKey: string;
    ids: Set<string>;
  }>(() => ({ scopeKey, ids: new Set() }));
  const deletedMessageIds = deletedMessageState.scopeKey === scopeKey
    ? deletedMessageState.ids
    : EMPTY_DELETED_MESSAGE_IDS;
  const requestId = useRef(0);
  const currentScope = useRef(scopeKey);
  useLayoutEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const [loadedScope, setLoadedScope] = useState(scopeKey);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!novelId) return;
    const hydrate = async () => {
      setLoadedScope(scopeKey);
      setDbMessages([]);
      setIsLoadingEarlier(false);
      setIsLoadingLater(false);
      setTransientMessages([]);
      setOlderCursor(null);
      setNewerCursor(null);
      setHasEarlier(false);
      setHasLater(false);
      setIsLoading(true);
      setError(null);
      try {
        const page = await loadRecentNovelMessages(novelId, { limit: pageSize, worldId });
        if (currentRequest !== requestId.current || currentScope.current !== scopeKey) return;
        const next = page.items.map(toMessage);
        setDbMessages((current) => mergeMessages(next, current, [], deletedMessageIds));
        setOlderCursor(page.nextCursor);
        setHasEarlier(page.hasMore);
        setNewerCursor(page.items.at(-1)?.sequenceNo ?? null);
        setHasLater(false);
      } catch (cause) {
        if (currentRequest !== requestId.current || currentScope.current !== scopeKey) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (currentRequest === requestId.current) setIsLoading(false);
      }
    };
    void hydrate();
    return () => { requestId.current += 1; };
  }, [deletedMessageIds, novelId, pageSize, worldId, revision, scopeKey]);

  const loadEarlier = useCallback(async () => {
    if (!novelId || isLoadingEarlier || !hasEarlier || olderCursor === null) return;
    setIsLoadingEarlier(true);
    try {
      const page = await loadRecentNovelMessages(novelId, {
        limit: pageSize,
        beforeSequenceNo: olderCursor,
        worldId,
      });
      if (currentScope.current !== scopeKey) return;
      setDbMessages((current) => mergeMessages(page.items.map(toMessage), current, [], deletedMessageIds));
      setOlderCursor(page.nextCursor);
      setHasEarlier(page.hasMore);
    } catch (cause) {
      if (currentScope.current !== scopeKey) return;
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (currentScope.current === scopeKey) setIsLoadingEarlier(false);
    }
  }, [deletedMessageIds, hasEarlier, isLoadingEarlier, novelId, olderCursor, pageSize, worldId, scopeKey]);

  const loadLater = useCallback(async () => {
    if (!novelId || isLoadingLater || !hasLater || newerCursor === null) return;
    setIsLoadingLater(true);
    try {
      const page = await loadRecentNovelMessages(novelId, {
        limit: pageSize,
        afterSequenceNo: newerCursor,
        worldId,
      });
      if (currentScope.current !== scopeKey) return;
      setDbMessages((current) => mergeMessages(current, page.items.map(toMessage), [], deletedMessageIds));
      setNewerCursor(page.items.at(-1)?.sequenceNo ?? newerCursor);
      setHasLater(page.hasMore);
    } catch (cause) {
      if (currentScope.current !== scopeKey) return;
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (currentScope.current === scopeKey) setIsLoadingLater(false);
    }
  }, [deletedMessageIds, hasLater, isLoadingLater, newerCursor, novelId, pageSize, worldId, scopeKey]);

  const removeMessage = useCallback((messageId: string) => {
    setDeletedMessageState((current) => {
      const ids = current.scopeKey === scopeKey ? current.ids : EMPTY_DELETED_MESSAGE_IDS;
      if (ids.has(messageId)) {
        return current;
      }
      const next = new Set(ids);
      next.add(messageId);
      return { scopeKey, ids: next };
    });
    setDbMessages((current) => current.filter((message) => message.id !== messageId));
    setTransientMessages((current) => current.filter((message) => message.id !== messageId));
  }, [scopeKey]);

  const fallbackSnapshot = useMemo(() => fallbackMessages ?? [], [fallbackMessages]);

  const messages = useMemo(
    () => {
      const scopedDbMessages = loadedScope === scopeKey ? dbMessages : [];
      const scopedTransientMessages = loadedScope === scopeKey ? transientMessages : [];
      const base = [...scopedDbMessages, ...fallbackSnapshot, ...scopedTransientMessages];
      if (!streamSnapshot) {
        return mergeMessages(scopedDbMessages, fallbackSnapshot, scopedTransientMessages, deletedMessageIds);
      }
      // Prefer the transient Zustand copy because it also receives live reasoning deltas.
      const existing = [...base].reverse().find((message) => message.id === streamSnapshot.messageId);
      const streamMessage: Message = {
        ...(existing ?? {
          id: streamSnapshot.messageId,
          characterId: novelId ?? '',
          role: 'assistant',
          status: 'streaming',
          createdAt: streamSnapshot.updatedAt,
          updatedAt: streamSnapshot.updatedAt,
          promptTokens: undefined,
          completionTokens: undefined,
          modelId: undefined,
        }),
        content: streamSnapshot.content,
        status: 'streaming',
        updatedAt: streamSnapshot.updatedAt,
      };
      return mergeMessages(scopedDbMessages, fallbackSnapshot, [...scopedTransientMessages, streamMessage], deletedMessageIds);
    },
    [dbMessages, deletedMessageIds, fallbackSnapshot, novelId, streamSnapshot, transientMessages, loadedScope, scopeKey],
  );

  return {
    messages,
    isLoading,
    isLoadingEarlier,
    isLoadingLater,
    hasEarlier,
    hasLater,
    error,
    loadEarlier,
    loadLater,
    setTransientMessages,
    removeMessage,
  };
}
