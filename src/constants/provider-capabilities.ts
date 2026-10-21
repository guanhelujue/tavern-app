/** 模型能力注册表。 */

export type ModelReasoning = 'always' | 'toggleable' | 'unknown';
export type ModelStreaming = 'supported' | 'unsupported' | 'unknown';

export type ModelCapability = {
  reasoning: ModelReasoning;
  streaming: ModelStreaming;
};

// Streaming is a transport feature supported by the OpenAI-compatible and
// native protocols used here. Keep it enabled by default; explicit unsupported
// entries still turn it off, while users can disable it globally when a proxy
// does not implement streaming.
const DEFAULT_CAPABILITIES: ModelCapability = { reasoning: 'unknown', streaming: 'supported' };

/** Normalize IDs returned by native APIs (Gemini returns `models/...`). */
export function normalizeModelId(modelId: string) {
  return modelId.trim().replace(/^models\//i, '');
}

export function modelIdsEqual(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  return normalizeModelId(left).toLowerCase() === normalizeModelId(right).toLowerCase();
}

const MODEL_CAPABILITIES: Record<string, Record<string, ModelCapability>> = {
  deepseek: {
    'deepseek-v4-pro': { reasoning: 'toggleable', streaming: 'supported' },
    'deepseek-v4-flash': { reasoning: 'toggleable', streaming: 'supported' },
    'deepseek-flash': { reasoning: 'toggleable', streaming: 'supported' },
  },
  mimo: {
    'mimo-v2.5-pro': { reasoning: 'toggleable', streaming: 'supported' },
    'mimo-v2.5': { reasoning: 'toggleable', streaming: 'supported' },
    'mimo-v2.5-pro-ultraspeed': { reasoning: 'unknown', streaming: 'supported' },
    'mimo-2.5-pro': { reasoning: 'toggleable', streaming: 'supported' },
    'mimo-2.5-flash': { reasoning: 'toggleable', streaming: 'supported' },
  },
  gemini: {
    'models/gemini-flash-latest': { reasoning: 'always', streaming: 'supported' },
    'models/gemini-flash-lite-latest': { reasoning: 'always', streaming: 'supported' },
    'models/gemini-pro-latest': { reasoning: 'always', streaming: 'supported' },
    'gemini-3.6-flash': { reasoning: 'always', streaming: 'supported' },
    'gemini-3.5-flash': { reasoning: 'always', streaming: 'supported' },
    'gemini-3.5-flash-lite': { reasoning: 'always', streaming: 'supported' },
    'gemini-3.1-pro-preview': { reasoning: 'always', streaming: 'supported' },
    'gemini-3-flash-preview': { reasoning: 'always', streaming: 'supported' },
  },
  openai: {
    'gpt-5.5': { reasoning: 'toggleable', streaming: 'supported' },
    'gpt-5.4': { reasoning: 'toggleable', streaming: 'supported' },
    'gpt-5.4-mini': { reasoning: 'toggleable', streaming: 'supported' },
    'gpt-5.4-nano': { reasoning: 'toggleable', streaming: 'supported' },
  },
  anthropic: {
    'claude-opus-4-7': { reasoning: 'toggleable', streaming: 'supported' },
    'claude-sonnet-4-6': { reasoning: 'toggleable', streaming: 'supported' },
    'claude-haiku-4-5': { reasoning: 'toggleable', streaming: 'supported' },
  },
  qwen: {
    'qwen3.7-max': { reasoning: 'always', streaming: 'supported' },
    'qwen3.7-plus': { reasoning: 'toggleable', streaming: 'supported' },
    'qwen-flash': { reasoning: 'toggleable', streaming: 'supported' },
  },
  minimax: {
    'MiniMax-M2.7': { reasoning: 'always', streaming: 'supported' },
    'MiniMax-M2.7-highspeed': { reasoning: 'always', streaming: 'supported' },
    'MiniMax-M2.5': { reasoning: 'always', streaming: 'supported' },
    'MiniMax-M2.5-highspeed': { reasoning: 'always', streaming: 'supported' },
    'MiniMax-M2-her': { reasoning: 'unknown', streaming: 'supported' },
  },
  glm: {
    'glm-5.2': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-5.1': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-5-turbo': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-5': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-4.7': { reasoning: 'always', streaming: 'supported' },
    'glm-4.7-flash': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-4.7-flashx': { reasoning: 'toggleable', streaming: 'supported' },
    'glm-4.6': { reasoning: 'toggleable', streaming: 'supported' },
  },
  kimi: {
    'kimi-k3': { reasoning: 'always', streaming: 'supported' },
    'kimi-k2.6': { reasoning: 'toggleable', streaming: 'supported' },
    'kimi-k2.5': { reasoning: 'toggleable', streaming: 'supported' },
    'kimi-k2-thinking': { reasoning: 'always', streaming: 'unsupported' },
  },
  xai: {
    'grok-4.6': { reasoning: 'toggleable', streaming: 'supported' },
    'grok-4.3': { reasoning: 'toggleable', streaming: 'supported' },
  },
  openrouter: {
    '~openai/gpt-latest': { reasoning: 'unknown', streaming: 'supported' },
    'openai/gpt-4o': { reasoning: 'unknown', streaming: 'supported' },
  },
  groq: {
    'openai/gpt-oss-120b': { reasoning: 'toggleable', streaming: 'supported' },
    'openai/gpt-oss-20b': { reasoning: 'toggleable', streaming: 'supported' },
    'qwen/qwen3.6-27b': { reasoning: 'toggleable', streaming: 'supported' },
  },
};

type ModelCapabilityRule = {
  pattern: RegExp;
  capability: ModelCapability;
};

/**
 * Provider-independent aliases for model IDs returned by reverse proxies.
 * These are intentionally conservative: exact provider entries win, then an
 * exact model ID from any catalog, and only then these family prefixes.
 */
const MODEL_FAMILY_CAPABILITY_RULES: ModelCapabilityRule[] = [
  { pattern: /^kimi-k2-thinking(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'unsupported' } },
  { pattern: /^glm-4\.7-flash(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^qwen3\.7-max(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^(?:deepseek-v4|mimo-v(?:2\.5|2))(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^deepseek-flash(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^claude-(?:opus|sonnet|haiku)-4(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^gpt-5(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  // Google documents the Gemini 2.5 and 3 series as thinking models. Keep
  // preview/stable/date-suffixed IDs covered so a proxy need not be added to
  // the provider registry for every new release.
  { pattern: /^gemini-2\.5-(?:pro|flash)(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^gemini-(?:3(?:[-.]|$)|(?:flash|pro)-latest(?:[-.:]|$))/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^qwen(?:3(?:\.7)?|[-.]flash)(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^minimax-m2(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^glm-5(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^glm-4\.7(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^glm-4\.6(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^kimi-k3(?:[-.:]|$)/i, capability: { reasoning: 'always', streaming: 'supported' } },
  { pattern: /^kimi-k2\.(?:5|6)(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^grok-4(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
  { pattern: /^openai\/gpt-oss-(?:20b|120b)(?:[-.:]|$)/i, capability: { reasoning: 'toggleable', streaming: 'supported' } },
];

function modelIdCandidates(modelId: string) {
  const normalized = normalizeModelId(modelId).toLowerCase();
  const basename = normalized.split('/').at(-1) ?? normalized;
  return basename === normalized ? [normalized] : [normalized, basename];
}

function findCapability(
  models: Record<string, ModelCapability> | undefined,
  candidates: string[],
) {
  if (!models) return undefined;
  for (const candidate of candidates) {
    const match = Object.entries(models).find(
      ([id]) => normalizeModelId(id).toLowerCase() === candidate,
    );
    if (match) return match[1];
  }
  return undefined;
}

const GLOBAL_MODEL_CAPABILITIES = new Map<string, ModelCapability>();
for (const models of Object.values(MODEL_CAPABILITIES)) {
  for (const [modelId, capability] of Object.entries(models)) {
    // Keep the first catalog entry for a shared ID; provider-specific entries
    // are still checked before this map in modelCapabilities().
    for (const candidate of modelIdCandidates(modelId)) {
      if (!GLOBAL_MODEL_CAPABILITIES.has(candidate)) {
        GLOBAL_MODEL_CAPABILITIES.set(candidate, capability);
      }
    }
  }
}

function findFamilyCapability(candidates: string[]) {
  return MODEL_FAMILY_CAPABILITY_RULES.find((rule) =>
    candidates.some((candidate) => rule.pattern.test(candidate)),
  )?.capability;
}

export function modelCapabilities(
  providerId: string | undefined,
  modelId: string,
): ModelCapability {
  const candidates = modelIdCandidates(modelId);
  const providerModels = providerId
    ? MODEL_CAPABILITIES[providerId] ?? MODEL_CAPABILITIES[providerId.toLowerCase()]
    : undefined;
  const entry =
    findCapability(providerModels, candidates) ??
    candidates.map((candidate) => GLOBAL_MODEL_CAPABILITIES.get(candidate)).find(Boolean) ??
    findFamilyCapability(candidates);
  return { ...DEFAULT_CAPABILITIES, ...(entry ?? {}) };
}
