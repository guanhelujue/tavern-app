import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLegacyNovelInput } from '@/features/novel-creation/legacy-novel-adapter';
import {
  getStoryImportEntries,
  storyImportFingerprint,
  type StoryImportCandidate,
} from '@/features/story-import/model';
import { DEFAULT_NOVEL_CONTINUATION_SETTINGS } from '@/constants/novel-continuation';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined) } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default }, AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, InteractionManager: { runAfterInteractions: (task: () => void) => task() }, NativeModules: {}, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() }, Dimensions: { get: vi.fn(() => ({ width: 1200, height: 800 })) }, StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => false), shareAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { UTF8: 'utf8' }, cacheDirectory: null, documentDirectory: null }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn(), MediaTypeOptions: {} }));
vi.mock('expo-media-library', () => ({ Asset: {}, requestPermissionsAsync: vi.fn() }));
vi.mock('@/db/migration-coordinator', () => ({ runMigrationCoordinator: vi.fn(async () => ({ status: 'web-fallback' })) }));
vi.mock('expo-sqlite', () => ({ openDatabaseSync: vi.fn(), openDatabaseAsync: vi.fn() }));

function makeNovel(): any {
  return {
    ...buildLegacyNovelInput({
      blueprint: { id: 'import', title: '导入测试', premise: '', setting: '', protagonist: { identity: '', desire: '', obstacle: '' }, stakes: '', opening: '', direction: '', tone: '', constraints: [], longForm: { engine: '', arcs: [], openThreads: [] } },
      promptDefaults: { systemPrompt: '系统底座', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '' },
    }),
    id: 'story-import-test', name: '导入测试', createdAt: '', updatedAt: '', systemPrompt: '作者系统提示', writingStyle: '', chapters: [],
    cast: [{ id: 'old-card', name: '旧人物', aliases: ['旧称'], profession: '', age: '', gender: '', height: '', weight: '', appearance: '作者外貌', personality: '', speechStyle: '', background: '作者背景' }],
    characterDossiers: [{ id: 'old-dossier', castId: 'old-card', name: '旧人物', aliases: ['作者别名'], content: '作者档案', experience: '作者小传', experienceDraft: '', enabled: true, updatedAt: '' }],
    loreEntries: [], foreshadowings: [], outline: { summary: '旧主线', updatedAt: '', volumes: [{ id: 'old-volume', title: '旧卷', summary: '旧梗概', chapters: [{ index: 1, title: '旧章', goal: '旧目标' }] }] },
    continuationSettings: { ...DEFAULT_NOVEL_CONTINUATION_SETTINGS }, novelGenerationJobs: [], outlineVersions: [],
  };
}

function candidate(): StoryImportCandidate {
  return {
    summary: { content: '新主线', evidence: '新主线' },
    volumes: [{ title: '新卷', summary: '新卷梗概', evidence: '新卷', chapters: [{ title: '明确章', goal: '明确目标', index: 2, evidence: '明确章' }] }],
    characters: [{ name: '新人物', aliases: ['新别名'], profession: '天师', age: '18', gender: '男', appearance: '黑发', personality: '开朗', speechStyle: '直接', background: '当前可知设定', motive: '查案', affiliation: '天师府', evidence: '新人物' }],
    lore: [{ name: '新规则', type: 'world', aliases: [], content: '灵契规则', evidence: '新规则' }],
    foreshadowings: [{ keyword: '残魂身份', description: '后期揭示', note: '第七卷揭示', evidence: '残魂身份' }],
    writingRequirements: { content: '第三人称，保留生活气息', evidence: '第三人称', targetWords: 3000, targetWordsSource: '每章3000字' }, warnings: [],
  };
}

