import { describe, expect, it } from 'vitest';
import { buildImportedNovelChapters, getNextImportedChapterIndex, validateNovelTextImport } from './novel-text-import';

const chapter = (index: number, status: 'draft' | 'final' = 'final') => ({ id: String(index), index, title: '', summary: '', goal: '', content: 'x', status, createdAt: '', updatedAt: '' });

describe('novel text import', () => {
  it('appends after the highest existing index and marks imported chapters final', () => {
    expect(getNextImportedChapterIndex([chapter(2), chapter(7)])).toBe(8);
    const result = buildImportedNovelChapters([{ title: '一', content: '正文' }, { title: '', content: '后文' }], [chapter(7)], '2026-01-01T00:00:00.000Z');
    expect(result.map((item) => [item.index, item.title, item.status])).toEqual([[8, '一', 'final'], [9, '第9章', 'final']]);
  });

  it('blocks empty files, drafts, unfinished jobs, and unmigrated text', () => {
    expect(validateNovelTextImport({ imported: { chapters: [] } }).ok).toBe(false);
    expect(validateNovelTextImport({ imported: { chapters: [{ title: '', content: 'x' }] }, existingChapters: [chapter(1, 'draft')] }).ok).toBe(false);
    expect(validateNovelTextImport({ imported: { chapters: [{ title: '', content: 'x' }] }, generationJobs: [{ status: 'running' }] }).ok).toBe(false);
    expect(validateNovelTextImport({ imported: { chapters: [{ title: '', content: 'x' }] }, legacyChapters: [{ status: 'draft', content: 'old' }] }).ok).toBe(false);
    expect(validateNovelTextImport({ imported: { chapters: [{ title: '', content: 'x' }] }, legacyChapters: [{ status: 'final', content: '' }] }).ok).toBe(true);
    expect(validateNovelTextImport({ imported: { chapters: [{ title: '', content: 'x' }] }, generationJobs: [{ status: 'failed' }] }).ok).toBe(false);
  });

  it('keeps imported indexes continuous after empty entries', () => {
    expect(buildImportedNovelChapters([{ title: '一', content: '' }, { title: '二', content: '正文' }, { title: '三', content: '后文' }], [chapter(4)]).map((item) => item.index)).toEqual([5, 6]);
  });
});
