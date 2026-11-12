import { describe, expect, it } from 'vitest';

import type { LlmProvider } from '../types/tavern';
import { defaultGenerationSettings, normalizeGenerationSettings, resolveAgentApiSettings, resolveApiSettings } from './tavern-store-api-settings';

function provider(id: string, selectedModel: string, isActive: boolean): LlmProvider {
  return {
    id, name: id, apiKey: `test-key-${id}`, baseUrl: `https://${id}.example.test`,
    selectedModel, fetchedModels: [selectedModel], isActive,
  };
}

describe('novel narrator model routing', () => {
  it('uses the global writing model even when an old novel has a different model saved', () => {
    const providers = {
      gemini: provider('gemini', 'gemini-3-flash', true),
      deepseek: provider('deepseek', 'deepseek-v4-flash', false),
    };

    const settings = resolveAgentApiSettings(providers, defaultGenerationSettings, 'narrator', {
      preferredModelId: 'deepseek-v4-flash',
      preferredProviderId: 'deepseek',
    });

    expect(settings.providerId).toBe('gemini');
    expect(settings.model).toBe('gemini-3-flash');
  });
});

describe('independent task model routing', () => {
  it('keeps same model ids on the explicitly bound provider', () => {
    const providers = { a: provider('a', 'same-model', true), b: provider('b', 'same-model', false) };
    const settings = normalizeGenerationSettings({ ...defaultGenerationSettings, utilityProviderId: 'a', utilityModelId: 'utility', collaborationProviderId: 'b', collaborationModelId: 'collaboration', taskModelBindings: { inspiration: { providerId: 'b', modelId: 'same-model' }, character: { providerId: 'a', modelId: 'same-model' } } });
    expect(resolveApiSettings(providers, settings, { purpose: 'utility', task: 'inspiration' })).toMatchObject({ providerId: 'b', model: 'same-model', apiKey: 'test-key-b', baseUrl: 'https://b.example.test' });
    expect(resolveAgentApiSettings(providers, settings, 'character')).toMatchObject({ providerId: 'a', model: 'same-model', apiKey: 'test-key-a', baseUrl: 'https://a.example.test' });
  });

  it('preserves bindings through normalization and filters invalid keys', () => {
    const normalized = normalizeGenerationSettings(JSON.parse(JSON.stringify({ ...defaultGenerationSettings, taskModelBindings: { inspiration: { providerId: ' p ', modelId: ' m ' }, writing: { providerId: '', modelId: 'm' }, review: { providerId: 'p', modelId: '  ' }, bogus: { providerId: 'x', modelId: 'y' } } })));
    expect(normalized.taskModelBindings).toEqual({ inspiration: { providerId: 'p', modelId: 'm' } });
    expect(normalizeGenerationSettings(JSON.parse(JSON.stringify(normalized))).taskModelBindings).toEqual(normalized.taskModelBindings);
  });

  it('clearing one task does not affect another and unbound tasks keep the lane', () => {
    const providers = { a: provider('a', 'default', true), b: provider('b', 'special', false) };
    const settings = normalizeGenerationSettings({ ...defaultGenerationSettings, utilityProviderId: 'a', utilityModelId: 'default', taskModelBindings: { inspiration: { providerId: 'b', modelId: 'special' }, character: { providerId: 'b', modelId: 'special' } } });
    const cleared = normalizeGenerationSettings({ ...settings, taskModelBindings: { character: settings.taskModelBindings?.character } });
    expect(resolveApiSettings(providers, cleared, { purpose: 'utility', task: 'inspiration' }).providerId).toBe('a');
    expect(resolveApiSettings(providers, cleared, { purpose: 'utility', task: 'character' }).providerId).toBe('b');
    expect(resolveApiSettings(providers, cleared, { purpose: 'utility' }).providerId).toBe('a');
  });

  it('reports a missing bound provider and maps agents to their task routes', () => {
    expect(() => resolveApiSettings({ a: provider('a', 'm', true) }, normalizeGenerationSettings({ ...defaultGenerationSettings, taskModelBindings: { inspiration: { providerId: 'gone', modelId: 'm' } } }), { task: 'inspiration', purpose: 'utility' })).toThrow('灵感');
    const providers = { a: provider('a', 'm', true), b: provider('b', 'chat', false) };
    const settings = normalizeGenerationSettings({ ...defaultGenerationSettings, taskModelBindings: { chat: { providerId: 'b', modelId: 'chat' }, memory: { providerId: 'b', modelId: 'chat' } } });
    expect(resolveAgentApiSettings(providers, settings, 'narrator').model).toBe('chat');
    expect(resolveAgentApiSettings(providers, settings, 'memory').model).toBe('chat');
  });
});
