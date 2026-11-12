import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Novel, NovelChapter } from '@/types/tavern';
import type { requestCompletionWithUsage } from '@/services/llm';

const llmState = vi.hoisted(() => ({
  calls: [] as { messages: { role: string; content: string }[] }[],
}));

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined) },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  InteractionManager: { runAfterInteractions: (task: () => void) => task() },
  NativeModules: {}, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() },
  Dimensions: { get: vi.fn(() => ({ width: 1200, height: 800 })) }, StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => false), shareAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { UTF8: 'utf8' }, cacheDirectory: null, documentDirectory: null }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn(), MediaTypeOptions: {} }));
vi.mock('expo-media-library', () => ({ Asset: {}, requestPermissionsAsync: vi.fn() }));
vi.mock('@/db/migration-coordinator', () => ({ runMigrationCoordinator: vi.fn(async () => ({ status: 'web-fallback' })) }));
vi.mock('expo-sqlite', () => ({ openDatabaseSync: vi.fn(), openDatabaseAsync: vi.fn() }));

vi.mock('@/services/llm', async () => {
  const actual = await vi.importActual<typeof import('@/services/llm')>('@/services/llm');
  return {
    ...actual,
    requestCompletionWithUsage: vi.fn(async ({ messages, onDelta }: Parameters<typeof requestCompletionWithUsage>[0]) => {
      llmState.calls.push({ messages });
      const content = `这一章的正文在自定义小说提示词约束下展开。${'正文'.repeat(1400)}`;
      onDelta?.(content);
      return { content, modelId: 'fixture-model', promptTokens: 10, completionTokens: 12, finishReason: 'stop' };
    }),
  };
});

const novelPrompt = '小说主提示：使用克制的第三人称叙事，严格遵守本作品设定。';

function makeNovel(overrides: Partial<Novel> = {}): Novel {
  return {
    id: 'chapter-prompt-test',
    name: '提示词测试小说',
    systemPrompt: novelPrompt,
    chapters: [],
    novelGenerationJobs: [],
    cast: [],
    loreEntries: [],
    novelDossiers: [],
    shortIntro: '', detailedIntro: '', writingStyle: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '',
    playerName: '测试作者', playerMotive: '', playerProfession: '', playerAge: '', playerGender: '', playerHeight: '', playerWeight: '',
    playerAppearance: '', playerPersonality: '', playerSpeechStyle: '', playerBackground: '', playerHabits: '', playerStrengths: '',
    playerWeaknesses: '', playerSecrets: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '',
    gameRules: '', autoSuggestRoutes: false, relationGraphEnabled: true, characterCardAppearanceId: '', relationGraphs: [], openingMessage: '',
    defaultModelId: '',

    playerPersona: '',
    initialStoryState: '',
    outline: { volumes: [] },
    continuationSettings: {
      targetWords: 3000,
      lookbackChapters: 0,
      maxContextChars: 20000,
      autoAudit: false,
      autoForeshadowingTrack: true,
      useAntiAiRules: true,
      useOutline: true,
    },
    ...overrides,
  } as Novel;
}

async function loadStore() {
  const { useTavernStore } = await import('./tavern-store');
  const provider = {
    ...useTavernStore.getState().providers.deepseek,
    apiKey: 'fixture-key',
    selectedModel: 'fixture-model',
    isActive: true,
  };
  useTavernStore.setState({
    providers: { deepseek: provider },
    novels: [],
  });
  return useTavernStore;
}

