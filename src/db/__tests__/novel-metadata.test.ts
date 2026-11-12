import { describe, expect, it } from 'vitest';

import { serializeChapterMetadata, serializeNovelMetadata } from '../novel-metadata';

describe('serializeNovelMetadata', () => {
  it('persists the chapter length requirement without embedding its body', () => {
    const stored = JSON.parse(serializeChapterMetadata({ id: 'c1', targetWords: 3000, content: '正文' }));
    expect(stored.targetWords).toBe(3000);
    expect(stored.content).toBeUndefined();
  });
  it('keeps the canonical outline and proposal history in native metadata', () => {
    const outline = {
      summary: '最新卷纲',
      volumes: [{ id: 'volume-1', title: '第一卷', summary: '', chapters: [] }],
      updatedAt: '2026-09-10T00:00:00.000Z',
    };
    const outlineVersions = [{ id: 'version-1', scopeId: 'novel', outline, source: 'manual', createdAt: outline.updatedAt }];
    const outlineProposals = [{
      id: 'proposal-1',
      scopeId: 'novel',
      operation: 'revise',
      prompt: '合并章节',
      baseHash: 'hash',
      patch: { op: 'replace_outline', outline, beforeHash: 'hash' },
      status: 'pending',
      createdAt: outline.updatedAt,
      updatedAt: outline.updatedAt,
    }];

    const serialized = JSON.parse(serializeNovelMetadata({
      id: 'novel-1',
      name: '测试小说',
      createdAt: outline.updatedAt,
      updatedAt: outline.updatedAt,
      outline,
      outlineVersions,
      outlineProposals,
      chapters: [{ id: 'chapter-1', content: '正文不应写进元数据' }],
    }));

    expect(serialized.outline).toEqual(outline);
    expect(serialized.outlineVersions).toEqual(outlineVersions);
    expect(serialized.outlineProposals).toEqual(outlineProposals);
    expect(serialized.chapters).toBeUndefined();
  });
});
