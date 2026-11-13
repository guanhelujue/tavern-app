import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiSettings } from '@/types/tavern';
import { requestCompletionWithUsage } from './llm';
import { generateSupportingCharacters, generateNovelFramework, generateNovelLoreEntry, generateNovelLoreDraftBatch, type NovelFrameworkDraft, type NovelLoreBatchCounts } from './novel-create-ai';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '@/utils/novel-player';
import { normalizeLoreEntry } from '@/utils/novel-lore';

vi.mock('./llm', () => ({ requestCompletionWithUsage: vi.fn(), requestPlainCompletion: vi.fn() }));

const apiSettings = { temperature: 0.4, maxTokens: 2000 } as ApiSettings;
const framework: NovelFrameworkDraft = { ...EMPTY_PLAYER_PROFILE_FIELDS, playerName: '', playerPersona: '', playerMotive: '', worldName: '已有世界', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '', cast: [] };
const counts: NovelLoreBatchCounts = { world: 0, location: 0, faction: 0, item: 0, lore: 0, custom: 0 };
const reply = (value: unknown) => ({ content: JSON.stringify(value) });
beforeEach(() => { vi.mocked(requestCompletionWithUsage).mockReset(); });

describe('novel creation JSON recovery', () => {
  it('repairs a syntactically valid but unusable supporting-character array', async () => {
    const request = vi.mocked(requestCompletionWithUsage);
    request.mockResolvedValueOnce({ content: JSON.stringify([{ cast: {} }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([{ cast: { name: '林澈', gender: '女' } }]) });

    const result = await generateSupportingCharacters({
      apiSettings,
      novelName: '测试小说',
      framework,
      recentReplyContent: '林澈站在门边。',
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('林澈');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('repairs an empty framework response even when the author has existing fields', async () => {
    const request = vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply({ gameRules: '禁止越界' }));
    const result = await generateNovelFramework({ apiSettings, novelName: '测试', current: framework });
    expect(result.worldName).toBe('已有世界');
    expect(result.gameRules).toBe('禁止越界');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('repairs lore missing its body instead of returning an empty draft', async () => {
    const request = vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce(reply({ name: '城门' }))
      .mockResolvedValueOnce(reply({ name: '城门', content: '日落后关闭。' }));
    const current = normalizeLoreEntry({ id: 'new', type: 'location', name: '', content: '', aliases: [], enabled: true, updatedAt: '' });
    const result = await generateNovelLoreEntry({ apiSettings, novelName: '测试', current });
    expect(result.content).toBe('日落后关闭。');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps good lore candidates around a damaged entry and accepts a smaller batch', async () => {
    const request = vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce(reply({ entries: [
      { type: 'location', name: '城门', content: '日落后关闭。' },
      { type: 'location', name: '破损条目' },
    ] }));
    const result = await generateNovelLoreDraftBatch({ apiSettings, novelName: '测试', counts: { ...counts, location: 3 } });
    expect(result.entries.map(entry => entry.name)).toEqual(['城门']);
    expect(result.requested.location).toBe(3);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps completed batches when a later batch and its repair fail', async () => {
    vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce(reply({ entries: [{ type: 'world', name: '世界', content: '边境禁止通行。' }] }))
      .mockResolvedValueOnce(reply({ entries: [] })).mockRejectedValueOnce(new Error('修复网络中断'));
    const result = await generateNovelLoreDraftBatch({ apiSettings, novelName: '测试', counts: { ...counts, world: 1, location: 1 } });
    expect(result.entries.map(entry => entry.name)).toEqual(['世界']);
  });

  it('propagates cancellation instead of presenting a completed partial batch', async () => {
    const abort = new Error('cancelled'); abort.name = 'AbortError';
    vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce(reply({ entries: [{ type: 'world', name: '世界', content: '边境禁止通行。' }] })).mockRejectedValueOnce(abort);
    await expect(generateNovelLoreDraftBatch({ apiSettings, novelName: '测试', counts: { ...counts, world: 1, location: 1 } })).rejects.toBe(abort);
  });

  it('can recover later batches even when the first batch fails', async () => {
    vi.mocked(requestCompletionWithUsage).mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(reply({ entries: [{ type: 'location', name: '城门', content: '日落后关闭。' }] }));
    const result = await generateNovelLoreDraftBatch({ apiSettings, novelName: '测试', counts: { ...counts, world: 1, location: 1 } });
    expect(result.entries.map(entry => entry.name)).toEqual(['城门']);
  });

  it('reports failure if every batch is unusable', async () => {
    vi.mocked(requestCompletionWithUsage).mockRejectedValue(new Error('unavailable'));
    await expect(generateNovelLoreDraftBatch({ apiSettings, novelName: '测试', counts: { ...counts, world: 1 } })).rejects.toThrow('unavailable');
  });

});
