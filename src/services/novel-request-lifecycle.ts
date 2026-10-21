import {
  flushPendingNovelPersistence,
  resumeNovelPersistence,
  suspendNovelPersistence,
} from '@/services/novel-persistence-gate';

export type NovelRequestStatus = 'idle' | 'streaming' | 'cancelling' | 'error';
export type NovelCommitStatus = 'idle' | 'pending' | 'committed' | 'commit_failed';

export type NovelRequestFailure = {
  aborted: boolean;
  messageStatus: 'cancelled' | 'error';
  message: string;
  requestStatus: 'idle' | 'error';
  partialContent?: string;
};

export type NovelRequestLease = {
  requestId: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  flushPersistence: () => Promise<void>;
  setCommitStatus: (status: NovelCommitStatus, error?: string) => void;
  getCommitStatus: () => NovelCommitStatus;
  release: () => void;
};

type ActiveNovelRequest = {
  requestId: string;
  controller: AbortController;
  commitStatus: NovelCommitStatus;
  commitError?: string;
};

const activeRequests = new Map<string, ActiveNovelRequest>();
const activeMutations = new Map<string, symbol>();

/** Reserve a conversation before any awaited save/load/edit operation. */
export function beginNovelMutation(novelId: string): (() => void) | null {
  if (activeRequests.has(novelId) || activeMutations.has(novelId)) return null;
  const token = Symbol(novelId);
  activeMutations.set(novelId, token);
  return () => { if (activeMutations.get(novelId) === token) activeMutations.delete(novelId); };
}

export function isNovelMutationActive(novelId: string) {
  return activeMutations.has(novelId);
}

export function beginNovelRequest(novelId: string): NovelRequestLease | null {
  if (activeRequests.has(novelId) || activeMutations.has(novelId)) {
    return null;
  }

  const requestId = `novel-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const entry: ActiveNovelRequest = { requestId, controller, commitStatus: 'pending' };
  activeRequests.set(novelId, entry);
  suspendNovelPersistence();

  const isCurrent = () => activeRequests.get(novelId)?.requestId === requestId;
  const release = () => {
    if (isCurrent()) {
      activeRequests.delete(novelId);
      resumeNovelPersistence();
    }
  };

  return {
    requestId,
    signal: controller.signal,
    isCurrent,
    flushPersistence: flushPendingNovelPersistence,
    setCommitStatus: (status, error) => {
      if (!isCurrent()) return;
      entry.commitStatus = status;
      entry.commitError = error;
    },
    getCommitStatus: () => entry.commitStatus,
    release,
  };
}

export function cancelNovelRequest(novelId: string): string | null {
  const entry = activeRequests.get(novelId);
  if (!entry) {
    return null;
  }
  entry.controller.abort();
  return entry.requestId;
}

export function getActiveNovelRequestId(novelId: string): string | null {
  return activeRequests.get(novelId)?.requestId ?? null;
}

export function isNovelRequestAbortError(error: unknown): boolean {
  const isDomAbort =
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError';
  return (
    isDomAbort ||
    (error instanceof Error && /aborted|abort|取消/i.test(error.message))
  );
}

/** Create an error that survives provider-specific AbortError wrapping. */
export function createNovelRequestAbortError(message = '已停止生成。'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function deriveNovelRequestFailure(error: unknown): NovelRequestFailure {
  const partialError = error && typeof error === 'object'
    ? error as { partialContent?: unknown; aborted?: unknown }
    : null;
  const aborted = isNovelRequestAbortError(error) || partialError?.aborted === true;
  return {
    aborted,
    messageStatus: aborted ? 'cancelled' : 'error',
    message: aborted ? '已取消生成。' : error instanceof Error ? error.message : '请求模型失败。',
    requestStatus: aborted ? 'idle' : 'error',
    partialContent: typeof partialError?.partialContent === 'string'
      ? partialError.partialContent
      : undefined,
  };
}

export function formatNovelRequestFailureContent(
  content: string,
  failure: NovelRequestFailure,
  failureLabel = '请求失败',
): string {
  const partial = (failure.partialContent || content).trim();
  if (failure.aborted) {
    return partial && partial !== '正在生成回复...'
      ? `${partial}\n\n（已取消生成，以上内容可能不完整）`
      : '已取消生成。';
  }

  const keepPartial =
    partial &&
    partial !== '正在生成回复...' &&
    !partial.startsWith(`${failureLabel}：`);
  return keepPartial
    ? `${partial}\n\n（${failureLabel}：${failure.message}）`
    : `${failureLabel}：${failure.message}`;
}
