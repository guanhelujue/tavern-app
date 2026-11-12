import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IMAGE_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  createImageProvider,
  getImageModelOptions,
  normalizeImageGenerationSettings,
} from './image-models';

describe('local image model catalog', () => {
  it('uses ComfyUI Qwen defaults on a fresh install', () => {
    const settings = normalizeImageGenerationSettings();
    expect(settings.providerId).toBe('comfyui');
    expect(settings.providers.comfyui).toMatchObject({
      baseUrl: DEFAULT_IMAGE_BASE_URL,
      modelId: DEFAULT_IMAGE_MODEL,
      protocol: 'comfyui',
      auth: 'none',
    });
  });

  it('preserves a legacy cloud provider and keeps it active', () => {
    const settings = normalizeImageGenerationSettings({
      providerId: 'gemini',
      providers: {
        gemini: {
          id: 'gemini',
          name: 'Legacy Gemini',
          baseUrl: 'http://127.0.0.1:8317',
          apiKey: 'legacy-key',
          modelId: 'gemini-3.1-flash-image',
          protocol: 'auto',
          auth: 'auto',
        },
      },
    });
    expect(settings.providerId).toBe('gemini');
    expect(settings.providers.gemini).toMatchObject({
      baseUrl: 'http://127.0.0.1:8317',
      modelId: 'gemini-3.1-flash-image',
      protocol: 'auto',
      auth: 'auto',
    });
    expect(settings.providers.comfyui).toBeUndefined();
  });

  it('recognizes a custom LAN ComfyUI host without silently replacing its model ID', () => {
    const settings = normalizeImageGenerationSettings({
      providerId: 'lan',
      providers: {
        lan: {
          id: 'lan',
          name: 'LAN ComfyUI',
          baseUrl: 'http://192.168.1.20:8188',
          modelId: 'unsupported-custom-model',
          protocol: 'auto',
          auth: 'auto',
        },
      },
    });
    expect(settings.providerId).toBe('lan');
    expect(settings.providers.lan).toMatchObject({
      baseUrl: 'http://192.168.1.20:8188',
      modelId: 'unsupported-custom-model',
      protocol: 'comfyui',
      auth: 'none',
    });
  });

  it('keeps the explicitly selected second local host active', () => {
    const settings = normalizeImageGenerationSettings({
      providerId: 'host-two',
      providers: {
        'host-one': { baseUrl: 'http://127.0.0.1:8188', modelId: 'moss-image' },
        'host-two': { baseUrl: 'http://192.168.1.30:8188', modelId: 'z-image' },
      },
    });
    expect(settings.providerId).toBe('host-two');
    expect(settings.providers['host-two'].modelId).toBe('z-image');
  });

  it('does not overwrite a cloud provider whose id is comfyui', () => {
    const settings = normalizeImageGenerationSettings({
      providerId: 'comfyui',
      providers: {
        comfyui: {
          id: 'comfyui',
          name: 'Cloud gateway',
          baseUrl: 'https://example.test/v1',
          modelId: 'cloud-image-model',
          protocol: 'auto',
          auth: 'bearer',
        },
      },
    });
    expect(settings.providers.comfyui.baseUrl).toBe('https://example.test/v1');
    expect(settings.providers.comfyui.protocol).toBe('auto');
    expect(settings.providerId).toBe('comfyui');
    expect(settings.providers['comfyui-local']).toBeUndefined();
  });

  it('creates a blank custom provider by default', () => {
    expect(createImageProvider()).toMatchObject({
      baseUrl: '', modelId: '', protocol: 'auto', auth: 'auto', name: '自定义图像厂商',
    });
    expect(createImageProvider({ id: 'comfyui', protocol: 'openai-compatible' })).toMatchObject({
      baseUrl: '', modelId: '', protocol: 'openai-compatible', auth: 'auto',
    });
  });

  it('keeps an explicitly remote provider even when its model resembles a local model', () => {
    const settings = normalizeImageGenerationSettings({ providerId: 'proxy', providers: {
      proxy: { name: '反代图像', baseUrl: 'http://127.0.0.1:8188/v1', modelId: DEFAULT_IMAGE_MODEL, protocol: 'openai-compatible', auth: 'bearer' },
    }});
    expect(settings.providerId).toBe('proxy');
    expect(settings.providers.proxy).toMatchObject({ protocol: 'openai-compatible', modelId: DEFAULT_IMAGE_MODEL, auth: 'bearer' });
  });

  it('keeps an explicitly empty provider map empty', () => {
    expect(normalizeImageGenerationSettings({ providerId: 'old', providers: {} })).toEqual({ providerId: '', providers: {} });
  });

  it('preserves explicit empty and custom local model IDs', () => {
    const settings = normalizeImageGenerationSettings({ providerId: 'local', providers: {
      local: { baseUrl: 'http://127.0.0.1:8188', protocol: 'comfyui', modelId: '' },
      custom: { baseUrl: 'http://127.0.0.1:8188', protocol: 'comfyui', modelId: 'my-workflow' },
    }});
    expect(settings.providers.local.modelId).toBe('');
    expect(settings.providers.custom.modelId).toBe('my-workflow');
  });

  it('separates local and remote model choices', () => {
    expect(getImageModelOptions({ protocol: 'comfyui' }).every((model) => model.protocol === 'comfyui')).toBe(true);
    expect(getImageModelOptions({ protocol: 'openai-compatible' }).every((model) => model.protocol !== 'comfyui')).toBe(true);
  });
});
