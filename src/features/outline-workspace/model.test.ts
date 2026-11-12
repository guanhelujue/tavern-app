import { describe, expect, it } from 'vitest';
import type { NovelOutline } from '@/types/tavern';
import { addChapterPlan, outlineDifferences, positiveInteger, reorderChapterPlans, updateChapterPlan, updateVolumePlan, volumeRanges } from './model';

function outline(): NovelOutline {
  return {
    summary: '总纲', updatedAt: '2026-10-28T00:00:00.000Z', volumes: [
      { id: 'v1', title: '校园', summary: '日常', plannedChapterCount: 2, chapters: [
        { index: 1, title: '返校', goal: '点名', characterChange: '适应生死差异' },
        { index: 2, title: '食堂', goal: '排队', foreshadowing: '影子异常' },
      ] },
      { id: 'v2', title: '调查', summary: '追查', plannedChapterCount: 2, chapters: [] },
      { id: 'v3', title: '宿命', summary: '终局', plannedChapterCount: 1, chapters: [{ index: 5, title: '坦白', goal: '陆昭说出真相' }] },
    ],
  };
}

describe('outline workspace editing boundaries', () => {
  it('saves volume metadata without replacing or renumbering chapter plans', () => {
    const source = outline();
    const before = JSON.stringify(source);
    const next = updateVolumePlan(source, 'v1', { id: 'wrong', tone: '轻松搞笑', plannedChapterCount: 15, chapters: [] });
    expect(next.volumes[0].id).toBe('v1');
    expect(next.volumes[0].chapters).toEqual(source.volumes[0].chapters);
    expect(next.volumes.slice(1)).toEqual(source.volumes.slice(1));
    expect(JSON.stringify(source)).toBe(before);
  });

  it('updates one chapter including optional details without touching sibling chapters', () => {
    const source = outline();
    const next = updateChapterPlan(source, 'v1', { ...source.volumes[0].chapters[0], endingHook: '课铃响起' });
    expect(next.volumes[0].chapters[0].endingHook).toBe('课铃响起');
    expect(source.volumes[0].chapters[0].endingHook).toBeUndefined();
    expect(next.volumes[0].chapters[1]).toEqual(source.volumes[0].chapters[1]);
    expect(next.volumes[1]).toEqual(source.volumes[1]);
    expect(() => updateChapterPlan(source, 'v1', { index: 99, title: '', goal: '' })).toThrow('不存在');
  });

  it('reserves planned slots of empty volumes and prevents crossing into other volumes', () => {
    const source = outline();
    expect(volumeRanges(source).map(({ start, end }) => [start, end])).toEqual([[1, 2], [3, 4], [5, 5]]);
    expect(() => addChapterPlan(source, 'v1')).toThrow('其他卷');
    const added = addChapterPlan(source, 'v2');
    expect(added.chapter.index).toBe(3);
    expect(added.outline.volumes[1].chapters).toHaveLength(1);
    expect(added.outline.volumes[2]).toEqual(source.volumes[2]);
    expect(source.volumes[0].chapters).toHaveLength(2);
  });

  it('reorders chapter plans in fixed number slots and preserves other volumes', () => {
    const source = outline();
    const next = reorderChapterPlans(source, 'v1', 0, 1);
    expect(next.volumes[0].chapters.map(({ index, title }) => [index, title])).toEqual([[1, '食堂'], [2, '返校']]);
    expect(next.volumes.slice(1)).toEqual(source.volumes.slice(1));
    expect(source.volumes[0].chapters[0].title).toBe('返校');
  });

  it('includes optional field changes and chapter deletions in the proposal review', () => {
    const source = outline();
    const next = updateVolumePlan(source, 'v1', { tone: '校园喜剧', foreshadowing: '不揭示残魂' });
    next.volumes[0].chapters.pop();
    const changes = outlineDifferences(source, next);
    expect(changes).toContainEqual(expect.objectContaining({ key: 'v1-tone', after: '校园喜剧' }));
    expect(changes).toContainEqual(expect.objectContaining({ key: 'v1-2-foreshadowing', before: '影子异常', after: '' }));
    expect(changes).toContainEqual(expect.objectContaining({ key: 'v1-2-title', before: '食堂', after: '' }));
  });

  it('rejects empty, fractional, negative and out-of-range numeric settings', () => {
    for (const value of ['', '0', '-1', '2.5', 'NaN', '20001']) expect(() => positiveInteger(value, '字数', 20000)).toThrow();
    expect(positiveInteger('15', '章数')).toBe(15);
  });
});
