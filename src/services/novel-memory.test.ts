import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiSettings, Novel } from '../types/tavern';
import { requestPlainCompletion } from './llm';
import { refreshNovelMemoryAndSummaryAfterTurn } from './novel-memory';

vi.mock('./llm', () => ({ requestPlainCompletion: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe('unified novel memory response', () => {
  it('retries a non-empty but malformed JSON response before declaring memory write failed', async () => {
    const completion = vi.mocked(requestPlainCompletion)
      .mockResolvedValueOnce('{"shortTermMemory":"主角出门","summary":{')
      .mockResolvedValueOnce(JSON.stringify({
        shortTermMemory: '主角出门',
        midTermMemory: '',
        longTermMemory: '',
        summary: { currentSituation: '主角正在路上', events: ['主角离开家'] },
      }));

    const result = await refreshNovelMemoryAndSummaryAfterTurn({
      apiSettings: { temperature: 0.5, maxTokens: 1024 } as ApiSettings,
      novel: {} as Novel,
      userContent: '出门',
      assistantContent: '主角离开家，走在路上。',
      longTermMemory: '',
      midTermMemories: [],
      shortTermMemories: [],
      agentSummary: '',
    });

    expect(result.shortTermMemories).toEqual(['主角出门']);
    expect(result.agentSummary).toContain('主角正在路上');
    expect(completion).toHaveBeenCalledTimes(2);
    const first = completion.mock.calls[0][0].apiSettings.maxTokens;
    const second = completion.mock.calls[1][0].apiSettings.maxTokens;
    expect(second).toBeGreaterThan(first);
  });

  it('does not retry a valid response', async () => {
    const completion = vi.mocked(requestPlainCompletion).mockResolvedValueOnce(JSON.stringify({
      shortTermMemory: '主角出门',
      summary: { currentSituation: '主角正在路上' },
    }));

    await refreshNovelMemoryAndSummaryAfterTurn({
      apiSettings: { temperature: 0.5, maxTokens: 1024 } as ApiSettings,
      novel: {} as Novel,
      userContent: '出门',
      assistantContent: '主角离开家，走在路上。',
      longTermMemory: '',
      midTermMemories: [],
      shortTermMemories: [],
      agentSummary: '',
    });

    expect(completion).toHaveBeenCalledTimes(1);
  });

  it.each(['malformed', 'network'])('keeps a usable short memory when summary repair fails: %s', async (failure) => {
    const completion = vi.mocked(requestPlainCompletion).mockResolvedValueOnce('{"shortTermMemory":"主角出门","summary":{');
    if (failure === 'network') completion.mockRejectedValueOnce(new Error('offline'));
    else completion.mockResolvedValueOnce('{"shortTermMemory":"主角出门","summary":{');

    const result = await refreshNovelMemoryAndSummaryAfterTurn({
      apiSettings: { temperature: 0.5, maxTokens: 1024 } as ApiSettings,
      novel: {} as Novel,
      userContent: '出门',
      assistantContent: '主角离开家，走在路上。',
      longTermMemory: '',
      midTermMemories: [],
      shortTermMemories: [],
      agentSummary: '',
    });

    expect(completion).toHaveBeenCalledTimes(2);
    expect(result.shortTermMemories).toEqual(['主角出门']);
    expect(result.agentSummary).toBe('');
  });

  it('still fails when neither response contains any usable memory', async () => {
    const completion = vi.mocked(requestPlainCompletion).mockResolvedValue('not json');

    await expect(refreshNovelMemoryAndSummaryAfterTurn({
      apiSettings: { temperature: 0.5, maxTokens: 1024 } as ApiSettings,
      novel: {} as Novel,
      userContent: '出门',
      assistantContent: '主角离开家，走在路上。',
      longTermMemory: '',
      midTermMemories: [],
      shortTermMemories: [],
      agentSummary: '',
    })).rejects.toThrow('重试后仍未返回完整、可用的 JSON');

    expect(completion).toHaveBeenCalledTimes(2);
  });
});
