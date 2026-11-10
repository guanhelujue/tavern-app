import type {
  ImageGenerationSettings,
  ImageProviderAuth,
  ImageProviderConfig,
  ImageProviderProtocol,
} from '@/types/tavern';
import { generateId } from '@/utils/helpers';

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

export const DEFAULT_IMAGE_MODEL = 'qwen-image-2.1';
/** Local ComfyUI HTTP API root. Mobile clients can replace this with the desktop LAN address. */
export const DEFAULT_IMAGE_BASE_URL = 'http://127.0.0.1:8188';

export const LOCAL_IMAGE_MODEL_IDS = [
  'qwen-image-2.1',
  'moss-image',
  'z-image',
] as const;

export type LocalImageModelId = (typeof LOCAL_IMAGE_MODEL_IDS)[number];

function isLocalImageModel(modelId?: string | null): modelId is LocalImageModelId {
  return LOCAL_IMAGE_MODEL_IDS.includes(modelId?.trim() as LocalImageModelId);
}

function isComfyProvider(config: Partial<ImageProviderConfig>) {
  if (config.protocol && config.protocol !== 'auto') return config.protocol === 'comfyui';
  return /:\s*8188(?:\/|$)/i.test(config.baseUrl ?? '') ||
    isLocalImageModel(config.modelId);
}

export type ImageProviderCatalogEntry = Omit<ImageProviderConfig, 'apiKey' | 'modelId'> & {
  defaultModel: string;
};

export const IMAGE_PROVIDER_CATALOG: ImageProviderCatalogEntry[] = [
  {
    id: 'comfyui',
    name: '本地 ComfyUI',
    baseUrl: DEFAULT_IMAGE_BASE_URL,
    defaultModel: DEFAULT_IMAGE_MODEL,
    protocol: 'comfyui',
    auth: 'none',
    logoMark: 'C',
    accent: '#8B5CF6',
  },
];

export const IMAGE_MODEL_CATALOG: ImageModelCatalogEntry[] = [
  {
    id: DEFAULT_IMAGE_MODEL,
    providerId: 'comfyui',
    label: 'Qwen Image 2.1',
    description: '本地 ComfyUI · 写实图生图与角色生成',
    protocol: 'comfyui',
    auth: 'none',
  },
  {
    id: 'moss-image',
    providerId: 'comfyui',
    label: 'MOSS',
    description: '本地 ComfyUI · 文生图与实验性图生图',
    protocol: 'comfyui',
    auth: 'none',
  },
  {
    id: 'z-image',
    providerId: 'comfyui',
    label: 'Z-Image',
    description: '本地 ComfyUI · 快速写实生成',
    protocol: 'comfyui',
    auth: 'none',
  },
  {
    id: 'gemini-3.1-flash-image',
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
  providerId: 'comfyui',
  providers: {
    comfyui: {
      id: 'comfyui',
      name: '本地 ComfyUI',
      baseUrl: DEFAULT_IMAGE_BASE_URL,
      apiKey: '',
      modelId: DEFAULT_IMAGE_MODEL,
      protocol: 'comfyui',
      auth: 'none',
      logoMark: 'C',
      accent: '#8B5CF6',
    },
  },
};

export function createImageProvider(
  overrides?: Partial<ImageProviderConfig>,
): ImageProviderConfig {
  const catalog = overrides?.id && (!overrides.protocol || overrides.protocol === 'comfyui')
    ? IMAGE_PROVIDER_CATALOG.find((entry) => entry.id === overrides.id)
    : undefined;
  const has = (key: keyof ImageProviderConfig) => Object.prototype.hasOwnProperty.call(overrides ?? {}, key);
  const id = overrides?.id?.trim() || generateId('image-provider');
  const localDefaults = overrides?.protocol === 'comfyui' || catalog?.protocol === 'comfyui';
  return {
    id,
    name: has('name') ? String(overrides?.name ?? '').trim() : catalog?.name ?? (localDefaults ? '本地 ComfyUI' : '自定义图像厂商'),
    apiKey: has('apiKey') ? String(overrides?.apiKey ?? '').trim() : '',
    baseUrl: has('baseUrl') ? String(overrides?.baseUrl ?? '').trim() : catalog?.baseUrl ?? (localDefaults ? DEFAULT_IMAGE_BASE_URL : ''),
    modelId: has('modelId') ? String(overrides?.modelId ?? '').trim() : catalog?.defaultModel ?? (localDefaults ? DEFAULT_IMAGE_MODEL : ''),
    protocol: overrides?.protocol ?? catalog?.protocol ?? (localDefaults ? 'comfyui' : 'auto'),
    auth: overrides?.auth ?? catalog?.auth ?? (localDefaults ? 'none' : 'auto'),
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
      const providerConfig = provider as Partial<ImageProviderConfig>;
      const isLocalComfy = isComfyProvider(providerConfig);
      const normalized = createImageProvider({
        ...providerConfig,
        id,
        protocol: isLocalComfy ? 'comfyui' : (providerConfig.protocol ?? 'auto'),
        auth: isLocalComfy ? (providerConfig.auth && providerConfig.auth !== 'auto' ? providerConfig.auth : 'none') : (providerConfig.auth ?? 'auto'),
        modelId: isLocalComfy && providerConfig.modelId === undefined ? DEFAULT_IMAGE_MODEL : providerConfig.modelId,
      });
      return [id, normalized];
    }),
  );

  // Migrate the first version, which kept one active provider's fields at the top level.
  if (!hasProviderMap && !Object.keys(providers).length && legacyProviderId) {
    const legacyConfig: Partial<ImageProviderConfig> = {
      id: legacyProviderId,
      modelId: typeof legacyRecord?.modelId === 'string' ? legacyRecord.modelId : undefined,
      baseUrl: typeof legacyRecord?.baseUrl === 'string' ? legacyRecord.baseUrl : undefined,
      apiKey: typeof legacyRecord?.apiKey === 'string' ? legacyRecord.apiKey : undefined,
    };
    const isLocalComfy = isComfyProvider(legacyConfig);
    providers[legacyProviderId] = createImageProvider({
      ...legacyConfig,
      protocol: isLocalComfy ? 'comfyui' : 'auto',
      auth: isLocalComfy ? 'none' : 'auto',
      modelId: isLocalComfy && legacyConfig.modelId === undefined ? DEFAULT_IMAGE_MODEL : legacyConfig.modelId,
    });
    if (!isLocalComfy && !legacyConfig.modelId) providers[legacyProviderId].modelId = '';
  }
  if (!Object.keys(providers).length && !hasProviderMap && !legacyProviderId) {
    providers.comfyui = createImageProvider({ id: 'comfyui', protocol: 'comfyui' });
  }
  const providerId = legacyProviderId && providers[legacyProviderId]
    ? legacyProviderId
    : Object.keys(providers)[0] ?? '';

  return {
    providerId,
    providers,
  };
}

export function getImageModelOptions(provider?: Pick<ImageProviderConfig, 'protocol'> | null) {
  if (provider?.protocol === 'comfyui') return IMAGE_MODEL_CATALOG.filter((model) => model.protocol === 'comfyui');
  return IMAGE_MODEL_CATALOG.filter((model) => model.protocol !== 'comfyui');
}


export function imageModelCatalogEntry(modelId?: string | null) {
  const id = modelId?.trim() ?? '';
  return IMAGE_MODEL_CATALOG.find((model) => model.id === id);
}
