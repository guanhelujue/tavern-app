import { describe, expect, it } from 'vitest';

import { serializeChapterMetadata } from '@/db/novel-metadata';
import { readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';
import { syncForeshadowings } from '@/services/novel-continuation-pipeline';
import { auditRewriteChapter, reviseRewriteChapter } from '@/services/novel-rewrite-pipeline';
import { buildChapterInstruction, hasChapterPlanning, normalizeChapterPlanning } from '@/utils/novel-chapter-planning';
import { buildLegacyVolumeSeeds, mergeLegacyStoryIntoSummary } from '@/utils/novel-outline-seeds';
import { formatNovelForeshadowingContext, importLegacyForeshadowings } from '@/utils/novel-foreshadowing-workspace';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';
import type { Novel, NovelForeshadowing } from '@/types/tavern';

const blueprint = {
  id: 'blueprint-1', title: '雾港', premise: '潮汐会带走记忆',
  protagonist: { identity: '旧身份', desire: '旧目标', obstacle: '无法相信任何人' },
  setting: '雾港的潮汐规则', stakes: '失败会失去妹妹', opening: '从失踪案开始', direction: '查清潮汐真相', tone: '克制悬疑', constraints: ['不写系统升级'],
  longForm: { engine: '每次选择都会改变潮汐', arcs: ['追查档案', '进入深海'], openThreads: ['妹妹身份', '档案馆秘密'] },
};

function novel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'novel-1', name: '雾港', worldName: '雾港', worldEra: '潮汐规则',
    playerName: '玩家', playerPersona: '旧身份', playerMotive: '旧目标', playerProfession: '', playerAge: '', playerGender: '', playerHeight: '', playerWeight: '', playerAppearance: '', playerPersonality: '', playerSpeechStyle: '', playerBackground: '', playerHabits: '', playerStrengths: '', playerWeaknesses: '', playerSecrets: '', playerPrivacy: [], gameRules: '不写系统升级',
    writingStyle: '第三人称，克制', cast: [], foundationPrompt: '',
    creationBlueprint: { planning: blueprint.longForm, storyCore: { premise: blueprint.premise, theme: blueprint.tone, ending: blueprint.direction } },
    projectBrief: { premise: blueprint.premise, theme: blueprint.tone, ending: blueprint.direction, firstChapterGoal: blueprint.opening },
    foreshadowings: [], ...overrides,
  } as unknown as Novel;
}

