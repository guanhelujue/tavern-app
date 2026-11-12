import { describe, expect, it, vi } from 'vitest';
import type { Novel, NovelChapter } from '@/types/tavern';

const storage = vi.hoisted(() => ({ fail: false, values: new Map<string, string>() }));

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (name: string) => storage.values.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      if (storage.fail) throw new Error('storage unavailable');
      storage.values.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => { storage.values.delete(name); }),
  },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  InteractionManager: { runAfterInteractions: (task: () => void) => task() },
  NativeModules: {}, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() },
  Dimensions: { get: vi.fn(() => ({ width: 390, height: 844 })) }, StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => false), shareAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' }, cacheDirectory: null, documentDirectory: null,
  StorageAccessFramework: {}, readAsStringAsync: vi.fn(), writeAsStringAsync: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn(), MediaTypeOptions: {} }));
vi.mock('expo-media-library', () => ({ Asset: {}, requestPermissionsAsync: vi.fn() }));
vi.mock('@/db/database', () => ({ getAppDatabase: vi.fn(async () => { throw new Error('SQLite unavailable in web test'); }) }));
vi.mock('@/db/migration-coordinator', () => ({ runMigrationCoordinator: vi.fn(async () => ({ status: 'web-fallback' })) }));
vi.mock('@/services/novel-rewrite-pipeline', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/novel-rewrite-pipeline')>(), auditRewriteChapter: vi.fn(), reviseRewriteChapter: vi.fn(),
}));

function chapter(content: string): NovelChapter {
  return { id: 'web-chapter', index: 1, title: '一', summary: '', goal: '', content,
    contentStatus: 'loaded', status: 'draft', createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' };
}

function novel(chapterValue: NovelChapter): Novel {
  return { id: 'web-novel', name: 'Web 保存测试', chapters: [chapterValue], cast: [], loreEntries: [],
    characterDossiers: [], foreshadowings: [], audits: [], outlineVersions: [], outlineProposals: [],
    chapterBackups: [], dialogueSamples: [], styleFeatures: [], createdAt: chapterValue.createdAt, updatedAt: chapterValue.updatedAt,
    shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '',
    playerProfession: '', playerAge: '', playerGender: '', playerHeight: '', playerWeight: '', playerAppearance: '', playerPersonality: '', playerSpeechStyle: '', playerBackground: '', playerHabits: '', playerStrengths: '', playerWeaknesses: '', playerSecrets: '',
    playerName: '', playerPersona: '', playerMotive: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '',
    defaultModelId: '', autoSuggestRoutes: false, relationGraphEnabled: false, characterCardAppearanceId: '', relationGraphs: [], openingMessage: '', statusBar: '', chatBackgroundOpacity: 0.35, isDraft: false, createStep: 3,
  };
}

describe('web durable chapter saves', () => {
  it('keeps memory unchanged when durable storage fails, then publishes after retry', async () => {
    const { useTavernStore: store } = await import('./tavern-store');
    const original = chapter('原正文');
    store.setState({ databaseMode: 'web-fallback', novels: [novel(original)] });
    storage.fail = true;
    await expect(store.getState().saveNovelChapter('web-novel', { ...original, content: '失败修订' })).rejects.toThrow('storage unavailable');
    expect(store.getState().novels[0].chapters![0].content).toBe('原正文');
    storage.fail = false;
    await store.getState().saveNovelChapter('web-novel', { ...original, content: '成功修订' });
    expect(store.getState().novels[0].chapters![0].content).toBe('成功修订');
  });
});
