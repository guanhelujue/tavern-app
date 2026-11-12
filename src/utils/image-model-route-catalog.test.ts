import { describe, expect, it } from 'vitest';
import { buildImageModelPresetCatalog, buildImageModelRouteCatalog, imageModelDisplayName, resolveImageModelRoute } from './image-model-route-catalog';
import type { ImageProviderConfig } from '@/types/tavern';

const provider = (overrides: Partial<ImageProviderConfig> = {}): ImageProviderConfig => ({
  id: 'comfy', name: '本地 ComfyUI', apiKey: '', baseUrl: 'http://127.0.0.1:8188', modelId: 'qwen-image-2.1', protocol: 'comfyui', auth: 'none', ...overrides,
});

describe('image model route catalog', () => {
  it('keeps three model brands and exposes all local models', () => {
    const groups = buildImageModelRouteCatalog({ comfy: provider() });
    expect(groups.find((group) => group.id === 'open-source')?.models.map((item) => item.key)).toEqual(expect.arrayContaining(['qwen-image-2.1', 'moss-image', 'z-image']));
    expect(groups.map((group) => group.id)).toEqual(['open-source', 'gemini', 'openai']);
  });

  it('shows configured presets separately from usable runtime routes', () => {
    const remote = provider({ id: 'remote', name: '反代', protocol: 'openai-compatible', auth: 'bearer', baseUrl: 'https://proxy/v1', modelId: 'custom-image' });
    expect(buildImageModelPresetCatalog(remote).find((group) => group.id === 'openai')?.models.length).toBeGreaterThan(0);
    const runtimeModels = buildImageModelRouteCatalog({ remote }).flatMap((group) => group.models);
    expect(runtimeModels.filter((item) => item.routes.length).map((item) => item.key)).toEqual(['custom-image']);
    expect(runtimeModels.find((item) => item.key === 'gpt-image-2')?.routes).toEqual([]);
    expect(buildImageModelPresetCatalog(remote).some((group) => group.id === 'open-source')).toBe(false);
  });

  it('keeps remote routes bound only to their configured model', () => {
    const groups = buildImageModelRouteCatalog({ remote: provider({ id: 'remote', protocol: 'openai-compatible', baseUrl: 'https://proxy/v1', modelId: 'gemini-3.1-flash-image' }) });
    expect(groups.find((group) => group.id === 'gemini')?.models[0].routes[0].providerId).toBe('remote');
    expect(groups.find((group) => group.id === 'open-source')?.models.every((item) => item.routes.length === 0)).toBe(true);
  });

  it('deduplicates identical routes but preserves distinct keys and lines', () => {
    const groups = buildImageModelRouteCatalog({ a: provider({ id: 'a', apiKey: 'same' }), b: provider({ id: 'b', apiKey: 'same', baseUrl: 'http://127.0.0.1:8188/' }), c: provider({ id: 'c', apiKey: 'different' }) }, 'b');
    expect(groups.find((group) => group.id === 'open-source')?.models.find((item) => item.key === 'moss-image')?.routes).toHaveLength(2);
    const qwen = groups.find((group) => group.id === 'open-source')?.models.find((item) => item.key === 'qwen-image-2.1');
    expect(qwen?.routes).toHaveLength(2);
    expect(qwen?.routes[0].providerId).toBe('b');
  });

  it('does not expose empty remote connections or mutate input', () => {
    const input = { remote: provider({ id: 'remote', protocol: 'auto', baseUrl: '', modelId: '' }) };
    const before = JSON.stringify(input);
    expect(buildImageModelRouteCatalog(input).flatMap((group) => group.models).every((item) => item.routes.length === 0)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('resolves MOSS without falling back to Qwen', () => {
    const result = resolveImageModelRoute({ comfy: provider() }, 'moss-image', 'comfy');
    expect(result.modelId).toBe('moss-image');
    expect(result.provider.id).toBe('comfy');
    expect(result.provider.modelId).toBe('qwen-image-2.1');
  });

  it('formats Nano Banana alias without changing wire id and preserves unknown ids', () => {
    expect(imageModelDisplayName('gemini-3.1-flash-image')).toContain('Gemini 3.1 Flash Image');
    expect(imageModelDisplayName('gemini-3.1-flash-image')).toContain('Nano Banana');
    expect(imageModelDisplayName('models/custom-image')).toBe('custom image');
  });

  it('rejects stale, missing and unconfigured routes', () => {
    expect(() => resolveImageModelRoute({}, 'moss-image', 'comfy')).toThrow('不存在');
    expect(() => resolveImageModelRoute({ comfy: provider({ baseUrl: '' }) }, 'moss-image', 'comfy')).toThrow('Base URL');
    expect(() => resolveImageModelRoute({ comfy: provider() }, 'gpt-image-2', 'comfy')).toThrow('不属于');
    expect(() => resolveImageModelRoute({ remote: provider({ id: 'remote', protocol: 'auto', modelId: 'gpt-image-2' }) }, 'moss-image', 'remote')).toThrow('不属于');
  });

  it('groups models by identity rather than connection name and preserves wire aliases', () => {
    const remote = provider({ id: 'remote', name: 'Qwen 代理', protocol: 'auto', modelId: 'models/gemini-3.1-flash-image-preview', apiKey: 'secret-value' });
    const catalog = buildImageModelRouteCatalog({ remote });
    const model = catalog.find((group) => group.id === 'gemini')?.models.find((item) => item.routes.length);
    expect(model?.routes[0].modelId).toBe(remote.modelId);
    expect(resolveImageModelRoute({ remote }, remote.modelId, remote.id).modelId).toBe(remote.modelId);
    expect(JSON.stringify(catalog)).not.toContain('secret-value');
  });

  it('preserves distinct case-sensitive URL paths as separate routes', () => {
    const catalog = buildImageModelRouteCatalog({ a: provider({ id: 'a', baseUrl: 'https://proxy/A' }), b: provider({ id: 'b', baseUrl: 'https://proxy/a' }) });
    expect(catalog.find((group) => group.id === 'open-source')?.models.find((item) => item.key === 'moss-image')?.routes).toHaveLength(2);
  });

  it('limits preset selection to the explicit protocol and keeps custom model ids', () => {
    const local = buildImageModelPresetCatalog(provider({ baseUrl: '' }));
    expect(local.map((group) => group.id)).toEqual(['open-source']);
    const remote = provider({ protocol: 'google-generate-content', modelId: 'models/gemini-custom-image' });
    const presets = buildImageModelPresetCatalog(remote);
    expect(presets.map((group) => group.id)).toEqual(['gemini']);
    expect(presets[0].models.find((item) => item.key === 'gemini-custom-image')?.routes[0].modelId).toBe(remote.modelId);
  });
});
