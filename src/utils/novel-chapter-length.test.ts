import { describe, expect, it } from 'vitest';
import { checkChapterLength, countChapterWords, resolveChapterTargetWords } from './novel-chapter-length';

describe('chapter length acceptance', () => {
  it('accepts 2800 for a 3000 target but rejects 1500 and excludes whitespace', () => {
    expect(checkChapterLength('字'.repeat(2800), 3000).passed).toBe(true);
    expect(checkChapterLength('字'.repeat(1500) + ' \n'.repeat(1500), 3000)).toMatchObject({ passed: false, actualWords: 1500, minimumWords: 2700 });
    expect(countChapterWords('你好，\n world！ ')).toBe(9);
  });
  it('uses an explicit chapter target, then the chapter instruction, then the book default', () => {
    expect(resolveChapterTargetWords(4000, '请写3000字', 1800)).toBe(4000);
    expect(resolveChapterTargetWords(undefined, '请写 3,000 字', 1800)).toBe(3000);
    expect(resolveChapterTargetWords(undefined, '写3千字', 1800)).toBe(3000);
    expect(resolveChapterTargetWords(undefined, '场景发生在3000年', 1800)).toBe(1800);
  });
});
