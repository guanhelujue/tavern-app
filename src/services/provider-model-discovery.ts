import { buildModelsEndpoint, filterTextModels } from '../utils/models';

const MODEL_CACHE_TTL_MS = 10 * 60_000;
const MODEL_REQUEST_TIMEOUT_MS = 15_000;

export type DiscoveredModels = {
  models: string[];
  source: 'remote';
  cached: boolean;
};

type CacheEntry = {
  models: string[];
  source: 'remote';
  cachedAt: number;
  apiKey: string;
  auth?: 'bearer' | 'x-api-key' | 'x-goog-api-key';
};
const cache = new Map<string, CacheEntry>();

function isGeminiBaseUrl(baseUrl: string) {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

function providerModelsEndpoint(providerId: string | undefined, baseUrl: string) {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (providerId === 'gemini' || isGeminiBaseUrl(root)) {
    return `${root}/v1beta/models`;
  }
  return buildModelsEndpoint(root);
}

function authHeaders(
  providerId: string | undefined,
  apiKey: string,
  auth?: 'bearer' | 'x-api-key' | 'x-goog-api-key',
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = apiKey.trim();
  if (!key) return headers;
  if (auth === 'x-goog-api-key' || providerId === 'gemini') headers['x-goog-api-key'] = key;
  else if (auth === 'x-api-key' || providerId === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.Authorization = `Bearer ${key}`;
  return headers;
}

function parseModelIds(payload: unknown): string[] {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const items = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return items
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return String(row.id ?? row.name ?? '').replace(/^models\//, '').trim();
    })
    .filter(Boolean);
}

export async function discoverProviderModels(input: {
  providerId?: string;
  baseUrl: string;
  apiKey?: string;
  auth?: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  refresh?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<DiscoveredModels> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const cacheKey = `${input.providerId ?? ''}\u0000${input.baseUrl}`;
  const apiKey = input.apiKey?.trim() ?? '';
  const entry = cache.get(cacheKey);
  const cached = entry?.apiKey === apiKey && entry.auth === input.auth ? entry : undefined;
  if (!apiKey) {
    return { models: [], source: 'remote', cached: false };
  }
  if (!input.refresh && cached && Date.now() - cached.cachedAt < MODEL_CACHE_TTL_MS) {
    return { models: cached.models, source: cached.source, cached: true };
  }
  const failedRemoteResult = (): DiscoveredModels => cached?.source === 'remote'
    ? { models: cached.models, source: 'remote', cached: true }
    : { models: [], source: 'remote', cached: false };
  const endpoint = providerModelsEndpoint(input.providerId, input.baseUrl);
  if (!endpoint) {
    return failedRemoteResult();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      headers: authHeaders(input.providerId, input.apiKey ?? '', input.auth),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return failedRemoteResult();
    }
    const models = filterTextModels(parseModelIds(JSON.parse(text)));
    if (models.length === 0) return failedRemoteResult();
    const result = { models, source: 'remote' as const };
    cache.set(cacheKey, { ...result, cachedAt: Date.now(), apiKey, auth: input.auth });
    return { ...result, cached: false };
  } catch {
    return failedRemoteResult();
  } finally {
    clearTimeout(timeout);
  }
}

export function clearProviderModelCache() {
  cache.clear();
}
