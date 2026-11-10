import { describe, expect, it, vi } from 'vitest';

import { createNovelCreation, type CreationDraftPort } from './creation';
import { createEmptyBlueprint, createEmptyCreationSession, normalizeCreationSession, type CreationSession, type StoryBlueprint } from './domain';

const proposal: StoryBlueprint = {
  id: 'idea-1',
  title: '潮汐失语症',
  premise: '每次退潮，全城都会忘记一个人。',
  protagonist: { identity: '港口档案员', desire: '保住妹妹存在过的证据', obstacle: '妹妹正从所有记录中消失' },
  setting: '记忆会随潮汐退去的海港城。',
  stakes: '失败后连主角也会忘记妹妹。',
  opening: '主角发现妹妹的户籍在自己眼前褪成白纸。',
  direction: '追查潮汐规则的来源。',
  tone: '潮湿、克制',
  constraints: ['不用万能系统'],
  longForm: {
    engine: '潮汐每次抹除不同群体的共同记忆，主角保存证据的行为又会改变权力与亲密关系。',
    arcs: ['保存妹妹的存在并发现规则', '争夺城市档案权并付出关系代价', '决定谁有权定义全城记忆'],
    openThreads: ['妹妹为何最先消失', '档案馆隐藏的旧潮汐记录', '主角自身被篡改的童年'],
  },
};

function memoryDrafts(initial: CreationSession | null = null) {
  let saved = initial;
  const port: CreationDraftPort = {
    async load() { return saved; },
    async save(session) { saved = session; },
    async clear() { saved = null; },
  };
  return { port, current: () => saved };
}

