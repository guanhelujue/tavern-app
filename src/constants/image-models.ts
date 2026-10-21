import type {
  ImageGenerationSettings,
  ImageProviderAuth,
  ImageProviderConfig,
  ImageProviderProtocol,
} from '@/types/tavern';

export type { ImageGenerationSettings, ImageProviderConfig } from '@/types/tavern';

/**
 * Image models are intentionally curated instead of discovered through the
 * text provider's /models endpoint. Many gateways do not expose image models
 * there, and the returned list is otherwise too noisy for a portrait picker.
 */
export type ImageModelCatalogEntry = {
  id: string;
  providerId: string;
  label: string;
  description: string;
  /** Wire protocol inferred when this model is selected. */
  protocol: ImageProviderProtocol;
  /** Authentication mode inferred when this model is selected. */
  auth: ImageProviderAuth;
};

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
/** Local EasyCLIProxyAPI root used by the current image-generation setup. */
export const DEFAULT_IMAGE_BASE_URL = 'http://127.0.0.1:8317';

export type ImageProviderCatalogEntry = Omit<ImageProviderConfig, 'apiKey' | 'modelId'> & {
  defaultModel: string;
};

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: DEFAULT_IMAGE_BASE_URL,
    defaultModel: DEFAULT_IMAGE_MODEL,
    protocol: 'google-generate-content',
    auth: 'x-goog-api-key',
    logoMark: 'G',
    accent: '#4285F4',
  },
];

export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  {
    id: DEFAULT_IMAGE_MODEL,
    providerId: 'gemini',
    label: 'Gemini 3.1 Flash Image',
    description: 'Gemini generateContent · 支持直接生成图片',
    protocol: 'google-generate-content',
    auth: 'x-goog-api-key',
  },
  {
    id: 'gpt-5.5',
    providerId: 'openai-codex',
    label: 'Codex 图像工具（gpt-5.5）',
    description: 'Responses + image_generation · CPA Codex 额度',
    protocol: 'openai-responses-image',
    auth: 'bearer',
  },
  {
    id: 'gpt-image-2',
    providerId: 'openai-images',
    label: 'GPT Image 2',
    description: 'OpenAI Images API · /v1/images/generations',
    protocol: 'openai-images',
    auth: 'bearer',
  },
  {
    id: 'gpt-image-1.5',
    providerId: 'openai-images',
    label: 'GPT Image 1.5',
    description: 'OpenAI Images API · /v1/images/generations',
    protocol: 'openai-images',
    auth: 'bearer',
  },
];

export const defaultImageGenerationSettings: ImageGenerationSettings = {
  providerId: 'gemini',
  providers: {
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: DEFAULT_IMAGE_BASE_URL,
      apiKey: '',
      modelId: DEFAULT_IMAGE_MODEL,
      protocol: 'google-generate-content',
      auth: 'x-goog-api-key',
      logoMark: 'G',
      accent: '#4285F4',
    },
  },
};

export function createImageProvider(
  overrides?: Partial<ImageProviderConfig>,
): ImageProviderConfig {
  const catalog = overrides?.id
    ? IMAGE_PROVIDER_CATALOG.find((entry) => entry.id === overrides.id)
    : undefined;
  const id = overrides?.id?.trim() || `image-provider-${Date.now()}`;
  return {
    id,
    name: overrides?.name?.trim() || catalog?.name || '自定义图像厂商',
    apiKey: overrides?.apiKey?.trim() || '',
    baseUrl: overrides?.baseUrl?.trim() || catalog?.baseUrl || DEFAULT_IMAGE_BASE_URL,
    modelId: overrides?.modelId?.trim() || catalog?.defaultModel || '',
    protocol: overrides?.protocol ?? catalog?.protocol ?? 'auto',
    auth: overrides?.auth ?? catalog?.auth ?? 'auto',
    logoMark: overrides?.logoMark ?? catalog?.logoMark,
    accent: overrides?.accent ?? catalog?.accent,
  };
}

export function normalizeImageGenerationSettings(
  settings?: {
    providerId?: string;
    providers?: Record<string, Partial<ImageProviderConfig>>;
    /** Legacy single-provider fields kept for migration. */
    modelId?: string;
    baseUrl?: string;
    apiKey?: string;
  } | null,
): ImageGenerationSettings {
  const legacyProviderId = typeof settings?.providerId === 'string' ? settings.providerId.trim() : '';
  const legacyRecord = settings as (Partial<ImageGenerationSettings> & {
    modelId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
  }) | null | undefined;
  const rawProviders = settings?.providers && typeof settings.providers === 'object'
    ? settings.providers
    : {};
  const hasProviderMap = settings?.providers !== undefined;
  const providers = Object.fromEntries(
    Object.entries(rawProviders).map(([id, value]) => {
      const provider = value && typeof value === 'object' ? value : {};
      return [id, createImageProvider({
        ...(provider as Partial<ImageProviderConfig>),
        id,
      })];
    }),
  );

  // Migrate the first version, which kept one active provider's fields at the top level.
  if (!Object.keys(providers).length && legacyProviderId) {
    providers[legacyProviderId] = createImageProvider({
      id: legacyProviderId,
      modelId: typeof legacyRecord?.modelId === 'string' ? legacyRecord.modelId : undefined,
      baseUrl: typeof legacyRecord?.baseUrl === 'string' ? legacyRecord.baseUrl : undefined,
      apiKey: typeof legacyRecord?.apiKey === 'string' ? legacyRecord.apiKey : undefined,
    });
  }
  if (!Object.keys(providers).length && !hasProviderMap) {
    const defaultProvider = createImageProvider({ id: 'gemini' });
    return { providerId: 'gemini', providers: { gemini: defaultProvider } };
  }
  const providerId = legacyProviderId || Object.keys(providers)[0] || '';

  return {
    providerId,
    providers,
  };
}


export function imageModelCatalogEntry(modelId?: string | null) {
  const id = modelId?.trim() ?? '';
  return IMAGE_MODEL_CATALOG.find((model) => model.id === id);
}