describe('applyNovelStoryImport', () => {
  let useTavernStore: any;
  beforeEach(async () => {
    ({ useTavernStore } = await import('./tavern-store'));
    useTavernStore.setState({ novels: [makeNovel()] });
  });
  afterEach(() => useTavernStore.setState({ novels: [] }));

  it('writes only selected records and preserves authored content', async () => {
    const novel = useTavernStore.getState().novels[0];
    const imported = candidate();
    const selected = getStoryImportEntries(imported, novel).filter((entry) => entry.kind === 'volume' || entry.kind === 'character').map((entry) => entry.id);
    const report = useTavernStore.getState().applyNovelStoryImport(novel.id, imported, selected, storyImportFingerprint(novel));
    const saved = useTavernStore.getState().novels[0];
    expect(report.appliedCount).toBe(2);
    expect(saved.outline.summary).toBe('旧主线');
    expect(saved.outline.volumes.some((item: any) => item.title === '新卷')).toBe(true);
    expect(saved.cast.some((item: any) => item.name === '新人物')).toBe(true);
    expect(saved.characterDossiers.find((item: any) => item.name === '旧人物').experience).toBe('作者小传');
    expect(saved.writingStyle).toBe('');
    expect(saved.systemPrompt).toBe('作者系统提示');
    expect(saved.outlineVersions.length).toBe(2);
  });

  it('rejects a stale preview before making a partial write', async () => {
    const novel = useTavernStore.getState().novels[0];
    const before = JSON.stringify(novel);
    useTavernStore.setState({ novels: [{ ...novel, writingStyle: '作者刚改的要求' }] });
    expect(() => useTavernStore.getState().applyNovelStoryImport(novel.id, candidate(), ['summary'], storyImportFingerprint(novel))).toThrow('发生变化');
    expect(JSON.stringify(useTavernStore.getState().novels[0].outline)).toBe(JSON.stringify(novel.outline));
    expect(JSON.stringify(novel)).toBe(before);
  });

  it('keeps the system prompt and stores selected writing requirements', async () => {
    const novel = useTavernStore.getState().novels[0];
    const imported = candidate();
    const id = getStoryImportEntries(imported, novel).find((entry) => entry.kind === 'writing')!.id;
    useTavernStore.getState().applyNovelStoryImport(novel.id, imported, [id], storyImportFingerprint(novel));
    const saved = useTavernStore.getState().novels[0];
    expect(saved.systemPrompt).toBe('作者系统提示');
    expect(saved.writingStyle).toContain('第三人称');
    expect(saved.continuationSettings.targetWords).toBe(3000);
  });

  it('rejects repeated submission with the old fingerprint', async () => {
    const novel = useTavernStore.getState().novels[0];
    const imported = candidate();
    const id = getStoryImportEntries(imported, novel).find((entry) => entry.kind === 'character')!.id;
    useTavernStore.getState().applyNovelStoryImport(novel.id, imported, [id], storyImportFingerprint(novel));
    expect(() => useTavernStore.getState().applyNovelStoryImport(novel.id, imported, [id], storyImportFingerprint(novel))).toThrow('发生变化');
    expect(useTavernStore.getState().novels[0].cast.filter((item: any) => item.name === '新人物')).toHaveLength(1);
  });

  it('rejects import while a writing job is running', async () => {
    const novel = useTavernStore.getState().novels[0];
    useTavernStore.setState({ novels: [{ ...novel, novelGenerationJobs: [{ jobId: 'writing-1', kind: 'rewrite', mode: 'continue', status: 'running' }] }] });
    expect(() => useTavernStore.getState().applyNovelStoryImport(novel.id, candidate(), ['summary'], storyImportFingerprint(novel))).toThrow('写作任务');
    expect(useTavernStore.getState().novels[0].outline.summary).toBe('旧主线');
  });

  it('initializes continuation settings when writing requirements include target words', async () => {
    const novel = useTavernStore.getState().novels[0];
    const imported = candidate();
    const writingId = getStoryImportEntries(imported, novel).find((entry) => entry.kind === 'writing')!.id;
    const withoutSettings = { ...novel };
    delete withoutSettings.continuationSettings;
    useTavernStore.setState({ novels: [withoutSettings] });
    useTavernStore.getState().applyNovelStoryImport(novel.id, imported, [writingId], storyImportFingerprint(withoutSettings));
    expect(useTavernStore.getState().novels[0].continuationSettings.targetWords).toBe(3000);
    expect(useTavernStore.getState().novels[0].writingStyle).toContain('第三人称');
  });

  it('keeps existing chapter正文 when importing a volume plan', async () => {
    const novel = useTavernStore.getState().novels[0];
    const with正文 = { ...novel, chapters: [{ id: 'chapter-1', index: 1, title: '已定稿', content: '作者已经写好的正文', status: 'final', createdAt: '', updatedAt: '' }] };
    useTavernStore.setState({ novels: [with正文] });
    const imported = candidate();
    const volumeId = getStoryImportEntries(imported, with正文).find((entry) => entry.kind === 'volume')!.id;
    useTavernStore.getState().applyNovelStoryImport(novel.id, imported, [volumeId], storyImportFingerprint(with正文));
    const saved = useTavernStore.getState().novels[0];
    expect(saved.chapters[0].content).toBe('作者已经写好的正文');
    expect(saved.outline.volumes.some((item: any) => item.title === '新卷')).toBe(true);
  });
});
