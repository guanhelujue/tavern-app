import { modelCapabilities } from '../constants/provider-capabilities';
import type { ApiSettings } from '../types/tavern';

/** Use the model family for proxy routes; the connection ID can be arbitrary. */
export function buildThinkingBody(
  providerId: string | undefined,
  modelId: string,
  thinkingDisabled: boolean,
  thinkingConfigured = false,
  parameter: ApiSettings['thinkingParameter'] = 'auto',
) {
  if (!thinkingConfigured && modelCapabilities(providerId, modelId).reasoning !== 'toggleable') return {};
  if (!thinkingConfigured && !['deepseek', 'mimo', 'glm', 'qwen', 'kimi'].includes(providerId ?? '')) return {};
  const enabled = !thinkingDisabled;
  const name = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase();
  const inferred = providerId === 'deepseek' || providerId === 'mimo' || providerId === 'glm' ||
    /^(deepseek|mimo|glm)[-.]/.test(name)
    ? 'thinking'
    : providerId === 'qwen' || /^(qwen|qwq)[-.\d]/.test(name)
      ? 'enable_thinking'
      : providerId === 'kimi' || /^kimi[-.]/.test(name)
        ? name.includes('k3') ? 'reasoning_effort' : 'thinking'
        : /^(gpt-|o\d|claude-|gemini[-.])/.test(name)
          ? 'reasoning_effort'
          : 'none';
  if (parameter === 'auto' && thinkingDisabled && /^gemini-3(?:[-.]|$)/.test(name)) {
    // Gemini 3 cannot disable internal reasoning through the OpenAI compatibility layer.
    return {};
  }
  switch (parameter === 'auto' ? inferred : parameter) {
    case 'thinking':
      return { thinking: { type: enabled ? ('enabled' as const) : ('disabled' as const) } };
    case 'enable_thinking':
      return { enable_thinking: enabled };
    case 'reasoning_effort':
      return { reasoning_effort: enabled ? 'high' : 'none' };
    default:
      return {};
  }
}