describe('NovelCreation interface', () => {
  it('moves from a seed through proposal selection to an atomic commit', async () => {
    const drafts = memoryDrafts();
    const commitNovel = vi.fn(() => 'novel-1');
    const creation = createNovelCreation({
      drafts: drafts.port,
      generateBlueprints: vi.fn(async () => [proposal]),
      commitNovel,
    });

    let session = await creation.open();
    session = await creation.transition(session, { type: 'edit-seed', seed: '海港与失忆' });
    session = await creation.transition(session, { type: 'generate-ideas' });
    expect(session.step).toBe('ideas');
    expect(drafts.current()?.seed).toBe('海港与失忆');

    session = await creation.transition(session, { type: 'choose-idea', id: proposal.id });
    session = await creation.transition(session, { type: 'edit-blueprint', patch: { title: '退潮以后' } });
    expect(session.blueprint?.title).toBe('退潮以后');

    await expect(creation.commit(session)).resolves.toBe('novel-1');
    expect(commitNovel).toHaveBeenCalledWith(expect.objectContaining({ title: '退潮以后' }));
    expect(drafts.current()).toBeNull();
  });

  it('keeps the editable draft when generation fails', async () => {
    const drafts = memoryDrafts(createEmptyCreationSession());
    const creation = createNovelCreation({
      drafts: drafts.port,
      generateBlueprints: async () => { throw new Error('模型不可用'); },
      commitNovel: () => 'never',
    });

    const opened = await creation.open();
    const session = await creation.transition(opened, { type: 'generate-ideas' });
    expect(session.step).toBe('seed');
    expect(session.error).toBe('模型不可用');
    expect(drafts.current()?.error).toBe('模型不可用');
  });

  it('refuses to commit an incomplete blueprint', async () => {
    const drafts = memoryDrafts();
    const creation = createNovelCreation({
      drafts: drafts.port,
      generateBlueprints: async () => [],
      commitNovel: () => 'never',
    });
    let session = await creation.open();
    session = await creation.transition(session, { type: 'start-blank' });
    await expect(creation.commit(session)).rejects.toThrow('世界名称');
  });

  it('creates from only a world name and content without generating ideas', async () => {
    const drafts = memoryDrafts();
    const generateBlueprints = vi.fn(async () => []);
    const commitNovel = vi.fn(() => 'world-only');
    const creation = createNovelCreation({ drafts: drafts.port, generateBlueprints, commitNovel });
    let session = await creation.transition(await creation.open(), { type: 'resume-blueprint' });
    session = await creation.transition(session, {
      type: 'edit-blueprint', patch: { title: '雾港', setting: '潮汐会带走人们的记忆。' },
    });
    await expect(creation.commit(session)).resolves.toBe('world-only');
    expect(generateBlueprints).not.toHaveBeenCalled();
    expect(commitNovel).toHaveBeenCalledWith(expect.objectContaining({
      title: '雾港', premise: '', opening: '', longForm: { engine: '', arcs: [], openThreads: [] },
    }));
  });

  it('requires actual world content and preserves the draft when missing', async () => {
    const drafts = memoryDrafts();
    const commitNovel = vi.fn(() => 'never');
    const creation = createNovelCreation({ drafts: drafts.port, generateBlueprints: async () => [], commitNovel });
    let session = await creation.transition(await creation.open(), { type: 'resume-blueprint' });
    session = await creation.transition(session, { type: 'edit-blueprint', patch: { title: '雾港', setting: '  ' } });
    await expect(creation.commit(session)).rejects.toThrow('世界内容');
    expect(commitNovel).not.toHaveBeenCalled();
    expect(drafts.current()?.blueprint?.title).toBe('雾港');
  });

  it('keeps existing planning details when visiting optional ideas and returning', async () => {
    const drafts = memoryDrafts({ ...createEmptyCreationSession(), step: 'blueprint', blueprint: proposal });
    const creation = createNovelCreation({ drafts: drafts.port, generateBlueprints: async () => [proposal], commitNovel: () => 'unused' });
    let session = await creation.transition(await creation.open(), { type: 'back-to-seed' });
    session = await creation.transition(session, { type: 'generate-ideas' });
    session = await creation.transition(session, { type: 'resume-blueprint' });
    expect(session.blueprint).toEqual(proposal);
    expect((await creation.open()).blueprint).toEqual(proposal);
  });

  it('restores a seed-only draft into world content without inventing planning fields', async () => {
    const drafts = memoryDrafts({ ...createEmptyCreationSession(), seed: '记忆随潮汐退去的海港' });
    const creation = createNovelCreation({ drafts: drafts.port, generateBlueprints: async () => [], commitNovel: () => 'unused' });
    const session = await creation.transition(await creation.open(), { type: 'resume-blueprint' });
    expect(session.blueprint).toMatchObject({ ...createEmptyBlueprint(), id: session.blueprint?.id, setting: '记忆随潮汐退去的海港' });
  });

  it('does not report a failed creation after the novel exists but draft cleanup fails', async () => {
    const drafts = memoryDrafts();
    drafts.port.clear = async () => { throw new Error('storage unavailable'); };
    const creation = createNovelCreation({
      drafts: drafts.port,
      generateBlueprints: async () => [proposal],
      commitNovel: () => 'novel-created',
    });
    let session = await creation.open();
    session = await creation.transition(session, { type: 'start-blank' });
    session = await creation.transition(session, { type: 'edit-blueprint', patch: proposal });
    await expect(creation.commit(session)).resolves.toBe('novel-created');
  });

  it('opens an early V2 draft without long-form fields as an editable incomplete blueprint', () => {
    const legacyBlueprint = { ...proposal } as Record<string, unknown>;
    delete legacyBlueprint.longForm;
    const normalized = normalizeCreationSession({
      version: 1,
      id: 'creation-old',
      seed: '',
      step: 'blueprint',
      proposals: [],
      blueprint: legacyBlueprint,
      updatedAt: '2026-09-19T00:00:00.000Z',
    });
    expect(normalized?.blueprint?.longForm).toEqual({ engine: '', arcs: [], openThreads: [] });
  });

  it('returns stale pre-long-form idea cards to the seed step', () => {
    const legacyProposal = { ...proposal } as Record<string, unknown>;
    delete legacyProposal.longForm;
    const normalized = normalizeCreationSession({
      version: 1,
      id: 'creation-old-ideas',
      seed: '海港与失忆',
      step: 'ideas',
      proposals: [legacyProposal],
      updatedAt: '2026-09-19T00:00:00.000Z',
    });
    expect(normalized?.step).toBe('seed');
    expect(normalized?.proposals).toEqual([]);
    expect(normalized?.error).toContain('重新生成');
  });
});
