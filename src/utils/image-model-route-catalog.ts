import { getImageModelOptions, IMAGE_MODEL_CATALOG, type ImageModelCatalogEntry } from '@/constants/image-models';
import type { ImageProviderConfig } from '@/types/tavern';
import type { ModelBrandGroup, ModelRoute, ModelRouteEntry } from './model-route-catalog';

export type { ModelBrandGroup, ModelRoute, ModelRouteEntry };

const GROUPS = [
  { id: 'open-source', label: '开源模型' },
  { id: 'gemini', label: 'Google' },
  { id: 'openai', label: 'OpenAI' },
] as const;

function keyOf(modelId: string) {
  return modelId.trim().replace(/^models\//i, '').toLowerCase();
}

function groupFor(modelId: string, preset?: ImageModelCatalogEntry) {
  if (preset?.protocol === 'comfyui') return 'open-source';
  if (/gemini|nano[ -]?banana|google/i.test(modelId)) return 'gemini';
  if (/gpt[ -]?image|gpt-|openai|codex/i.test(modelId)) return 'openai';
  if (/qwen|moss|z[ -]?image/i.test(modelId)) return 'open-source';
  return 'other';
}

export function imageModelDisplayName(modelId?: string) {
  const id = modelId?.trim() ?? '';
  if (!id) return '未配置模型';
  if (/gemini-3\.1-flash-image/i.test(id)) return 'Nano Banana / Gemini 3.1 Flash Image';
  const preset = IMAGE_MODEL_CATALOG.find((item) => keyOf(item.id) === keyOf(id));
  if (preset) return preset.label;
  return id.replace(/^models\//i, '').replace(/[-_]+/g, ' ');
}

function route(provider: ImageProviderConfig, modelId: string): ModelRoute {
  return { providerId: provider.id, providerName: provider.name, modelId };
}

function addModel(group: ModelBrandGroup, modelId: string, provider: ImageProviderConfig) {
  const key = keyOf(modelId);
  const existing = group.models.find((item) => item.key === key);
  const next = existing ?? { key, label: imageModelDisplayName(modelId), routes: [] };
  if (!existing) group.models.push(next);
  const duplicate = next.routes.some((item) => item.providerId === provider.id && keyOf(item.modelId) === key &&
    item.providerName === provider.name);
  if (!duplicate) next.routes.push(route(provider, modelId));
}

function emptyGroups(): ModelBrandGroup[] {
  return GROUPS.map((group) => ({ id: group.id, label: group.label, models: [] }));
}

function allGroupsWithOther(groups: ModelBrandGroup[], other: ModelBrandGroup) {
  return other.models.length ? [...groups, other] : groups;
}

/** Runtime catalog: only routes that have a usable URL and model are exposed. */
export function buildImageModelRouteCatalog(
  providers: Record<string, ImageProviderConfig>,
  preferredProviderId?: string,
): ModelBrandGroup[] {
  const groups = emptyGroups();
  const other = { id: 'other', label: '其他模型', models: [] } as ModelBrandGroup;
  for (const preset of IMAGE_MODEL_CATALOG) {
    const group = groups.find((item) => item.id === groupFor(preset.id, preset)) ?? other;
    group.models.push({ key: keyOf(preset.id), label: imageModelDisplayName(preset.id), routes: [] });
  }
  const seen = new Set<string>();
  const ordered = Object.values(providers).sort((a, b) =>
    (a.id === preferredProviderId ? -1 : b.id === preferredProviderId ? 1 : 0));
  for (const provider of ordered) {
    if (!provider.baseUrl.trim()) continue;
    const models = provider.protocol === 'comfyui'
      ? IMAGE_MODEL_CATALOG.filter((item) => item.protocol === 'comfyui').map((item) => item.id)
      : provider.modelId.trim() ? [provider.modelId.trim()] : [];
    for (const modelId of models) {
      const modelKey = keyOf(modelId);
      const fingerprint = JSON.stringify([provider.baseUrl.trim().replace(/\/+$/, ''), provider.protocol ?? 'auto', provider.auth ?? 'auto', modelKey, provider.apiKey]);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const groupId = groupFor(modelId, IMAGE_MODEL_CATALOG.find((item) => keyOf(item.id) === modelKey));
      const group = groups.find((item) => item.id === groupId) ?? other;
      addModel(group, modelId, provider);
    }
  }
  return allGroupsWithOther(groups, other).map((group) => ({
    ...group,
    models: group.models.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/** Configuration catalog: all known presets are shown, even before a route is configured. */
export function buildImageModelPresetCatalog(provider: ImageProviderConfig): ModelBrandGroup[] {
  const groups = emptyGroups();
  const other = { id: 'other', label: '其他模型', models: [] } as ModelBrandGroup;
  const options = getImageModelOptions(provider);
  const presets = provider.protocol && provider.protocol !== 'auto' && provider.protocol !== 'openai-compatible'
    ? options.filter((item) => item.protocol === provider.protocol)
    : options;
  for (const preset of presets) {
    const group = groups.find((item) => item.id === groupFor(preset.id, preset)) ?? other;
    const entry: ModelRouteEntry = { key: keyOf(preset.id), label: imageModelDisplayName(preset.id), routes: [route(provider, preset.id)] };
    group.models.push(entry);
  }
  if (provider.modelId.trim() && !presets.some((preset) => keyOf(preset.id) === keyOf(provider.modelId))) {
    const group = groups.find((item) => item.id === groupFor(provider.modelId)) ?? other;
    addModel(group, provider.modelId.trim(), provider);
  }
  return allGroupsWithOther(groups, other).filter((group) => group.models.length);
}

export function resolveImageModelRoute(
  providers: Record<string, ImageProviderConfig>,
  modelId: string,
  providerId: string,
) {
  const provider = providers[providerId];
  if (!provider) throw new Error('图像模型线路不存在，请重新选择图像模型。');
  if (!provider.baseUrl.trim()) throw new Error(`图像连接「${provider.name}」尚未配置 Base URL。`);
  const catalog = buildImageModelRouteCatalog(providers, providerId);
  const entry = catalog.flatMap((group) => group.models).find((item) => item.key === keyOf(modelId));
  const route = entry?.routes.find((item) => item.providerId === providerId && keyOf(item.modelId) === keyOf(modelId));
  if (!route) throw new Error(`图像模型「${modelId}」不属于当前连接，请重新选择。`);
  return { provider, modelId: route.modelId };
}
