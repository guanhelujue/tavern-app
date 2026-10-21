import type { OpenAIChatMessage } from '@/types/tavern';

/** A bounded, in-memory record of one model request and its result. */
export type DebugRequestSnapshot = {
  /** ISO timestamp */
  at: string;
  /** Model identifier */
  model: string;
  /** API base URL */
  baseUrl: string;
  /** Resolved provider id (remote providers, or synthetic for lan/on-device). */
  providerId?: string;
  /** Resolved provider display name. */
  providerName?: string;
  /** Whether streaming was enabled */
  streaming: boolean;
  /** Request purpose tag (novel-chat | utility-memory | …) */
  purpose?: string;
  /** Full outgoing messages */
  messages: OpenAIChatMessage[];
  /** Full response content from the model */
  responseContent?: string;
  /** Provider-returned thinking/reasoning trace, kept separate from prose. */
  reasoningContent?: string;
  /** Response token usage */
  responseTokens?: { promptTokens?: number; completionTokens?: number };
  /** API finish reason */
  finishReason?: string;
  /** Error message if failed */
  error?: string;
};

export type DebugRequestSnapshotInput = Omit<DebugRequestSnapshot, 'at'> & { at?: string };

export const MAX_DEBUG_HISTORY = 200;

/** Known purpose names for optional exact-purpose diagnostics. The main UI
 * intentionally groups these into three operational lanes instead of showing
 * one chip per name; newly added routes still appear from observed history.
 */
export const DEBUG_PURPOSE_CATALOG = [
  'novel-chat',
  'direct-plan',
  'outline',
  'utility-memory',
  'chapter-write',
  'rewrite',
  'fact-check',
  'rule-audit',
  'extract-context',
  'style-extract',
  'foreshadowing',
  'dialogue-extract',
  'character-agent',
  'character-relations',
  'character-chat',
  'editor-agent',
  'character-enrich',
  'utility',
  'utility-create',
  'utility-experience',
  'utility-routes',
  'create-workshop',
  'create-framework',
  'create-cast',
  'create-lore',
  'create-supporting',
  'create-supporting-candidates',
  'create-quick-travel-system',
  'create-quick-travel-world',
  'story-state-analyze',
  'story-state-analyze-retry',
] as const;

let debugRequestHistory: readonly DebugRequestSnapshot[] = [];
const listeners = new Set<() => void>();

/** Returns the current immutable snapshot list for useSyncExternalStore. */
export function getDebugRequestHistory(): readonly DebugRequestSnapshot[] {
  return debugRequestHistory;
}


/** Canonical purpose value used by the debug UI and its exact-name filters. */
export function normalizeDebugPurpose(purpose?: string): string {
  return purpose?.trim() || 'unknown';
}

export type DebugRequestCategory = 'writing' | 'collaboration' | 'support';

const WRITING_PURPOSES = new Set(['novel-chat', 'chapter-write', 'rewrite']);
const COLLABORATION_PURPOSES = new Set([
  'direct-plan',
  'character-agent',
  'character-relations',
  'character-chat',
  'editor-agent',
]);

/** Broad operational lane used by the debug page's three primary filters. */
export function getDebugRequestCategory(purpose?: string): DebugRequestCategory {
  const normalized = normalizeDebugPurpose(purpose);
  if (WRITING_PURPOSES.has(normalized)) return 'writing';
  if (COLLABORATION_PURPOSES.has(normalized)) return 'collaboration';
  return 'support';
}



/** Filters a history by one of the three broad operational lanes. */
export function filterDebugRequestHistoryByCategory(
  history: readonly DebugRequestSnapshot[],
  category: DebugRequestCategory | null,
): readonly DebugRequestSnapshot[] {
  if (category === null) return history;
  return history.filter((snapshot) => getDebugRequestCategory(snapshot.purpose) === category);
}

/** Subscribe to request history changes. The callback is invoked after each mutation. */
export function subscribeDebugRequestHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDebugRequestHistory(): void {
  if (debugRequestHistory.length === 0) return;
  debugRequestHistory = [];
  notifyListeners();
}

export function recordDebugSnapshot(partial: DebugRequestSnapshotInput): void {
  const snapshot: DebugRequestSnapshot = {
    at: partial.at ?? new Date().toISOString(),
    model: partial.model,
    baseUrl: partial.baseUrl,
    providerId: partial.providerId,
    providerName: partial.providerName,
    streaming: partial.streaming,
    purpose: partial.purpose?.trim() || undefined,
    messages: partial.messages,
    responseContent: partial.responseContent,
    reasoningContent: partial.reasoningContent,
    responseTokens: partial.responseTokens,
    finishReason: partial.finishReason,
    error: partial.error,
  };

  debugRequestHistory = [...debugRequestHistory, snapshot].slice(-MAX_DEBUG_HISTORY);
  notifyListeners();
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}
