import { describe, expect, it } from 'vitest';

import type { LlmProvider } from '../types/tavern';
import { buildModelRouteCatalog } from './model-route-catalog';

function provider(id: string, name: string, models: string[]): LlmProvider {
  return {
    id, name, selectedModel: models[0] ?? '', fetchedModels: models, fetchedModelsSource: 'remote',
    apiKey: '', baseUrl: 'https://example.test/v1', isActive: false,
  };
}

describe('model route catalog', () => {
  it('groups a mixed custom connection by model brand and keeps duplicate routes distinct', () => {
    const custom = provider('proxy-1', '自定义线路', ['gemini-3.7-flash-high', 'gpt-5.4', 'claude-sonnet-4-6']);
    const second = provider('proxy-2', '备用线路', ['models/gemini-3.7-flash-high', 'gemini-3.7-flash-low']);

    const groups = buildModelRouteCatalog({ [custom.id]: custom, [second.id]: second });
    expect(groups.find((group) => group.id === 'openai')?.models[0].routes[0].providerId).toBe('proxy-1');
    expect(groups.find((group) => group.id === 'anthropic')?.models[0].routes[0].providerId).toBe('proxy-1');
    const gemini = groups.find((group) => group.id === 'gemini');
    expect(gemini?.models).toHaveLength(2);
    expect(gemini?.models.find((model) => model.key === 'gemini-3.7-flash-high')?.routes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerId: 'proxy-1', modelId: 'gemini-3.7-flash-high' }),
        expect.objectContaining({ providerId: 'proxy-2', modelId: 'models/gemini-3.7-flash-high' }),
      ]));
  });

  it('hides selected models and legacy fetched lists without a remote source marker', () => {
    const groups = buildModelRouteCatalog({
      legacy: { ...provider('legacy', '旧连接', ['legacy-model']), fetchedModelsSource: undefined },
      selectedOnly: {
        ...provider('selected-only', '仅当前模型', []),
        selectedModel: 'selected-model',
      },
    });

    expect(groups).toEqual([]);
  });
});
