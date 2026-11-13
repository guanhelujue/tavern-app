import { describe, expect, it, vi } from 'vitest';
import { recoverStructuredResponse } from './structured-response';

type Reply = { content: string; promptTokens?: number; completionTokens?: number };

describe('recoverStructuredResponse', () => {
  it('returns locally recovered JSON without a second request', async () => {
    const repair = vi.fn();
    const result = await recoverStructuredResponse<Reply>({ content: '{"items":[1,2' }, { repair });
    expect(JSON.parse(result.content)).toEqual({ items: [1, 2] });
    expect(result.jsonRecovery.status).toBe('recovered');
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs a semantically incomplete response once', async () => {
    const repair = vi.fn().mockResolvedValue({ content: '{"items":[1,2,3]}' });
    const result = await recoverStructuredResponse<Reply>({ content: '{"items":[]}' }, {
      repair,
      validate: (value) => Array.isArray((value as { items?: unknown }).items) && (value as { items: unknown[] }).items.length >= 3,
    });
    expect(JSON.parse(result.content)).toEqual({ items: [1, 2, 3] });
    expect(result.jsonRecovery.status).toBe('repaired');
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][0]).toContain('不要编造新的事实');
  });

  it('does not silently accept a semantically invalid response when repair fails', async () => {
    const repair = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(recoverStructuredResponse<Reply>({ content: '{"items":[1]}' }, {
      repair,
      validate: (value) => Array.isArray((value as { items?: unknown }).items) && (value as { items: unknown[] }).items.length >= 2,
    })).rejects.toThrow('offline');
  });

  it('propagates cancellation instead of returning a partial response', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(recoverStructuredResponse<Reply>({ content: '{}' }, { repair: vi.fn(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps both replies when the single repair is still unusable', async () => {
    await expect(recoverStructuredResponse<Reply>({ content: 'original response' }, {
      repair: vi.fn().mockResolvedValue({ content: 'repair response' }),
    })).rejects.toMatchObject({ rawContent: 'original response', repairedContent: 'repair response' });
  });

  it('requires a complete audit even if some issues can be salvaged', async () => {
    const partial = '{"issues":[{"description":"完整问题"},{"description":"截断';
    const repair = vi.fn().mockResolvedValue({ content: partial });
    await expect(recoverStructuredResponse<Reply>({ content: partial }, { repair, allowPartial: false })).rejects.toThrow();
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('propagates an abort returned by the repair transport without an external signal', async () => {
    const abort = new Error('cancelled'); abort.name = 'AbortError';
    await expect(recoverStructuredResponse<Reply>({ content: 'invalid' }, { repair: vi.fn().mockRejectedValue(abort) })).rejects.toBe(abort);
  });
});
