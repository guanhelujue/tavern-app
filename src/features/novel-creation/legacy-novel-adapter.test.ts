import { describe, expect, it } from 'vitest';

import { buildLegacyNovelInput, buildNovelBlueprintUpdate, readNovelBlueprint } from './legacy-novel-adapter';
import type { Novel } from '@/types/tavern';
import { buildRewriteContext } from '@/services/novel-rewrite-pipeline';
import { buildNovelCharacterContext } from '@/utils/novel-narrative-context';

const promptDefaults = {
  systemPrompt: 'system',
  shortTermMemoryPrompt: 'short',
  midTermMemoryPrompt: 'mid',
  longTermMemoryPrompt: 'long',
};

describe('legacy novel blueprint adapter', () => {
  it('creates a novel from only title and world setting without placeholder prompt sections', () => {
    const input = buildLegacyNovelInput({
      blueprint: {
        id: 'draft', title: '雾港', premise: '',
        protagonist: { identity: '', desire: '', obstacle: '' },
        setting: '潮汐会带走人的记忆。', stakes: '', opening: '', direction: '', tone: '', constraints: [],
        longForm: { engine: '', arcs: [], openThreads: [] },
      },
      promptDefaults,
    });

    expect(input.name).toBe('雾港');
    expect(input.creationMode).toBe('workbench');
    expect(input.worldName).toBe('雾港');
    expect(input.worldEra).toBe('潮汐会带走人的记忆。');
    expect(input.detailedIntro).toBe('潮汐会带走人的记忆。');
    expect(input.foundationPrompt).not.toContain('待定');
    expect(input.foundationPrompt).not.toContain('【开篇状态】');
    expect(input.creationBlueprint?.planning).toEqual({ obstacle: '', stakes: '', engine: '', arcs: [], openThreads: [] });
  });

  it('reads old foundation sections and preserves untouched novel fields on update', () => {
    const novel = {
      id: 'novel-1', name: '作品名', worldName: '旧世界', worldEra: '旧设定',
      shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '', shortTermMemoryPrompt: '',
      midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '', playerPersona: '旧身份', playerMotive: '旧欲望',
      playerGender: '', playerAge: '', playerHeight: '', playerWeight: '', playerAppearance: '', playerPersonality: '',
      playerSpeechStyle: '', playerBackground: '', playerHabits: '', playerStrengths: '', playerWeaknesses: '', playerSecrets: '',
      worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '', statusBar: '',
      autoSuggestRoutes: false, relationGraphEnabled: false, characterCardAppearanceId: 'default', cast: [],
      characterDossiers: [], loreEntries: [], relationGraphs: [], openingMessage: '', defaultModelId: '',
      chatBackgroundOpacity: 0.35, isDraft: false, createStep: 3, foundationPrompt:
        '【失败代价】\n忘记妹妹\n\n【长篇故事引擎】\n潮汐循环\n\n【阶段推进】\n1. 追查\n2. 争夺\n3. 选择\n\n【长期悬念与副线】\n- 妹妹身份\n- 档案馆\n- 主角童年',
      projectBrief: { premise: '旧前提', theme: '', protagonistArc: '保留弧光', ending: '', plannedChapters: 20, firstChapterGoal: '' },
      creationBlueprint: { profile: { structure: 'single_world', entry: 'none', focus: 'mixed', knownPlot: false }, storyCore: { title: '作品名', brief: '', premise: '', theme: '', ending: '', plannedChapters: 20, firstChapterGoal: '', worldName: '', worldEra: '', gameRules: '' }, protagonistCore: { name: '主角', gender: '女', identity: '', goal: '' }, runtimeSeed: { systemName: '系统', globalRules: '', worldSeed: '', mission: '', entryScene: '', originalPlot: { premise: '', knownToProtagonist: '', originalEnding: '' } }, foundationPrompt: 'old' },
    } as unknown as Novel;
    const read = readNovelBlueprint(novel);
    expect(read.title).toBe('旧世界');
    expect(read.setting).toBe('旧设定');
    expect(read.stakes).toBe('忘记妹妹');
    expect(read.longForm.engine).toBe('潮汐循环');
    expect(read.longForm.arcs).toEqual(['追查', '争夺', '选择']);
    expect(read.longForm.openThreads).toEqual(['妹妹身份', '档案馆', '主角童年']);

    const update = buildNovelBlueprintUpdate(novel, { ...read, title: '新世界', setting: '新设定' });
    expect(update.worldName).toBe('新世界');
    expect(update.worldEra).toBe('新设定');
    expect(update.name).toBeUndefined();
    expect(update.creationBlueprint && 'runtimeSeed' in update.creationBlueprint && update.creationBlueprint.runtimeSeed?.systemName).toBe('系统');
    expect(update.projectBrief && 'protagonistArc' in update.projectBrief && update.projectBrief.protagonistArc).toBe('保留弧光');

    const cleared = { ...read, premise: '' };
    const clearedUpdate = buildNovelBlueprintUpdate(novel, cleared);
    expect(readNovelBlueprint({ ...novel, ...clearedUpdate } as Novel).premise).toBe('');

    const pastedNovel = { ...novel, foundationPrompt: `${novel.foundationPrompt}\n\n【自定义事实】\n铜钥匙不能复制`.replace(/\n/g, '\r\n') };
    const pasted = readNovelBlueprint(pastedNovel);
    expect(pasted.longForm.engine).toBe('潮汐循环');
    expect(buildNovelBlueprintUpdate(pastedNovel, pasted).foundationPrompt).toContain('铜钥匙不能复制');
  });

  it('keeps world-only creation context available to chapter writing after blueprint edits', () => {
    const input = buildLegacyNovelInput({
      blueprint: {
        id: 'world-only', title: '雾港', premise: '',
        protagonist: { identity: '', desire: '', obstacle: '' },
        setting: '旧世界规则：潮汐会带走人的记忆。', stakes: '', opening: '', direction: '', tone: '', constraints: [],
        longForm: { engine: '', arcs: [], openThreads: [] },
      },
      promptDefaults,
    });
    const novel = { ...input, id: 'novel-world-only', createdAt: '', updatedAt: '' } as unknown as Novel;
    const contextInput = (current: Novel) => ({
      novelName: current.name,
      characterContext: buildNovelCharacterContext(current, '第一章'),
      analysis: null,
      plan: null,
      forecast: null,
      lastChapter: null,
      recentChapters: [],
      userGuide: { endingPreference: '', targetLength: '', mustKeep: '', mustAvoid: '' },
      targetWords: 800,
      maxContextChars: 20_000,
    });

    const first = buildRewriteContext(contextInput(novel));
    expect(first.systemPrompt).toContain('旧世界规则：潮汐会带走人的记忆。');

    const edited = readNovelBlueprint(novel);
    edited.setting = '新世界规则：城市由会呼吸的档案构成。';
    edited.longForm.engine = '档案每夜重写一段历史，保存真相会改变现实。';
    const updated = { ...novel, ...buildNovelBlueprintUpdate(novel, edited) } as Novel;
    const second = buildRewriteContext(contextInput(updated));
    expect(second.systemPrompt).toContain('新世界规则：城市由会呼吸的档案构成。');
    expect(second.systemPrompt).toContain('档案每夜重写一段历史，保存真相会改变现实。');
  });

  it('carries current outline volume and chapter constraints into the normal rewrite prompt', () => {
    const input = buildLegacyNovelInput({
      blueprint: {
        id: 'outline-context', title: '双线', premise: '双世界线',
        protagonist: { identity: '高中生', desire: '查明陆昭的死因', obstacle: '' },
        setting: '校园', stakes: '', opening: '', direction: '', tone: '', constraints: [],
        longForm: { engine: '', arcs: [], openThreads: [] },
      },
      promptDefaults,
    });
    const novel = {
      ...input,
      id: 'outline-context',
      outline: { summary: '双世界线', updatedAt: '2026-01-01', volumes: [{
        id: 'v1', title: '返校卷', summary: '轻松日常', tone: '前十五章保持轻松吐槽',
        foreshadowing: '只露出残魂异常，不揭示鬼王身份', handoff: { outgoing: '女主即将介入调查' },
        chapters: [{ index: 3, title: '带着鬼去上课', goal: '陆昭旁听高中课堂',
          characterChange: '沈砚开始依赖陆昭', foreshadowing: '黑板上的名字与鬼王有关', endingHook: '陆昭看见自己的死亡通知' }],
      }] },
    } as Novel;
    const prompt = buildRewriteContext({
      novelName: novel.name,
      characterContext: buildNovelCharacterContext(novel, '第3章\n带着鬼去上课'),
      analysis: null, plan: null, forecast: null, lastChapter: null, recentChapters: [], targetWords: 800,
      userGuide: { endingPreference: '', targetLength: '', mustKeep: '', mustAvoid: '' },
    }).systemPrompt;
    expect(prompt).toContain('前十五章保持轻松吐槽');
    expect(prompt).toContain('只露出残魂异常，不揭示鬼王身份');
    expect(prompt).toContain('女主即将介入调查');
    expect(prompt).toContain('沈砚开始依赖陆昭');
    expect(prompt).toContain('黑板上的名字与鬼王有关');
    expect(prompt).toContain('陆昭看见自己的死亡通知');
    expect(buildNovelCharacterContext(novel, '第99章')).not.toContain('前十五章保持轻松吐槽');
  });
});
