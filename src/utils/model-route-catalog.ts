import { modelIdsEqual, normalizeModelId } from '../constants/provider-capabilities';
import type { LlmProvider } from '../types/tavern';

export type ModelRoute = { providerId: string; providerName: string; modelId: string };
export type ModelRouteEntry = { key: string; label: string; routes: ModelRoute[] };
export type ModelBrandGroup = { id: string; label: string; models: ModelRouteEntry[] };

const BRANDS: { id: string; label: string; pattern: RegExp }[] = [
  { id: 'openai', label: 'OpenAI', pattern: /^(?:openai\/)?(?:gpt-|o\d|chatgpt-)/i },
  { id: 'gemini', label: 'Google Gemini', pattern: /^(?:google\/)?gemini[-.]/i },
  { id: 'anthropic', label: 'Anthropic', pattern: /^(?:anthropic\/)?claude[-.]/i },
  { id: 'deepseek', label: 'DeepSeek', pattern: /^(?:deepseek\/)?deepseek[-.]/i },
  { id: 'qwen', label: 'Qwen', pattern: /^(?:qwen\/)?(?:qwen|qwq)[-.\d]/i },
  { id: 'glm', label: 'GLM', pattern: /^(?:z-ai\/)?glm[-.]/i },
  { id: 'kimi', label: 'Kimi', pattern: /^(?:moonshot\/)?kimi[-.]/i },
  { id: 'minimax', label: 'MiniMax', pattern: /^(?:minimax\/)?minimax[-.]/i },
  { id: 'xai', label: 'xAI', pattern: /^(?:x-ai\/)?grok[-.]/i },
  { id: 'mimo', label: 'Xiaomi MiMo', pattern: /^(?:xiaomi\/)?mimo[-.]/i },
];

function brandFor(modelId: string) {
  const normalized = normalizeModelId(modelId);
  const basename = normalized.split('/').at(-1) ?? normalized;
  return BRANDS.find((brand) => brand.pattern.test(normalized) || brand.pattern.test(basename))
    ?? { id: 'other', label: '其他模型' };
}

export function displayModelName(modelId: string) {
  return normalizeModelId(modelId).replace(/[-_]+/g, ' ');
}

/** Group by model identity for display. Each route keeps its original API connection. */
export function buildModelRouteCatalog(providers: Record<string, LlmProvider>): ModelBrandGroup[] {
  const groups = new Map<string, ModelBrandGroup>();
  for (const provider of Object.values(providers)) {
    const discoveredModels = provider.fetchedModelsSource === 'remote' ? provider.fetchedModels : [];
    const unique = discoveredModels.filter(Boolean)
      .filter((modelId, index, all) => all.findIndex((candidate) => modelIdsEqual(candidate, modelId)) === index);
    for (const modelId of unique) {
      const brand = brandFor(modelId);
      const group = groups.get(brand.id) ?? { id: brand.id, label: brand.label, models: [] };
      if (!groups.has(brand.id)) groups.set(brand.id, group);
      const key = normalizeModelId(modelId).toLowerCase();
      let entry = group.models.find((model) => model.key === key);
      if (!entry) {
        entry = { key, label: displayModelName(modelId), routes: [] };
        group.models.push(entry);
      }
      entry.routes.push({ providerId: provider.id, providerName: provider.name, modelId });
    }
  }
  return [...groups.values()]
    .sort((a, b) => {
      const aIndex = BRANDS.findIndex((brand) => brand.id === a.id);
      const bIndex = BRANDS.findIndex((brand) => brand.id === b.id);
      return (aIndex < 0 ? BRANDS.length : aIndex) - (bIndex < 0 ? BRANDS.length : bIndex);
    })
    .map((group) => ({
      ...group,
      models: group.models.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}
