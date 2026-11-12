import { describe, expect, it } from 'vitest';

import { parseNovelOutlineChapterRevision } from './novel-outline-chapter-revision';

const target = { index: 8, title: '旧码头', goal: '主角在码头与线人接头。', sceneEnd: true };

describe('single chapter outline revision', () => {
  it('ignores a model-provided index and locks the patch to the selected chapter', () => {
    expect(parseNovelOutlineChapterRevision({
      index: 99,
      title: '雨幕中的假线人',
      goal: '主角识破假线人，并从其口误中取得下一站线索。',
      sceneEnd: false,
    }, target)).toEqual({
      index: 8,
      title: '雨幕中的假线人',
      goal: '主角识破假线人，并从其口误中取得下一站线索。',
      sceneEnd: false,
    });
  });

  it('rejects incomplete chapter payloads', () => {
    expect(() => parseNovelOutlineChapterRevision({ title: '只有标题' }, target)).toThrow('缺少标题或章节目标');
  });

  it('keeps optional author planning fields and preserves them when the model omits them', () => {
    const enriched = { ...target, characterChange: '主角开始信任线人', foreshadowing: '旧钟停在三点', endingHook: '门外传来第二次敲门' };
    expect(parseNovelOutlineChapterRevision({ title: '修订章', goal: '推进调查' }, enriched)).toEqual({
      index: 8,
      title: '修订章',
      goal: '推进调查',
      sceneEnd: true,
      characterChange: '主角开始信任线人',
      foreshadowing: '旧钟停在三点',
      endingHook: '门外传来第二次敲门',
    });
  });

  it('clears an optional planning field when the model explicitly returns an empty string', () => {
    const enriched = { ...target, characterChange: '主角开始信任线人', foreshadowing: '旧钟停在三点', endingHook: '门外传来第二次敲门' };
    expect(parseNovelOutlineChapterRevision({
      title: '清除伏笔', goal: '收束本章', foreshadowing: '',
    }, enriched)).toEqual({
      index: 8, title: '清除伏笔', goal: '收束本章', sceneEnd: true,
      characterChange: '主角开始信任线人', endingHook: '门外传来第二次敲门',
    });
  });
});
