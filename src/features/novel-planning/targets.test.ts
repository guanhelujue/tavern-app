import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePlanningTarget } from './targets';

let state: any;

vi.mock('@/store/tavern-store', () => ({
  useTavernStore: { getState: () => state },
}));

function novel(id = 'novel-1'): any {
  return {
    id,
    name: '测试小说',
    shortIntro: '短简介', detailedIntro: '长简介',
    worldName: '旧世界', worldEra: '旧时代', gameRules: '旧规则',
    loreEntries: [], loreCollections: [], outline: undefined,
    playerPersona: '', cast: [], characterDossiers: [],
    quickTravel: undefined,
  };
}

function install(...novels: any[]) {
  state = {
    novels,
    updateNovel: (novelId: string, input: any) => {
      state.novels = state.novels.map((item: any) => item.id === novelId ? { ...item, ...input } : item);
    },
    updateNovelLoreEntries: (novelId: string, entries: any[]) => {
      state.novels = state.novels.map((item: any) => item.id === novelId ? { ...item, loreEntries: entries } : item);
    },
    saveNovelOutlineAtScope: (novelId: string, scopeId: string, outline: any) => {
      state.novels = state.novels.map((item: any) => item.id === novelId
        ? (scopeId === 'novel' ? { ...item, outline } : { ...item, quickTravel: { ...item.quickTravel, worlds: item.quickTravel.worlds.map((world: any) => world.id === scopeId ? { ...world, outline } : world) } })
        : item);
    },
  };
}

describe('planning targets', () => {
  beforeEach(() => install(novel()));

  it('applies exact main-world strings while preserving unrelated metadata', async () => {
    const target = resolvePlanningTarget({ kind: 'world', novelId: 'novel-1' });
    await target.apply({ worldName: '', worldEra: '新纪元', gameRules: '' });
    expect(state.novels[0]).toMatchObject({ worldName: '', worldEra: '新纪元', gameRules: '' });
    expect(state.novels[0].detailedIntro).toBe('长简介');
  });

  it('refuses a stale target baseline', async () => {
    const target = resolvePlanningTarget({ kind: 'world', novelId: 'novel-1' });
    state.novels[0].worldEra = '外部修改';
    await expect(target.apply({ worldName: '新', worldEra: '新', gameRules: '新' })).rejects.toThrow('已发生变化');
  });

  it('refuses a deleted world instead of falling back to the novel root', () => {
    const current = novel();
    current.quickTravel = { config: {}, worlds: [{ id: 'world-1', name: '小世界', worldEra: '', worldRules: '', protagonistIdentity: '', entryScene: '', mission: '', cast: [], characterDossiers: [], loreEntries: [], originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' }, runtime: {}, status: 'active', createdAt: '', updatedAt: '' }], settlements: [] };
    install(current);
    const target = resolvePlanningTarget({ kind: 'world', novelId: current.id, worldId: 'world-1' });
    state.novels[0].quickTravel.worlds = [];
    expect(target.apply({ name: 'x', generationBrief: '', worldEra: '', worldRules: '', protagonistIdentity: '', entryScene: '', mission: '', premise: '', knownToProtagonist: '', originalEnding: '' })).rejects.toThrow('已被删除');
  });

  it('keeps volume chapters and other volumes and isolates scopes by novel', async () => {
    const makeOutline = () => ({ summary: '书', updatedAt: '', volumes: [{ id: 'v-1', title: '一', summary: '旧', chapters: [{ index: 1, title: '章', goal: '目标' }], handoff: { outgoing: '交接' } }, { id: 'v-2', title: '二', summary: '保留', chapters: [] }] });
    const first = novel('novel-1'); first.outline = makeOutline();
    const second = novel('novel-2'); second.outline = makeOutline();
    install(first, second);
    const target = resolvePlanningTarget({ kind: 'volume', novelId: first.id, volumeId: 'v-1' });
    expect(target.scope.id).not.toBe(resolvePlanningTarget({ kind: 'volume', novelId: second.id, volumeId: 'v-1' }).scope.id);
    await target.apply({ title: '新一', summary: '新概述', incomingHandoff: '新交接' });
    expect(state.novels[0].outline.volumes[0]).toMatchObject({ title: '新一', summary: '新概述', chapters: [{ index: 1 }] });
    expect(state.novels[0].outline.volumes[1].summary).toBe('保留');
  });

  it('makes repeated new-lore apply idempotent and separate drafts by draftId', async () => {
    const target = resolvePlanningTarget({ kind: 'lore', novelId: 'novel-1', collectionId: 'atlas-lore', draftId: 'draft-a' });
    const content = { name: '星门', aliases: '门\n入口', content: '通往北境' };
    await target.apply(content);
    await target.apply(content);
    expect(state.novels[0].loreEntries).toHaveLength(1);
    const next = resolvePlanningTarget({ kind: 'lore', novelId: 'novel-1', collectionId: 'atlas-lore', draftId: 'draft-b' });
    await next.apply({ name: '月井', aliases: '', content: '井' });
    expect(state.novels[0].loreEntries.map((item: any) => item.name)).toEqual(['星门', '月井']);
  });
});
