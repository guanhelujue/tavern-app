import { describe, expect, it } from 'vitest';

import { copyNovelBackup } from './novel-backup-copy';

describe('copyNovelBackup', () => {
  it('remaps canonical ids while preserving snapshot references and正文 strings', () => {
    const bundle = {
      version: 5,
      kind: 'novel',
      sessionId: 'novel-1',
      exportedAt: 'now',
      title: 'Book',
      config: { memory: 'memory' },
      messages: [{ id: 'message-1', characterId: 'novel-1', content: 'message-1', role: 'user', status: 'complete' }],
      novel: {
        id: 'novel-1', name: 'Book', chapters: [{ id: 'chapter-1', title: 'chapter-1' }],
        chapterBackups: [{ id: 'backup-1', chapterId: 'chapter-1' }],
        audits: [{ id: 'audit-1', chapterId: 'chapter-1' }],
        novelForecasts: [{ forecastId: 'forecast-1', chapterId: 'chapter-1' }],
        novelContinuationPlans: [{ planId: 'plan-1', forecastId: 'forecast-1' }],
        novelBranches: [{ branchId: 'branch-1', planId: 'plan-1' }],
        novelStorySnapshots: [{ snapshotId: 'snapshot-1', chapterId: 'chapter-1' }],
        novelGenerationJobs: [{ jobId: 'job-1', status: 'running', snapshotId: 'snapshot-1' }],
        novelRewriteAudits: [{ auditId: 'rewrite-audit-1', chapterId: 'chapter-1' }],
      },
      characterBiographies: { hero: [{ id: 'bio-1', characterId: 'hero', content: 'bio-1' }] },
      worldSessions: {
        world: {
          messages: [{ id: 'message-1', characterId: 'novel-1', content: 'message-1', role: 'assistant', status: 'complete' }],
          meta: { id: 'novel-1-conversation', novelId: 'novel-1', title: 'Book', memory: '', longTermMemory: '', midTermMemories: [], shortTermMemories: [] },
          slotBook: {
            activeSlotId: 'slot-1',
            slots: [{ id: 'slot-1', name: 'slot', messages: [{ id: 'message-1', content: 'message-1' }] }],
            previousSnapshot: null,
          },
        },
      },
    } as any;
    const original = JSON.parse(JSON.stringify(bundle));
    const copy = copyNovelBackup(bundle, true) as any;
    expect(copy).not.toBe(bundle);
    expect(bundle).toEqual(original);
    expect(copy.novel.id).not.toBe('novel-1');
    expect(copy.messages[0].id).not.toBe('message-1');
    expect(copy.worldSessions.world.messages[0].id).toBe(copy.messages[0].id);
    expect(copy.worldSessions.world.slotBook.slots[0].messages[0].id).toBe(copy.messages[0].id);
    expect(copy.novel.chapters[0].id).not.toBe('chapter-1');
    expect(copy.novel.chapterBackups[0].chapterId).toBe(copy.novel.chapters[0].id);
    expect(copy.novel.novelContinuationPlans[0].forecastId).toBe(copy.novel.novelForecasts[0].forecastId);
    expect(copy.novel.novelBranches[0].planId).toBe(copy.novel.novelContinuationPlans[0].planId);
    expect(copy.novel.novelStorySnapshots[0].chapterId).toBe(copy.novel.chapters[0].id);
    expect(copy.novel.novelGenerationJobs[0].status).toBe('paused');
    expect(copy.novel.novelRewriteAudits[0].auditId).not.toBe('rewrite-audit-1');
    expect(copy.characterBiographies.hero[0].id).not.toBe('bio-1');
    expect(copy.messages[0].content).toBe('message-1');
    expect(copy.title).toBe('Book');
  });
});