describe('novel planning workspace contracts', () => {
  it('deduplicates legacy volume seeds and keeps existing volumes', () => {
    const existing = { id: 'v-existing', title: '第一卷', summary: '追查档案', chapters: [] };
    const duplicateBlueprint = { ...blueprint, longForm: { ...blueprint.longForm, arcs: ['追查档案', '进入深海', '进入深海'] } };
    const seeds = buildLegacyVolumeSeeds({ summary: '', volumes: [existing], updatedAt: '2026-01-01' }, duplicateBlueprint, 'novel-1');
    expect(seeds).toHaveLength(1);
    expect(seeds[0].summary).toBe('进入深海');
    expect(seeds[0].title).toBe('阶段 2');
    const editedImported = { ...seeds[0], summary: '人工修改后的阶段', chapters: [] };
    const repeated = buildLegacyVolumeSeeds({ summary: '', volumes: [existing, editedImported], updatedAt: '2026-01-01' }, duplicateBlueprint, 'novel-1');
    expect(repeated).toHaveLength(0);
  });

  it('merges old story material without replacing a current summary', () => {
    const merged = mergeLegacyStoryIntoSummary('当前主线：调查潮汐', blueprint);
    expect(merged).toContain('当前主线：调查潮汐');
    expect(merged).toContain('故事前提');
    expect(mergeLegacyStoryIntoSummary(merged, blueprint)).toBe(merged);
  });

  it('imports legacy threads once and preserves the old blueprint', () => {
    const source = novel();
    const imported = importLegacyForeshadowings(source);
    expect(imported).toHaveLength(2);
    expect(importLegacyForeshadowings({ ...source, foreshadowings: imported } as Novel)).toEqual(imported);
    expect(readNovelBlueprint(source).longForm.openThreads).toEqual(blueprint.longForm.openThreads);
  });

  it('distinguishes planned, fulfilled and abandoned hooks in context', () => {
    const items: NovelForeshadowing[] = [
      { id: 'a', keyword: '钟声', description: '待埋设', status: 'open', plantedChapterIndex: 0, createdAt: '2026-01-01', note: '' },
      { id: 'b', keyword: '钥匙', description: '已回收', status: 'fulfilled', plantedChapterIndex: 2, fulfilledChapterIndex: 5, createdAt: '2026-01-01', note: '' },
      { id: 'c', keyword: '旧名册', description: '不要重提', status: 'dropped', plantedChapterIndex: 0, createdAt: '2026-01-01', note: '' },
    ];
    const context = formatNovelForeshadowingContext(novel({ foreshadowings: items }));
    expect(context).toContain('待埋设');
    expect(context).toContain('已回收（第5章）');
    expect(context).toContain('已放弃（不要重新引入）');
  });

  it('does not let locked or resolved hooks get rewritten by audit sync', () => {
    const locked: NovelForeshadowing = { id: 'a', keyword: '钟声', description: '作者描述', status: 'open', plantedChapterIndex: 0, createdAt: '2026-01-01', note: '', locked: true };
    const fulfilled: NovelForeshadowing = { id: 'b', keyword: '钥匙', description: '已回收', status: 'fulfilled', plantedChapterIndex: 1, fulfilledChapterIndex: 3, createdAt: '2026-01-01', note: '' };
    const next = syncForeshadowings([locked, fulfilled], [
      { keyword: '钟声', description: 'AI改写', planted: true },
      { keyword: '钥匙', description: 'AI重新埋设', planted: true },
    ], 8);
    expect(next).toEqual([locked, fulfilled]);
  });

  it('serializes planning metadata without chapter body', () => {
    const serialized = JSON.parse(serializeChapterMetadata({ id: 'c', index: 1, title: '第一章', goal: '调查', planning: { conflict: '冲突', keyEvents: '', participants: '', scene: '' }, content: '正文' }));
    expect(serialized.planning.conflict).toBe('冲突');
    expect(serialized.content).toBeUndefined();
  });

  it('normalizes optional planning and compiles it after the raw prompt', () => {
    const planning = normalizeChapterPlanning({ conflict: '门禁冲突', keyEvents: 123 });
    expect(planning).toEqual({ conflict: '门禁冲突', keyEvents: '', participants: '', scene: '' });
    expect(hasChapterPlanning(planning)).toBe(true);
    const instruction = buildChapterInstruction('继续调查', planning);
    expect(instruction).toContain('继续调查');
    expect(instruction).toContain('本章冲突：门禁冲突');
    expect(instruction).not.toContain('undefined');
  });

  it('uses the current protagonist card when reading a legacy blueprint', () => {
    const current = novel({ cast: [{ id: 'p', name: '主角', isProtagonist: true, profession: '现任身份', motive: '现任目标' }] });
    const read = readNovelBlueprint(current);
    expect(read.protagonist).toMatchObject({ identity: '现任身份', desire: '现任目标' });
  });

  it('includes manual foreshadowings and writing style in writer context', () => {
    const context = buildNovelCharacterContext(novel({ foreshadowings: [{ id: 'f', keyword: '钟声', description: '只在雨夜响起', status: 'open', plantedChapterIndex: 0, createdAt: '2026-01-01', note: '' }] }), '第1章');
    expect(context).toContain('作者指定写作风格');
    expect(context).toContain('钟声');
    expect(context).toContain('待埋设');
  });

  it('passes chapter planning into audit and revision prompts while retaining the raw body', async () => {
    const calls: string[] = [];
    const completion = async (messages: { content: string }[]) => {
      calls.push(messages.map((message) => message.content).join('\n'));
      return { content: JSON.stringify({ score: 80, issues: [{ severity: 'warning', category: 'plot', description: '需要调整', evidence: '证据', suggestion: '调整', repairScope: 'local' }] }), promptTokens: 1, completionTokens: 1 };
    };
    const chapter = { id: 'c', index: 1, title: '第一章', goal: '调查旧港', content: '原章节正文', planning: { conflict: '门禁冲突', keyEvents: '发现钥匙', participants: '主角', scene: '旧港' }, status: 'draft', summary: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as never;
    await auditRewriteChapter({ novelName: '雾港', chapter, analysis: null, plan: null, forecast: null, recentChapters: [], userGuide: { endingPreference: '', targetLength: '', mustKeep: '', mustAvoid: '' }, completion: completion as never });
    await reviseRewriteChapter({ novelName: '雾港', chapter, audit: { issues: [{ id: 'i', severity: 'warning', category: 'plot', description: '需要调整', evidence: '证据', suggestion: '调整', repairScope: 'local' }], score: 80, passed: false } as never, completion: (async (messages: { content: string }[]) => { calls.push(messages.map((message) => message.content).join('\n')); return { content: '修订正文', promptTokens: 1, completionTokens: 1 }; }) as never });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('本章冲突：门禁冲突');
    expect(calls[1]).toContain('关键事件：发现钥匙');
    expect(calls[1]).toContain('原章节正文');
  });
});
