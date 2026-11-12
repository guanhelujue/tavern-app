import { describe, expect, it, vi } from 'vitest';
import { splitNovelTextIntoChapters } from './novel-import';

vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('@/utils/file-text', () => ({ readTextFileAsync: vi.fn() }));


describe('splitNovelTextIntoChapters', () => {
  it('keeps text before the first chapter heading as a preface', () => {
    expect(splitNovelTextIntoChapters('序言正文\n\n第一章 起点\n甲\n\n第二章 终点\n乙')).toEqual([
      { title: '序言', content: '序言正文' },
      { title: '第一章 起点', content: '甲' },
      { title: '第二章 终点', content: '乙' },
    ]);
  });

  it('does not add an empty preface when the file starts with a heading', () => {
    expect(splitNovelTextIntoChapters('第一章 起点\n甲\n\n第二章 终点\n乙')).toEqual([
      { title: '第一章 起点', content: '甲' },
      { title: '第二章 终点', content: '乙' },
    ]);
  });

  it('keeps the existing single-section behavior', () => {
    expect(splitNovelTextIntoChapters('只有一段正文')).toEqual([
      { title: '正文', content: '只有一段正文' },
    ]);
  });
});
