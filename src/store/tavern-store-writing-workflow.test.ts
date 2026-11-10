import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Novel } from '@/types/tavern';
import type { requestCompletionWithUsage } from '@/services/llm';

const llmState = vi.hoisted(() => ({ replyLength: 2800, calls: 0, models: [] as string[] }));
(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined) } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (v: Record<string, unknown>) => v.web ?? v.default }, AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, InteractionManager: { runAfterInteractions: (task: () => void) => task() }, NativeModules: {}, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() }, Dimensions: { get: vi.fn(() => ({ width: 1200, height: 800 })) }, StyleSheet: { create: (v: unknown) => v } }));
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
  return { ...actual, requestCompletionWithUsage: vi.fn(async ({ onDelta, apiSettings }: Parameters<typeof requestCompletionWithUsage>[0]) => {
    llmState.calls += 1;
    llmState.models.push(apiSettings.model);
    const content = '字'.repeat(llmState.replyLength);
    onDelta?.(content);
    return { content, modelId: 'fixture-model', promptTokens: 10, completionTokens: 10, finishReason: 'stop' };
  }) };
});

const emptySettings = { targetWords: 3000, lookbackChapters: 0, maxContextChars: 20000, autoAudit: false, autoForeshadowingTrack: true, useAntiAiRules: true, useOutline: true };
function novel(overrides: Partial<Novel> = {}): Novel {
  return { id: 'workflow-test', name: '测试', shortIntro: '', detailedIntro: '', systemPrompt: '小说主提示', writingStyle: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '作者', playerPersona: '', playerMotive: '', playerProfession: '', playerAge: '', playerGender: '', playerHeight: '', playerWeight: '', playerAppearance: '', playerPersonality: '', playerSpeechStyle: '', playerBackground: '', playerHabits: '', playerStrengths: '', playerWeaknesses: '', playerSecrets: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '', autoSuggestRoutes: false, relationGraphEnabled: true, characterCardAppearanceId: '', cast: [], characterDossiers: [], loreEntries: [], relationGraphs: [], openingMessage: '', defaultModelId: '', chapters: [], novelGenerationJobs: [], continuationSettings: emptySettings, outline: { volumes: [] }, ...overrides } as Novel;
}
async function storeFor(item: Novel) {
  const { useTavernStore } = await import('./tavern-store');
  const provider = { ...useTavernStore.getState().providers.deepseek, apiKey: 'fixture-key', selectedModel: 'fixture-model', isActive: true };
  useTavernStore.setState({ providers: { deepseek: provider }, novels: [item], generationSettings: { ...useTavernStore.getState().generationSettings, taskModelBindings: {} } });
  return useTavernStore;
}

