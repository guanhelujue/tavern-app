import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCompletionWithUsage, requestPlainCompletion } from './llm';
import type { ApiSettings } from '@/types/tavern';

const apiSettings: ApiSettings = { baseUrl: 'https://example.invalid/v1', apiKey: '', model: 'test-model', temperature: .4,
  maxTokens: 2000, contextWindowMessages: 10, streamingEnabled: false, requestTimeoutMs: 1000, requestRetryCount: 0,
  debugPromptInspectorEnabled: false, replyLengthPreset: 'normal', continuationOnTruncation: false };
const messages = [{ role: 'user' as const, content: '输出 JSON 路线列表。' }];
function reply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.unstubAllGlobals());

describe('actual LLM JSON request boundary', () => {
  it('recovers truncated JSON locally without sending a second request', async () => {
    const fetch = vi.fn().mockResolvedValue(reply('{"routes":[{"title":"可用路线"}'));
    vi.stubGlobal('fetch', fetch);
    const result = await requestCompletionWithUsage({ apiSettings, messages, responseFormat: 'json' });
    expect(JSON.parse(result.content)).toEqual({ routes: [{ title: '可用路线' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('repairs once, preserves the original in context, and counts both requests', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply('路线：沿河调查。')).mockResolvedValueOnce(reply('{"routes":["沿河调查"]}'));
    vi.stubGlobal('fetch', fetch);
    const result = await requestCompletionWithUsage({ apiSettings, messages, responseFormat: 'json' });
    expect(JSON.parse(result.content)).toEqual({ routes: ['沿河调查'] });
    expect(result).toMatchObject({ promptTokens: 20, completionTokens: 40 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    expect(request.messages.some((entry: { content: string }) => entry.content === '路线：沿河调查。')).toBe(true);
  });
  it('does not reinterpret prose, even if it contains a JSON example', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('她写下 {"字":"雨"}，然后合上书。')));
    expect(await requestPlainCompletion({ apiSettings, messages })).toBe('她写下 {"字":"雨"}，然后合上书。');
  });
  it('does not treat an incomplete audit as an empty successful audit', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply('{"score":100,"issues":[{"description":"未完成'))
      .mockResolvedValueOnce(reply('{"score":40,"issues":[{"description":"人物矛盾"}]}'));
    vi.stubGlobal('fetch', fetch);
    const result = await requestCompletionWithUsage({ apiSettings, messages, responseFormat: 'json', allowPartialJson: false,
      validateJson: (value) => Array.isArray((value as { issues?: unknown }).issues) });
    expect(JSON.parse(result.content).score).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
