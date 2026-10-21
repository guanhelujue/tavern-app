import type { ApiSettings } from '@/types/tavern';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;
export const CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;

/**
 * Reserve output space and a small safety margin before packing prompt input.
 * This is deliberately approximate; provider adapters may enforce a tighter
 * limit, but the prompt should never be budgeted against the full window.
 */
export function resolveContextTokenBudget(
  apiSettings: Pick<ApiSettings, 'contextWindowTokens' | 'maxTokens'>,
) {
  const contextWindow =
    typeof apiSettings.contextWindowTokens === 'number' &&
    Number.isFinite(apiSettings.contextWindowTokens)
      ? Math.max(4_096, Math.round(apiSettings.contextWindowTokens))
      : DEFAULT_CONTEXT_WINDOW_TOKENS;
  const outputBudget = Math.max(256, Math.round(apiSettings.maxTokens));
  const boundedOutputBudget = Math.min(
    outputBudget,
    Math.max(256, contextWindow - CONTEXT_SAFETY_MARGIN_TOKENS - 2_048),
  );
  return Math.max(
    2_048,
    contextWindow - boundedOutputBudget - CONTEXT_SAFETY_MARGIN_TOKENS,
  );
}