describe('chapter writing uses the novel system prompt', () => {
  beforeEach(() => {
    llmState.calls.length = 0;
  });

  it('passes a new novel custom prompt to the first chapter request', async () => {
    const store = await loadStore();
    const novel = makeNovel();
    store.setState({ novels: [novel] });

    await store.getState().rewriteNovelNextChapter(novel.id, { userInstruction: '从冲突场景开始' });

    expect(llmState.calls.length).toBeGreaterThan(0);
    expect(llmState.calls[0].messages[0]).toMatchObject({ role: 'system' });
    expect(llmState.calls.every((call) => call.messages[0].content.includes(novelPrompt))).toBe(true);
  });

  it('uses the modified novel prompt when writing a subsequent chapter', async () => {
    const store = await loadStore();
    const first: NovelChapter = {
      id: 'chapter-1', index: 1, title: '第一章', summary: '', goal: '', content: '已发生的正文', status: 'final', aiGenerated: true,
      createdAt: '', updatedAt: '',
    };
    const novel = makeNovel({ chapters: [first], systemPrompt: '旧版小说主提示。' });
    store.setState({ novels: [novel] });
    const updatedNovel = { ...novel, systemPrompt: '修改后的小说主提示：保持冷峻悬疑语气。' };
    store.setState({ novels: [updatedNovel] });

    await store.getState().rewriteNovelNextChapter(novel.id, { userInstruction: '继续第二章' });

    expect(llmState.calls.length).toBeGreaterThan(0);
    expect(llmState.calls.every((call) => call.messages[0].content.includes(updatedNovel.systemPrompt))).toBe(true);
  });

  it.each([0, 1, 2])('uses the requested lookback window (%i; zero includes all)', async (lookback) => {
    const store = await loadStore();
    const chapters: NovelChapter[] = Array.from({ length: 3 }, (_, index) => ({
      id: `history-${index}`, index: index + 1, title: `章${index + 1}`, summary: '', goal: '',
      content: `独有前文标记${index + 1}`, status: 'final', createdAt: '', updatedAt: '',
    }));
    const novel = makeNovel({ chapters });
    novel.continuationSettings!.lookbackChapters = lookback;
    store.setState({ novels: [novel] });
    await store.getState().rewriteNovelNextChapter(novel.id);
    const prompt = llmState.calls[0].messages[0].content;
    for (const [index, chapter] of chapters.entries()) {
      if (lookback === 0 || index >= chapters.length - lookback) expect(prompt).toContain(chapter.content);
      else expect(prompt).not.toContain(chapter.content);
    }
  });

  it('distinguishes omitted image fields from explicitly cleared ones', async () => {
    const store = await loadStore();
    const novel = makeNovel({ coverImageUri: 'cover.png', chatBackgroundUri: 'background.png' });
    store.setState({ novels: [novel] });
    store.getState().updateNovel(novel.id, { name: '改名' });
    expect(store.getState().novels[0].coverImageUri).toBe('cover.png');
    store.getState().updateNovel(novel.id, { coverImageUri: undefined, chatBackgroundUri: undefined });
    expect(store.getState().novels[0].coverImageUri).toBeUndefined();
    expect(store.getState().novels[0].chatBackgroundUri).toBeUndefined();
  });

  it('keeps the novel prompt when resuming a segmented chapter job', async () => {
    const store = await loadStore();
    const draft: NovelChapter = {
      id: 'chapter-resume', index: 1, title: '第一章', summary: '', goal: '',
      content: '第一段已经写好的正文', status: 'draft', aiGenerated: true, createdAt: '', updatedAt: '',
    };
    const novel = makeNovel({
      chapters: [draft],
      continuationSettings: {
        targetWords: 3000, lookbackChapters: 0, maxContextChars: 20000, autoAudit: false,
        autoForeshadowingTrack: true, useAntiAiRules: true, useOutline: true,
      },
      novelGenerationJobs: [{
        jobId: 'resume-write', kind: 'write', mode: 'continue', status: 'paused', progress: 0.5,
        currentStep: '已暂停', startedAt: '', updatedAt: '', chapterIndex: 1, chapterId: draft.id,
        segmentIndex: 1, totalSegments: 2, accumulatedContent: draft.content, userInstruction: '', retryCount: 1,
      }],
    });
    store.setState({ novels: [novel] });

    await store.getState().resumeNovelGenerationJob(novel.id, 'resume-write');

    expect(llmState.calls).toHaveLength(1);
    expect(llmState.calls[0].messages[0].content).toContain(novelPrompt);
  });
});
