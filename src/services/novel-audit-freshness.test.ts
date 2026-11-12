import { describe, expect, it } from 'vitest';
import { getNovelAuditSourceFingerprint, isNovelRewriteAuditCurrent } from './novel-audit-freshness';

const makeNovel = () => ({
  id: 'novel-1', chapters: [
    { id: 'chapter-1', index: 1, title: '一', summary: '前情', content: '前文', status: 'final' },
    { id: 'chapter-2', index: 2, title: '二', summary: '当前摘要', goal: '当前目标', content: '当前正文', status: 'draft' },
    { id: 'chapter-3', index: 3, title: '三', summary: '后文', content: '后文', status: 'draft' },
  ],
  cast: [{ id: 'cast-1', name: '角色', biography: '原设定', updatedAt: 'old', stateVersion: 1, stale: false }],
  characterDossiers: [], loreEntries: [], outline: { volumes: [] }, continuationSettings: { autoAudit: true },
  worldName: '世界', worldEra: '现代', worldConflict: '冲突', worldTone: '阴郁',
  foundationPrompt: '基础', projectBrief: { premise: '前提' }, systemPrompt: '系统', writingStyle: '文风',
  gameRules: '规则', mainPlot: '主线', initialStoryState: '初始',
} as any);

describe('novel audit freshness', () => {
  it('invalidates current, character, world, and previous-chapter changes', () => {
    const novel = makeNovel();
    const chapter = novel.chapters[1];
    const fingerprint = getNovelAuditSourceFingerprint(novel, chapter);
    const audit = { chapterId: chapter.id, sourceFingerprint: fingerprint, stale: false };
    expect(isNovelRewriteAuditCurrent(audit, chapter.id, fingerprint)).toBe(true);
    for (const changed of [
      { chapters: novel.chapters.map((item: any) => item.id === chapter.id ? { ...item, content: '新正文' } : item) },
      { cast: [{ ...novel.cast[0], biography: '新设定' }] },
      { worldConflict: '新冲突' },
      { chapters: novel.chapters.map((item: any) => item.index === 1 ? { ...item, content: '前文变更' } : item) },
      { chapters: novel.chapters.map((item: any) => item.id === chapter.id ? { ...item, goal: '新目标' } : item) },
    ]) {
      const changedNovel = { ...novel, ...changed };
      const changedChapter = changedNovel.chapters.find((item: any) => item.id === chapter.id);
      expect(getNovelAuditSourceFingerprint(changedNovel, changedChapter)).not.toBe(fingerprint);
    }
  });

  it('ignores later chapters and derived metadata changes', () => {
    const novel = makeNovel();
    const chapter = novel.chapters[1];
    const fingerprint = getNovelAuditSourceFingerprint(novel, chapter);
    const laterChanged = { ...novel, chapters: novel.chapters.map((item: any) => item.index === 3 ? { ...item, content: '后文变更' } : item) };
    expect(getNovelAuditSourceFingerprint(laterChanged, chapter)).toBe(fingerprint);
    const metadataChanged = { ...novel, cast: [{ ...novel.cast[0], updatedAt: 'new', stateVersion: 999, stale: true }] };
    expect(getNovelAuditSourceFingerprint(metadataChanged, chapter)).toBe(fingerprint);
  });

  it('rejects legacy and explicitly stale reports', () => {
    const novel = makeNovel();
    const chapter = novel.chapters[1];
    const fingerprint = getNovelAuditSourceFingerprint(novel, chapter);
    expect(isNovelRewriteAuditCurrent({ chapterId: chapter.id }, chapter.id, fingerprint)).toBe(false);
    expect(isNovelRewriteAuditCurrent({ chapterId: chapter.id, sourceFingerprint: fingerprint, stale: true }, chapter.id, fingerprint)).toBe(false);
  });
});
