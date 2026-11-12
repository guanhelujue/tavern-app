import { describe, expect, it, vi } from 'vitest';

import { readNovelImageAsInlineData } from '../utils/novel-images';

import { generateImage } from './image-generation';

vi.mock('../utils/novel-images', () => ({
  persistGeneratedImage: vi.fn(async () => 'file:///generated.png'),
  readNovelImageAsInlineData: vi.fn(),
}));

describe('Gemini image generation request', () => {
  it('sends OFF safety settings for every configured category', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }],
    }), { status: 200 }));

    await generateImage({
      apiSettings: {
        baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-key',
        protocol: 'google-generate-content',
      },
      model: 'gemini-2.5-flash-image', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.safetySettings).toEqual(expect.arrayContaining([
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
    ]));
    expect(body.safetySettings.every((setting: { threshold: string }) => setting.threshold === 'OFF')).toBe(true);
  });

  it('locks only the face when a reference image is attached', async () => {
    vi.mocked(readNovelImageAsInlineData).mockResolvedValueOnce({
      base64: 'ZmFrZQ==',
      dataUri: 'data:image/png;base64,ZmFrZQ==',
      mimeType: 'image/png',
    });
    const fetchImpl = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }],
    }), { status: 200 }));

    await generateImage({
      apiSettings: {
        baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-key',
        protocol: 'google-generate-content',
      },
      model: 'gemini-2.5-flash-image', purpose: 'portrait', prompt: 'portrait',
      referenceImageUri: 'file:///reference.png', fetchImpl,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const text = body.contents[0].parts.find((part: { text?: string }) => part.text)?.text ?? '';
    expect(text).toContain('只用于锁定目标人物的脸部身份');
    expect(text).toContain('发型、发色、服装、配饰、姿势、动作、体态、体格、年龄观感与场景均不要求与参考图相同');
  });
});

describe('image protocol routing', () => {
  it('rejects a missing model for a remote provider instead of silently using Qwen', async () => {
    await expect(generateImage({
      apiSettings: { baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key', protocol: 'openai-compatible', auth: 'bearer' },
      purpose: 'portrait', prompt: 'portrait', fetchImpl: vi.fn(),
    })).rejects.toThrow('模型 ID');
  });
  it('keeps an explicitly remote protocol when the model id matches a local preset', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('qwen-image-2.1');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'data:image/png;base64,ZmFrZQ==' } }] }), { status: 200 });
    });
    await generateImage({
      apiSettings: {
        baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key',
        protocol: 'openai-compatible', auth: 'bearer',
      },
      model: 'qwen-image-2.1', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://proxy.example/v1/chat/completions', expect.anything());
  });

  it('uses an explicit remote API key even when the model id is a local preset', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer proxy-key');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'data:image/png;base64,ZmFrZQ==' } }] }), { status: 200 });
    });
    await generateImage({
      apiSettings: {
        baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key',
        protocol: 'openai-compatible', auth: 'auto',
      },
      model: 'qwen-image-2.1', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });
  });

  it('uses the OpenAI Images endpoint and response shape', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer proxy-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-image-2', n: 1 });
      return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
    });
    await generateImage({
      apiSettings: { baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key', protocol: 'openai-images', auth: 'bearer' },
      model: 'gpt-image-2', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://proxy.example/v1/images/generations', expect.anything());
  });

  it('uses the OpenAI Responses image tool endpoint and output result', async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-5.5', tools: [{ type: 'image_generation' }] });
      return new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: 'ZmFrZQ==' }] }), { status: 200 });
    });
    await generateImage({
      apiSettings: { baseUrl: 'https://proxy.example/v1', apiKey: 'proxy-key', protocol: 'openai-responses-image', auth: 'bearer' },
      model: 'gpt-5.5', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://proxy.example/v1/responses', expect.anything());
  });

  it('still infers Gemini native protocol when protocol is auto', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }] }), { status: 200 }));
    await generateImage({
      apiSettings: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-key', protocol: 'auto', auth: 'auto' },
      model: 'gemini-2.5-flash-image', purpose: 'portrait', prompt: 'portrait', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(':generateContent?key='), expect.anything());
  });
});
