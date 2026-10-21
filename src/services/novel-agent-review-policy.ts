import type { NovelAgentMode } from '@/types/tavern';

export type NovelAgentReviewMode = 'fast' | 'deep';

/** Legacy novels (without a setting) use the latency-friendly fast path. */
export function resolveNovelAgentReviewMode(mode?: NovelAgentReviewMode): NovelAgentReviewMode {
  return mode === 'deep' ? 'deep' : 'fast';
}

/** The synchronous Editor pass is only part of Direct collaboration in deep mode. */
export function shouldRunNovelEditor(
  agentMode?: NovelAgentMode,
  reviewMode?: NovelAgentReviewMode,
): boolean {
  return agentMode === 'direct' && resolveNovelAgentReviewMode(reviewMode) === 'deep';
}
