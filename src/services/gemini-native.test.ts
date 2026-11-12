import { afterEach, describe, expect, it, vi } from 'vitest';

import { completeGeminiNative, GEMINI_PERMISSIVE_SAFETY_SETTINGS } from './gemini-native';

afterEach(() => vi.unstubAllGlobals());

describe('Gemini native request', () => {
  it('sends all configured safety categories with OFF thresholds', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '完成' }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await completeGeminiNative({
      baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-key',
      model: 'gemini-2.5-flash', messages: [{ role: 'user', content: '你好' }],
      temperature: 0.5, maxTokens: 128, streaming: false,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.safetySettings).toEqual(GEMINI_PERMISSIVE_SAFETY_SETTINGS);
  });
});
