import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSettings, Novel, NovelChapter } from '@/types/tavern';
import { requestPlainCompletion } from '@/services/llm';
import { requestChapterRewrite } from './novel-chapter-rewrite';

vi.mock('@/services/llm', () => ({ requestPlainCompletion: vi.fn() }));

describe('chapter rewrite candidate', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rewrites the selected chapter with current canon and earlier chapters only, without changing the original', async () => {
    const chapter = { id: 'c2', index: 2, title: '返校', content: '旧正文', goal: '校园喜剧', summary: '', status: 'draft' } as NovelChapter;
    const novel = { id: 'n', name: '测试', systemPrompt: '使用第一人称书信体，保留标题和落款。', playerName: '', playerMotive: '', worldEra: '高中', gameRules: '普通人看不见陆昭', cast: [], characterDossiers: [], loreEntries: [], chapters: [
      { ...chapter, id: 'c1', index: 1, status: 'final', content: '先前发生的事情', summary: '返校前一天' },
      chapter, { ...chapter, id: 'c3', index: 3, status: 'final', content: '未来秘密不能提前写' },
    ] } as unknown as Novel;
    vi.mocked(requestPlainCompletion).mockResolvedValueOnce('新版正文');
    const result = await requestChapterRewrite({ novel, chapter, apiSettings: {} as ApiSettings, instruction: '改成食堂误会', mode: 'rewrite' });
    expect(result).toBe('新版正文');
    expect(chapter.content).toBe('旧正文');
    const request = vi.mocked(requestPlainCompletion).mock.calls.at(-1)![0];
    const context = request.messages.map((message) => message.content).join('\n');
    expect(request.messages[0].content).toContain(novel.systemPrompt);
    expect(request.messages[0].content).not.toContain('不返回点评、Markdown代码围栏或章节标题');
    expect(context).toContain('普通人看不见陆昭');
    expect(context).toContain('先前发生的事情');
    expect(context).toContain('改成食堂误会');
    expect(context).not.toContain('未来秘密不能提前写');
  });
  it('rejects an empty response instead of offering to replace the chapter with nothing', async () => {
    vi.mocked(requestPlainCompletion).mockResolvedValueOnce(' ');
    await expect(requestChapterRewrite({ novel: { name: '测试', playerName: '', playerMotive: '', cast: [], loreEntries: [], characterDossiers: [] } as unknown as Novel,
      chapter: { id: 'c', index: 1, title: '', content: '原稿', goal: '' } as NovelChapter,
      apiSettings: {} as ApiSettings, instruction: '', mode: 'polish' })).rejects.toThrow('没有返回');
  });
  it('rejects a short AI revision while keeping the saved chapter intact', async () => {
    const chapter = { id: 'c', index: 1, title: '', content: '原'.repeat(2800), goal: '', targetWords: 3000 } as NovelChapter;
    vi.mocked(requestPlainCompletion).mockResolvedValueOnce('改'.repeat(1500));
    await expect(requestChapterRewrite({ novel: { name: '测试', playerName: '', playerMotive: '', cast: [], loreEntries: [], characterDossiers: [] } as unknown as Novel,
      chapter, apiSettings: {} as ApiSettings, instruction: '', mode: 'polish' })).rejects.toThrow('至少需要 2700 字');
    expect(chapter.content).toBe('原'.repeat(2800));
  });
});