describe('逐章写作字数与恢复工作流', () => {
  beforeEach(() => { llmState.replyLength = 2800; llmState.calls = 0; llmState.models = []; });
  it('removes the batch writing action from the store', async () => {
    const store = await storeFor(novel());
    expect('batchGenerateNovelChapters' in store.getState()).toBe(false);
  });
  it('sends chapter generation through its fixed model without changing inspiration or the default', async () => {
    const item = novel(); const store = await storeFor(item);
    store.getState().updateGenerationSettings({ taskModelBindings: {
      writing: { providerId: 'deepseek', modelId: 'chapter-model' },
      inspiration: { providerId: 'deepseek', modelId: 'inspiration-model' },
    } });
    await store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 });
    expect(llmState.models).toEqual(['chapter-model']);
    expect(store.getState().providers.deepseek.selectedModel).toBe('fixture-model');
    expect(store.getState().generationSettings.taskModelBindings?.inspiration?.modelId).toBe('inspiration-model');
  });
  it('rejects a removed chapter provider before altering drafts or starting requests', async () => {
    const item = novel(); const store = await storeFor(item);
    store.getState().updateGenerationSettings({ taskModelBindings: {
      writing: { providerId: 'removed-provider', modelId: 'chapter-model' },
    } });
    await expect(store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 })).rejects.toThrow();
    expect(llmState.calls).toBe(0);
    expect(store.getState().novels[0]?.chapters).toEqual([]);
    expect(store.getState().novels[0]?.novelGenerationJobs).toEqual([]);
  });
  it('accepts a 3000-word target at 2800 characters', async () => {
    const item = novel(); const store = await storeFor(item);
    const chapterId = await store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 });
    const chapter = store.getState().novels[0]?.chapters?.find((entry) => entry.id === chapterId);
    expect(chapter?.content.replace(/\s/g, '').length).toBe(2800);
  });
  it('pauses a 3000-word request at 1500 characters', async () => {
    llmState.replyLength = 1500; const item = novel(); const store = await storeFor(item);
    await expect(store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 })).rejects.toThrow();
    expect(store.getState().novels[0]?.chapters).toHaveLength(1);
    expect(store.getState().novels[0]?.novelGenerationJobs?.[0]?.status).toBe('paused');
    expect(store.getState().novels[0]?.novelGenerationJobs?.[0]?.targetWords).toBe(3000);
  });
  it('resumes the same draft to 2800 without creating another chapter', async () => {
    llmState.replyLength = 1500; const item = novel(); const store = await storeFor(item);
    await expect(store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 })).rejects.toThrow();
    const job = store.getState().novels[0]?.novelGenerationJobs?.[0];
    store.setState({ novels: [{ ...store.getState().novels[0], continuationSettings: { ...emptySettings, targetWords: 5000 } } as Novel] });
    llmState.replyLength = 1300;
    await store.getState().resumeNovelGenerationJob(item.id, job!.jobId);
    expect(store.getState().novels[0]?.chapters).toHaveLength(1);
    expect(store.getState().novels[0]?.chapters?.[0]?.content?.replace(/\s/g, '').length).toBe(2800);
  });
  it('keeps a still-short resumed draft paused', async () => {
    llmState.replyLength = 1500; const item = novel(); const store = await storeFor(item);
    await expect(store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 })).rejects.toThrow();
    const job = store.getState().novels[0]?.novelGenerationJobs?.[0]; llmState.replyLength = 500;
    await expect(store.getState().resumeNovelGenerationJob(item.id, job!.jobId)).rejects.toThrow();
    expect(store.getState().novels[0]?.chapters).toHaveLength(1);
    expect(store.getState().novels[0]?.novelGenerationJobs?.[0]?.status).toBe('paused');
  });
  it('rejects an abandoned short draft at finalize without another model call', async () => {
    llmState.replyLength = 1500; const item = novel(); const store = await storeFor(item);
    await expect(store.getState().rewriteNovelNextChapter(item.id, { targetWords: 3000 })).rejects.toThrow();
    const current = store.getState().novels[0]; const chapter = current?.chapters?.[0]; const callsBefore = llmState.calls;
    const job = current?.novelGenerationJobs?.[0];
    store.getState().abandonNovelGenerationJob(item.id, job!.jobId);
    await expect(store.getState().finalizeNovelChapter(item.id, chapter!.id)).rejects.toThrow();
    expect(llmState.calls).toBe(callsBefore);
  });
  it('parses a 3000-word target from the user instruction', async () => {
    const item = novel(); const store = await storeFor(item);
    const chapterId = await store.getState().rewriteNovelNextChapter(item.id, { userInstruction: '本章写3000字' });
    expect(store.getState().novels[0]?.chapters?.find((chapter) => chapter.id === chapterId)?.targetWords).toBe(3000);
  });
  it.each(['resumeNovelGenerationJob', 'retryNovelGenerationJob'] as const)('rejects legacy batch %s without generating chapters', async (action) => {
    const item = novel({ novelGenerationJobs: [{ jobId: 'legacy', kind: 'batch', mode: 'continue', status: 'paused', progress: 0, currentStep: '', startedAt: '', updatedAt: '' }] }); const store = await storeFor(item);
    await expect(store.getState()[action](item.id, 'legacy')).rejects.toThrow('批量写作已移除');
    expect(store.getState().novels[0]?.chapters).toHaveLength(0);
  });
});
