import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrateDatabase } from '@/db/migrations';
import type { NovelChapter } from '@/types/tavern';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
const dbRef = vi.hoisted(() => ({ current: null as any, failContent: '' }));

// Keep this integration seam real: only the persistence boundary is replaced so the
// store actions and their DB/session repositories execute normally.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  InteractionManager: { runAfterInteractions: (task: () => void) => task() },
  NativeModules: {},
  Alert: { alert: vi.fn() },
  Linking: { openURL: vi.fn() },
  Dimensions: { get: vi.fn(() => ({ width: 390, height: 844 })) },
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => false), shareAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' }, cacheDirectory: null, documentDirectory: null,
  StorageAccessFramework: {}, readAsStringAsync: vi.fn(), writeAsStringAsync: vi.fn(),
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn(), MediaTypeOptions: {} }));
vi.mock('expo-media-library', () => ({ Asset: {}, requestPermissionsAsync: vi.fn() }));
vi.mock('@/db/migration-coordinator', () => ({
  runMigrationCoordinator: vi.fn(async () => ({ status: 'web-fallback' })),
}));
vi.mock('@/db/database', () => ({
  getAppDatabase: vi.fn(async () => dbRef.current),
}));
vi.mock('@/services/novel-rewrite-pipeline', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/novel-rewrite-pipeline')>(),
  auditRewriteChapter: vi.fn(),
  reviseRewriteChapter: vi.fn(),
}));


let raw: DatabaseSync;
beforeAll(async () => {
  raw = new DatabaseSync(':memory:');
  dbRef.current = {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params),
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params),
    runAsync: async (sql: string, ...params: SQLInputValue[]) => {
      if (dbRef.failContent && sql.startsWith('INSERT INTO chapters') && params.includes(dbRef.failContent)) throw new Error('disk full');
      return raw.prepare(sql).run(...params);
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  await migrateDatabase(dbRef.current);
});
async function fixture() {
  const { useTavernStore: store } = await import('./tavern-store');
  store.setState({ databaseMode: 'sqlite' });
  const id = store.getState().createNovel({
    name: '保存测试', shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '',
    shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '',
    playerPersona: '', playerMotive: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '',
    mainPlot: '', initialStoryState: '', gameRules: '', cast: [], characterDossiers: [], loreEntries: [],
    chapters: [], foreshadowings: [], audits: [], outlineVersions: [], outlineProposals: [],
    dialogueSamples: [], styleFeatures: [], chapterBackups: [], defaultModelId: '', autoSuggestRoutes: false,
  } as any);
  const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
  await enqueueNovelWrite(id, async () => undefined);
  return { store, id, drain: () => enqueueNovelWrite(id, async () => undefined) };
}
function chapter(id: string, content = '原正文'): NovelChapter {
  return { id: `${id}-chapter`, index: 1, title: '一', summary: '', goal: '', content,
    contentStatus: 'loaded', status: 'draft', createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' };
}
const imported = { fileName: 'book.txt', title: 'book', totalChars: 6,
  chapters: [{ title: '一', content: '第一章正文' }, { title: '二', content: '第二章正文' }] };

describe('durable chapter saves', () => {
  it('writes every imported chapter before publishing and can reload the bodies', async () => {
    const { store, id, drain } = await fixture();
    await store.getState().importNovelText(id, imported);
    const saved = store.getState().novels.find(n => n.id === id)!.chapters!;
    expect(saved).toHaveLength(2);
    const rows = raw.prepare('SELECT content FROM chapters WHERE novel_id = ? ORDER BY chapter_index').all(id);
    expect(rows.map(row => row.content)).toEqual(imported.chapters.map(item => item.content));
    store.setState({ novels: store.getState().novels.map(n => n.id === id ? { ...n, chapters: saved.map(c => ({ ...c, content: '', contentStatus: 'unloaded' as const })) } : n) });
    for (const item of saved) await store.getState().hydrateNovelChapterContent(item.id);
    expect(store.getState().novels.find(n => n.id === id)!.chapters!.map(c => c.content)).toEqual(imported.chapters.map(item => item.content));
    await drain();
  });
  it('rolls back the entire import on failure and permits a clean retry', async () => {
    const { store, id, drain } = await fixture();
    dbRef.failContent = '第二章正文';
    try { await expect(store.getState().importNovelText(id, imported)).rejects.toThrow('disk full'); }
    finally { dbRef.failContent = ''; }
    expect(raw.prepare('SELECT id FROM chapters WHERE novel_id = ?').all(id)).toHaveLength(0);
    expect(store.getState().novels.find(n => n.id === id)!.chapters).toHaveLength(0);
    await store.getState().importNovelText(id, imported);
    expect(raw.prepare('SELECT id FROM chapters WHERE novel_id = ?').all(id)).toHaveLength(2);
    await drain();
  });
  it('does not publish a failed edit, and can save it after storage recovers', async () => {
    const { store, id, drain } = await fixture();
    await store.getState().saveNovelChapter(id, chapter(id));
    const original = store.getState().novels.find(n => n.id === id)!.chapters![0];
    dbRef.failContent = '修订正文';
    try { await expect(store.getState().saveNovelChapter(id, { ...original, content: '修订正文' })).rejects.toThrow('disk full'); }
    finally { dbRef.failContent = ''; }
    expect(store.getState().novels.find(n => n.id === id)!.chapters![0].content).toBe('原正文');
    expect(raw.prepare('SELECT content FROM chapters WHERE id = ?').get(original.id)?.content).toBe('原正文');
    await store.getState().saveNovelChapter(id, { ...original, content: '修订正文' });
    expect(raw.prepare('SELECT content FROM chapters WHERE id = ?').get(original.id)?.content).toBe('修订正文');
    await drain();
  });

  it('preserves metadata changed while a chapter save is waiting for storage', async () => {
    const { store, id, drain } = await fixture();
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const blocker = enqueueNovelWrite(id, () => hold);
    const save = store.getState().saveNovelChapter(id, chapter(id));
    store.getState().updateNovel(id, { name: '保存期间改名' });
    release();
    await blocker;
    await save;
    await drain();
    expect(store.getState().novels.find(n => n.id === id)!.name).toBe('保存期间改名');
    expect(raw.prepare('SELECT name FROM novels WHERE id = ?').get(id)?.name).toBe('保存期间改名');
  });

  it('normalizes an explicitly final save back to draft', async () => {
    const { store, id, drain } = await fixture();
    await store.getState().saveNovelChapter(id, { ...chapter(id), status: 'final' });
    expect(store.getState().novels.find(n => n.id === id)!.chapters![0].status).toBe('draft');
    expect(raw.prepare('SELECT status FROM chapters WHERE novel_id = ?').get(id)?.status).toBe('draft');
    await drain();
  });

  it('rejects a stale concurrent save instead of overwriting the newer chapter', async () => {
    const { store, id, drain } = await fixture();
    await store.getState().saveNovelChapter(id, chapter(id));
    const saved = store.getState().novels.find(n => n.id === id)!.chapters![0];
    const first = store.getState().saveNovelChapter(id, { ...saved, content: '并发版本 A' });
    const second = store.getState().saveNovelChapter(id, { ...saved, content: '并发版本 B' });
    const results = await Promise.allSettled([first, second]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(store.getState().novels.find(n => n.id === id)!.chapters![0].content).toBe('并发版本 A');
    await drain();
  });
});
