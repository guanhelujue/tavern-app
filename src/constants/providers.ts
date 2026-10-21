import type { LlmProvider } from '../types/tavern';

/** 厂商目录条目（品牌标识 + 协议 + 鉴权 + 默认连接地址）。 */
export type ProviderCatalogEntry = {
  id: string;
  name: string;
  protocol: NonNullable<LlmProvider['protocol']>;
  auth: NonNullable<LlmProvider['auth']>;
  defaultBaseUrl: string;
  logoMark: string;
  accent: string;
};

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://api.deepseek.com', logoMark: 'DS', accent: '#4D6BFE' },
  { id: 'mimo', name: 'Xiaomi MiMo', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', logoMark: 'Mi', accent: '#FF6900' },
  { id: 'gemini', name: 'Google Gemini', protocol: 'google-generate-content', auth: 'x-goog-api-key', defaultBaseUrl: 'https://generativelanguage.googleapis.com', logoMark: 'G', accent: '#4285F4' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai-responses', auth: 'bearer', defaultBaseUrl: 'https://api.openai.com/v1', logoMark: 'OAI', accent: '#10A37F' },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages', auth: 'x-api-key', defaultBaseUrl: 'https://api.anthropic.com', logoMark: 'A', accent: '#D97757' },
  { id: 'qwen', name: 'Qwen / Model Studio', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', logoMark: 'Q', accent: '#615CED' },
  { id: 'minimax', name: 'MiniMax', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://api.minimax.io/v1', logoMark: 'MM', accent: '#111827' },
  { id: 'glm', name: 'GLM / 智谱', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', logoMark: 'GLM', accent: '#2563EB' },
  { id: 'kimi', name: 'Kimi / Moonshot', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://api.moonshot.cn/v1', logoMark: 'K', accent: '#111111' },
  { id: 'xai', name: 'xAI / Grok', protocol: 'openai-responses', auth: 'bearer', defaultBaseUrl: 'https://api.x.ai/v1', logoMark: 'xAI', accent: '#111111' },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://openrouter.ai/api/v1', logoMark: 'OR', accent: '#7C3AED' },
  { id: 'groq', name: 'Groq', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'https://api.groq.com/openai/v1', logoMark: 'GQ', accent: '#F55036' },
  { id: 'custom-openai-compatible', name: '自定义 OpenAI-compatible', protocol: 'openai-compatible', auth: 'bearer', defaultBaseUrl: 'http://127.0.0.1:11434/v1', logoMark: 'L', accent: '#6B7280' },
];

export function catalogEntry(providerId: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

/** 给已有厂商补上目录里的品牌/协议信息，保留种子里的 name/baseUrl/selectedModel。 */
function enrich(provider: LlmProvider): LlmProvider {
  const entry = catalogEntry(provider.id);
  if (!entry) return provider;
  return {
    ...provider,
    protocol: entry.protocol,
    auth: entry.auth,
    logoMark: entry.logoMark,
    accent: entry.accent,
    defaultBaseUrl: entry.defaultBaseUrl,
  };
}

/** Fresh installs start with one predictable provider; extra vendors are opt-in via the catalog. */
export const DEFAULT_PROVIDERS: Record<string, LlmProvider> = {
  deepseek: enrich({
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    selectedModel: '',
    fetchedModels: [],
    isActive: true,
    contextWindowTokens: 32_000,
  }),
};

export function createEmptyProvider(overrides?: Partial<LlmProvider>): LlmProvider {
  const id = overrides?.id ?? `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seed = catalogEntry(id);

  return {
    id,
    name: overrides?.name ?? seed?.name ?? '自定义厂商',
    apiKey: overrides?.apiKey ?? '',
    baseUrl: overrides?.baseUrl ?? seed?.defaultBaseUrl ?? 'https://api.openai.com/v1',
    selectedModel: overrides?.selectedModel ?? '',
    fetchedModels: overrides?.fetchedModels ?? [],
    fetchedModelsSource: overrides?.fetchedModelsSource,
    modelSettings: overrides?.modelSettings ?? {},
    isActive: overrides?.isActive ?? false,
    contextWindowTokens:
      typeof overrides?.contextWindowTokens === 'number'
        ? overrides.contextWindowTokens
        : 32_000,
    protocol: overrides?.protocol ?? seed?.protocol,
    auth: overrides?.auth ?? seed?.auth,
    logoMark: overrides?.logoMark ?? seed?.logoMark,
    accent: overrides?.accent ?? seed?.accent,
    defaultBaseUrl: overrides?.defaultBaseUrl ?? seed?.defaultBaseUrl,
  };
}
