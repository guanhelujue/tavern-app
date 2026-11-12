import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearProviderModelCache, discoverProviderModels } from './provider-model-discovery';

afterEach(() => {
  clearProviderModelCache();
  vi.useRealTimers();
});

describe('provider model discovery', () => {
  it('requests fresh models when the user explicitly refreshes a cached list', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'old-model' }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'new-model' }] }) });
    const input = { providerId: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'test-key', fetchImpl };

    expect((await discoverProviderModels(input)).models).toEqual(['old-model']);
    const refreshed = await discoverProviderModels({ ...input, refresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshed).toEqual({ models: ['new-model'], source: 'remote', cached: false });
  });

  it('uses a previous remote list if an explicit refresh fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'known-model' }] }) })
      .mockResolvedValueOnce({ ok: false, text: async () => 'unavailable' });
    const input = { providerId: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'test-key', fetchImpl };

    await discoverProviderModels(input);
    const refreshed = await discoverProviderModels({ ...input, refresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refreshed).toEqual({ models: ['known-model'], source: 'remote', cached: true });
  });

  it('still reuses the cache for non-manual discovery', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify({ data: [{ id: 'known-model' }] }),
    });
    const input = { providerId: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'test-key', fetchImpl };

    await discoverProviderModels(input);
    expect(await discoverProviderModels(input)).toEqual({
      models: ['known-model'], source: 'remote', cached: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns no static models without a key or when remote discovery has no cache', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const input = { providerId: 'glm', baseUrl: 'https://example.test/v1', fetchImpl };

    expect(await discoverProviderModels(input)).toEqual({ models: [], source: 'remote', cached: false });
    expect(await discoverProviderModels({ ...input, apiKey: 'test-key', refresh: true })).toEqual({
      models: [], source: 'remote', cached: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('finishes a stalled request so the model picker can be retried', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const result = discoverProviderModels({
      providerId: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'test-key', fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(await result).toEqual({ models: [], source: 'remote', cached: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reuse an authenticated list after switching credentials', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ data: [{ id: 'account-a-model' }] }) })
      .mockResolvedValueOnce({ ok: false, text: async () => 'unauthorized' });
    const input = { providerId: 'custom', baseUrl: 'https://example.test/v1', fetchImpl };
    await discoverProviderModels({ ...input, apiKey: 'account-a' });
    expect(await discoverProviderModels({ ...input, apiKey: 'account-b', refresh: true })).toEqual({
      models: [], source: 'remote', cached: false,
    });
    expect(await discoverProviderModels(input)).toEqual({ models: [], source: 'remote', cached: false });
  });
});
