import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { migrateDatabase } from '@/db/migrations';
import { getNovelAuditSourceFingerprint } from '@/services/novel-audit-freshness';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
const dbRef = vi.hoisted(() => ({ current: null as any }));

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

describe('tavern store session recovery integration', () => {
  it('persists a created novel through the real action and database boundary', async () => {
    const raw = new DatabaseSync(':memory:');
    dbRef.current = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
      getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    let transactionQueue: Promise<void> = Promise.resolve();
    dbRef.current.withExclusiveTransactionAsync = (task: (db: typeof dbRef.current) => Promise<void>) => {
      const transactionDb = dbRef.current;
      const operation = transactionQueue.catch(() => undefined).then(() => transactionDb.withTransactionAsync(() => task(transactionDb)));
      transactionQueue = operation;
      return operation;
    };
    await migrateDatabase(dbRef.current);
    const module = await import('./tavern-store');
    module.useTavernStore.setState({ databaseMode: 'sqlite' } as any);
    const id = module.useTavernStore.getState().createNovel({
      name: '集成测试', shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '',
      shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '',
      playerPersona: '', playerMotive: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '',
      mainPlot: '', initialStoryState: '', gameRules: '', cast: [], characterDossiers: [], loreEntries: [],
      chapters: [], foreshadowings: [], audits: [], outlineVersions: [], outlineProposals: [],
      dialogueSamples: [], styleFeatures: [], chapterBackups: [], defaultModelId: '', autoSuggestRoutes: false,
    } as any);
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    await enqueueNovelWrite(id, async () => undefined);
    expect(raw.prepare('SELECT name FROM novels WHERE id = ?').get(id)?.name).toBe('集成测试');
    raw.close();
  });

  it('backs up the full native history and imports it as a new database copy', async () => {
    const raw = new DatabaseSync(':memory:');
    dbRef.current = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
      getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    let transactionQueue: Promise<void> = Promise.resolve();
    dbRef.current.withExclusiveTransactionAsync = (task: (db: typeof dbRef.current) => Promise<void>) => {
      const transactionDb = dbRef.current;
      const operation = transactionQueue.catch(() => undefined).then(() => transactionDb.withTransactionAsync(() => task(transactionDb)));
      transactionQueue = operation;
      return operation;
    };
    await migrateDatabase(dbRef.current);
    const module = await import('./tavern-store');
    module.useTavernStore.setState({ databaseMode: 'sqlite' } as any);
    const id = module.useTavernStore.getState().createNovel({
      name: '备份测试', shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '', playerPersona: '', playerMotive: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '', cast: [], characterDossiers: [], loreEntries: [], chapters: [], foreshadowings: [], audits: [], outlineVersions: [], outlineProposals: [], dialogueSamples: [], styleFeatures: [], chapterBackups: [], defaultModelId: '', autoSuggestRoutes: false,
    } as any);
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    await enqueueNovelWrite(id, async () => undefined);
    const messages = Array.from({ length: 125 }, (_, index) => ({ id: `native-${index}`, characterId: id, worldId: 'legacy', role: index % 2 ? 'assistant' : 'user', content: `message-${index}`, status: 'complete', createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(), updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString() }));
    const { replaceSessionMessages } = await import('@/db/novel-session-repository');
    await replaceSessionMessages(dbRef.current, id, 'legacy', messages as any);
    await dbRef.current.runAsync("INSERT INTO chapters (id, novel_id, chapter_index, title, content, status, created_at, updated_at, json_extra) VALUES (?, ?, 1, '一', '全文章节', 'final', 'now', 'now', '{}')", 'chapter-native', id);
    module.useTavernStore.setState({ novelConversations: { ...module.useTavernStore.getState().novelConversations, [id]: messages.slice(-20) }, novelConversationMeta: { ...module.useTavernStore.getState().novelConversationMeta, [id]: { ...module.useTavernStore.getState().novelConversationMeta[id], shortTermMemories: ['memory'] } } } as any);
    const backup = await module.useTavernStore.getState().buildNovelBackup(id);
    expect(backup.messages).toHaveLength(125);
    expect(backup.novel?.chapters?.[0]?.content).toBe('全文章节');
    const checkpoint = await module.useTavernStore.getState().createNovelSaveSlot(id, 'checkpoint');
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) throw new Error('checkpoint failed');
    const originalSlot = module.useTavernStore.getState().novelSlotBooks[id].activeSlotId;
    const { appendMessage } = await import('@/db/repositories/messages');
    await appendMessage(dbRef.current, { ...messages[0], id: 'future-message', novelId: id, worldId: 'legacy', content: 'future', role: 'assistant', status: 'complete', reasoningContent: null, promptTokens: null, completionTokens: null, modelId: null } as any);
    await module.useTavernStore.getState().switchNovelSaveSlot(id, checkpoint.slotId!);
    expect(await dbRef.current.getAllAsync('SELECT id FROM messages WHERE novel_id = ?', id)).toHaveLength(125);
    expect(module.useTavernStore.getState().novelConversations[id]).toHaveLength(125);
    expect(module.useTavernStore.getState().novelConversationMeta[id].shortTermMemories).toEqual(['memory']);
    await module.useTavernStore.getState().rollbackNovelSaveSlot(id);
    expect(await dbRef.current.getAllAsync('SELECT id FROM messages WHERE novel_id = ?', id)).toHaveLength(126);
    expect(module.useTavernStore.getState().novelSlotBooks[id].activeSlotId).toBe(originalSlot);
    await module.useTavernStore.getState().switchNovelSaveSlot(id, checkpoint.slotId!);
    const beforeFailure = module.useTavernStore.getState().novelConversations[id];
    const realRun = dbRef.current.runAsync;
    dbRef.current.runAsync = async (sql: string, ...params: SQLInputValue[]) => {
      if (sql.startsWith('INSERT INTO messages')) throw new Error('disk full');
      return realRun(sql, ...params);
    };
    await expect(module.useTavernStore.getState().editNovelMessage(id, 'native-124', 'must rollback')).rejects.toThrow('disk full');
    dbRef.current.runAsync = realRun;
    expect(module.useTavernStore.getState().novelConversations[id]).toBe(beforeFailure);
    expect((await dbRef.current.getFirstAsync('SELECT content FROM messages WHERE id = ?', 'native-124')).content).toBe('message-124');
    await module.useTavernStore.getState().editNovelMessage(id, 'native-124', 'edited');
    expect((await dbRef.current.getFirstAsync('SELECT content FROM messages WHERE id = ?', 'native-124') as { content: string } | null)?.content).toBe('edited');
    expect(module.useTavernStore.getState().novelConversationMeta[id]?.shortTermMemories).toEqual([]);
    await module.useTavernStore.getState().deleteNovelMessage(id, 'native-124');
    expect((await dbRef.current.getFirstAsync('SELECT COUNT(*) AS count FROM messages WHERE id = ?', 'native-124') as { count: number } | null)?.count).toBe(0);
    await module.useTavernStore.getState().importSessionBundle(backup);
    const ids = (await dbRef.current.getAllAsync('SELECT id FROM novels') as { id: string }[]).map((row) => row.id);
    expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThan(1);
    const importedId = ids.find((item) => item !== id)!;
    const { readAllSessionMessages, readConversationState, readSlotBook } = await import('@/db/novel-session-repository');
    expect(await readAllSessionMessages(dbRef.current, importedId, 'legacy')).toHaveLength(125);
    expect((await readConversationState(dbRef.current, importedId, 'legacy'))?.shortTermMemories).toEqual(['memory']);
    expect((await readSlotBook(dbRef.current, importedId, 'legacy'))?.slots[0].messages).toHaveLength(125);
    expect((await dbRef.current.getFirstAsync('SELECT content FROM chapters WHERE novel_id = ?', importedId)).content).toBe('全文章节');
    expect(await readAllSessionMessages(dbRef.current, id, 'legacy')).toHaveLength(124);
    await enqueueNovelWrite(importedId, async () => undefined);
    module.useTavernStore.setState({ databaseMode: 'pending' });
    raw.close();
  });

  it('keeps quick-travel world sessions isolated and rejects a failed switch without publishing state', async () => {
    const raw = new DatabaseSync(':memory:');
    dbRef.current = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
      getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    let transactionQueue: Promise<void> = Promise.resolve();
    dbRef.current.withExclusiveTransactionAsync = (task: (db: typeof dbRef.current) => Promise<void>) => {
      const transactionDb = dbRef.current;
      const operation = transactionQueue.catch(() => undefined).then(() => transactionDb.withTransactionAsync(() => task(transactionDb)));
      transactionQueue = operation;
      return operation;
    };
    await migrateDatabase(dbRef.current);
    const module = await import('./tavern-store');
    module.useTavernStore.setState({ databaseMode: 'sqlite' } as any);
    const id = module.useTavernStore.getState().createNovel({
      name: '世界切换', shortIntro: '', detailedIntro: '', systemPrompt: '', writingStyle: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '', playerName: '', playerPersona: '', playerMotive: '', worldName: '', worldEra: '', worldConflict: '', worldTone: '', mainPlot: '', initialStoryState: '', gameRules: '', cast: [], characterDossiers: [], loreEntries: [], chapters: [], foreshadowings: [], audits: [], outlineVersions: [], outlineProposals: [], dialogueSamples: [], styleFeatures: [], chapterBackups: [], defaultModelId: '', autoSuggestRoutes: false,
    } as any);
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    await enqueueNovelWrite(id, async () => undefined);
    const a = await module.useTavernStore.getState().addQuickTravelWorld(id, { name: 'A' } as any);
    const b = await module.useTavernStore.getState().addQuickTravelWorld(id, { name: 'B' } as any);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    const { replaceSessionMessages } = await import('@/db/novel-session-repository');
    for (const [worldId, content] of [[a!, 'A-memory'], [b!, 'B-memory']] as const) {
      await replaceSessionMessages(dbRef.current, id, worldId, [{ id: `${worldId}-message`, characterId: id, worldId, role: 'user', content, status: 'complete', createdAt: 'now', updatedAt: 'now' }] as any);
    }
    expect(await module.useTavernStore.getState().switchQuickTravelWorld(id, a!)).toBe(true);
    expect(module.useTavernStore.getState().novelConversations[id]?.[0]?.content).toBe('A-memory');
    expect(await module.useTavernStore.getState().switchQuickTravelWorld(id, b!)).toBe(true);
    expect(module.useTavernStore.getState().novelConversations[id]?.[0]?.content).toBe('B-memory');
    const before = module.useTavernStore.getState().novelConversations[id];
    expect(await module.useTavernStore.getState().switchQuickTravelWorld(id, 'missing-world')).toBe(false);
    expect(module.useTavernStore.getState().novelConversations[id]).toBe(before);

    const { beginNovelRequest } = await import('@/services/novel-request-lifecycle');
    const realRead = dbRef.current.getAllAsync;
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const delayed = new Promise<void>((resolve) => { releaseRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    dbRef.current.getAllAsync = async (sql: string, ...params: SQLInputValue[]) => {
      if (sql.includes('FROM messages') && params.includes(a!)) { readStarted(); await delayed; }
      return realRead(sql, ...params);
    };
    const switching = module.useTavernStore.getState().switchQuickTravelWorld(id, a!);
    await started;
    expect(beginNovelRequest(id)).toBeNull();
    expect(module.useTavernStore.getState().novelConversations[id]).toBe(before);
    releaseRead();
    await switching;
    dbRef.current.getAllAsync = async (sql: string, ...params: SQLInputValue[]) => {
      if (sql.includes('FROM messages')) throw new Error('read failed');
      return realRead(sql, ...params);
    };
    const currentA = module.useTavernStore.getState().novelConversations[id];
    await expect(module.useTavernStore.getState().switchQuickTravelWorld(id, b!)).rejects.toThrow('read failed');
    expect(module.useTavernStore.getState().novelConversations[id]).toBe(currentA);
    dbRef.current.getAllAsync = realRead;
    const setChapter = (chapter: number) => {
      const novel = module.useTavernStore.getState().novels.find((item) => item.id === id)!;
      module.useTavernStore.getState().updateNovel(id, { quickTravel: { ...novel.quickTravel!, worlds: novel.quickTravel!.worlds.map((world) => world.id === a ? { ...world, runtime: { ...world.runtime, currentChapter: chapter } } : world) } });
    };
    setChapter(2);
    const checkpoint = await module.useTavernStore.getState().createNovelSaveSlot(id, 'chapter-two');
    if (!checkpoint.ok) throw new Error('save failed');
    setChapter(5);
    await module.useTavernStore.getState().switchNovelSaveSlot(id, checkpoint.slotId!);
    expect(module.useTavernStore.getState().novels.find((item) => item.id === id)?.quickTravel?.worlds.find((world) => world.id === a)?.runtime.currentChapter).toBe(2);
    const storedNovel = JSON.parse((await dbRef.current.getFirstAsync('SELECT json_extra AS json FROM novels WHERE id = ?', id)).json);
    expect(storedNovel.quickTravel.worlds.find((world: any) => world.id === a).runtime.currentChapter).toBe(2);
    module.useTavernStore.setState((state) => ({ novels: state.novels.map((novel) => novel.id === id ? { ...novel, novelContinuationPlans: [{ planId: 'shared-plan', sourceChapterId: '', createdAt: 'now', updatedAt: 'now' }] as any } : novel) }));
    const backup = await module.useTavernStore.getState().buildNovelBackup(id);
    await module.useTavernStore.getState().importSessionBundle(backup);
    expect(await dbRef.current.getAllAsync('SELECT id FROM novel_continuation_plans')).toHaveLength(2);
    for (const novel of module.useTavernStore.getState().novels) await enqueueNovelWrite(novel.id, async () => undefined);
    module.useTavernStore.setState({ databaseMode: 'pending' });
    raw.close();
  });
  it('keeps Web memories and snapshots without SQLite and retries a failed explicit save', async () => {
    const { Platform } = await import('react-native');
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    const { getAppDatabase } = await import('@/db/database');
    const { waitForNovelPersistence } = await import('@/services/novel-persistence-gate');
    const { useTavernStore } = await import('./tavern-store');
    const originalPlatform = Platform.OS;
    (Platform as any).OS = 'web';
    try {
      useTavernStore.setState({ databaseMode: 'web-fallback' });
      const template = useTavernStore.getState().novels[0];
      const id = useTavernStore.getState().createNovel({ ...template, quickTravel: undefined, chapters: [], name: 'Web test' } as any);
      useTavernStore.setState((state) => ({ novelConversations: { ...state.novelConversations, [id]: [
        { id: 'web-message', characterId: id, role: 'assistant', content: 'original', status: 'complete', createdAt: 'now', updatedAt: 'now' },
      ] } }));
      const databaseCalls = vi.mocked(getAppDatabase).mock.calls.length;
      await useTavernStore.getState().updateNovelStoryMemories(id, { longTermMemory: 'long', midTermMemories: ['mid'], shortTermMemories: ['short'] });
      const checkpoint = await useTavernStore.getState().createNovelSaveSlot(id, 'web-checkpoint');
      if (!checkpoint.ok) throw new Error('checkpoint failed');
      await waitForNovelPersistence();
      const before = useTavernStore.getState().novelConversations[id];
      vi.mocked(storage.setItem).mockRejectedValueOnce(new Error('quota'));
      await expect(useTavernStore.getState().editNovelMessage(id, 'web-message', 'changed')).rejects.toThrow('quota');
      expect(useTavernStore.getState().novelConversations[id]).toBe(before);
      await useTavernStore.getState().editNovelMessage(id, 'web-message', 'changed');
      await useTavernStore.getState().switchNovelSaveSlot(id, checkpoint.slotId!);
      const persisted = useTavernStore.persist.getOptions().partialize!(useTavernStore.getState()) as Pick<ReturnType<typeof useTavernStore.getState>, 'novelConversations' | 'novelConversationMeta' | 'novelSlotBooks'>;
      expect(persisted.novelConversations?.[id][0].content).toBe('original');
      expect(persisted.novelConversationMeta[id].longTermMemory).toBe('long');
      expect(persisted.novelSlotBooks[id].slots.find((slot) => slot.id === checkpoint.slotId)?.messages).toHaveLength(1);
      expect(vi.mocked(getAppDatabase).mock.calls.length).toBe(databaseCalls);
      await waitForNovelPersistence();
    } finally { (Platform as any).OS = originalPlatform; }
  });

  it('persists adopted AI revisions and rejects stale or worse candidates without replacing the current draft', async () => {
    const raw = new DatabaseSync(':memory:');
    dbRef.current = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
      getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    let transactionQueue: Promise<void> = Promise.resolve();
    dbRef.current.withExclusiveTransactionAsync = (task: (db: typeof dbRef.current) => Promise<void>) => {
      const transactionDb = dbRef.current;
      const operation = transactionQueue.catch(() => undefined).then(() => transactionDb.withTransactionAsync(() => task(transactionDb)));
      transactionQueue = operation;
      return operation;
    };
    await migrateDatabase(dbRef.current);
    const { useTavernStore } = await import('./tavern-store');
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    const pipeline = await import('@/services/novel-rewrite-pipeline');
    const template = useTavernStore.getState().novels[0];
    useTavernStore.setState({ databaseMode: 'sqlite' });
    const chapter = {
      id: 'ai-revision-chapter', index: 1, title: '正文', content: '原稿',
      summary: '摘要', goal: '目标', status: 'draft' as const, createdAt: 'now', updatedAt: 'now',
    };
    const id = useTavernStore.getState().createNovel({
      ...template, name: 'AI 修订测试', chapters: [chapter], chapterBackups: [], quickTravel: undefined,
    });
    useTavernStore.setState((state) => ({
      novels: state.novels.map((novel) => novel.id === id ? {
        ...novel,
        novelRewriteAudits: [{ auditId: 'original-audit', chapterId: chapter.id, chapterIndex: 1, issues: [], score: 50, passed: false, createdAt: 'now' }],
      } : novel),
    }));
    const getNovel = () => useTavernStore.getState().novels.find((item) => item.id === id)!;
    try {
      await expect(useTavernStore.getState().reviseNovelChapter(id, chapter.id)).rejects.toThrow('请先审查本章');
      const currentFingerprint = getNovelAuditSourceFingerprint(getNovel(), chapter);
      useTavernStore.setState((state) => ({
        novels: state.novels.map((novel) => novel.id === id ? {
          ...novel,
          novelRewriteAudits: [{ auditId: 'original-audit', chapterId: chapter.id, chapterIndex: 1, issues: [], score: 50, passed: false, createdAt: 'now', sourceFingerprint: currentFingerprint, stale: false }],
        } : novel),
      }));
      vi.mocked(pipeline.reviseRewriteChapter).mockResolvedValue({ content: '更好的正文', tokens: 10 });
      vi.mocked(pipeline.auditRewriteChapter).mockResolvedValue({ issues: [], score: 95, passed: true, tokens: 10 });
      expect(await useTavernStore.getState().reviseNovelChapter(id, chapter.id)).toMatchObject({ adopted: true });
      await enqueueNovelWrite(id, async () => undefined);
      expect(raw.prepare('SELECT content FROM chapters WHERE id = ?').get(chapter.id)?.content).toBe('更好的正文');
      expect(getNovel().chapterBackups?.[0].content).toBe('原稿');

      const acceptedAudits = getNovel().novelRewriteAudits;
      vi.mocked(pipeline.reviseRewriteChapter).mockResolvedValue({ content: '不合格候选', tokens: 10 });
      vi.mocked(pipeline.auditRewriteChapter).mockResolvedValue({ issues: [], score: 20, passed: false, tokens: 10 });
      expect(await useTavernStore.getState().reviseNovelChapter(id, chapter.id)).toMatchObject({ adopted: false });
      expect(getNovel().chapters?.[0].content).toBe('更好的正文');
      expect(getNovel().novelRewriteAudits).toBe(acceptedAudits);

      vi.mocked(pipeline.reviseRewriteChapter).mockImplementationOnce(async () => {
        useTavernStore.getState().updateNovelChapter(id, chapter.id, { content: '用户刚写的新稿' });
        return { content: '过时的AI结果', tokens: 10 };
      });
      vi.mocked(pipeline.auditRewriteChapter).mockResolvedValue({ issues: [], score: 100, passed: true, tokens: 10 });
      await expect(useTavernStore.getState().reviseNovelChapter(id, chapter.id)).rejects.toThrow('修订期间章节已被修改');
      await enqueueNovelWrite(id, async () => undefined);
      expect(getNovel().chapters?.[0].content).toBe('用户刚写的新稿');
      expect(raw.prepare('SELECT content FROM chapters WHERE id = ?').get(chapter.id)?.content).toBe('用户刚写的新稿');
      const currentNovel = getNovel();
      useTavernStore.setState((state) => ({ novels: state.novels.map((novel) => novel.id === id ? {
        ...novel, novelRewriteAudits: [{ ...novel.novelRewriteAudits![0], sourceFingerprint: getNovelAuditSourceFingerprint(currentNovel, currentNovel.chapters![0]), stale: false }],
      } : novel) }));
      vi.mocked(pipeline.reviseRewriteChapter).mockImplementationOnce(async () => {
        useTavernStore.setState((state) => ({ novels: state.novels.map((novel) => novel.id === id ? { ...novel, worldEra: '修改为高中时代' } : novel) }));
        return { content: '基于过期设定的候选', tokens: 10 };
      });
      await expect(useTavernStore.getState().reviseNovelChapter(id, chapter.id)).rejects.toThrow('作品设定或前文已变化');
      expect(getNovel().chapters?.[0].content).toBe('用户刚写的新稿');
    } finally {
      for (const novel of useTavernStore.getState().novels) await enqueueNovelWrite(novel.id, async () => undefined);
      useTavernStore.setState({ databaseMode: 'pending' });
      raw.close();
    }
  });

  it('restores chapter history as a persisted draft with matching metadata and keeps backups across reloads', async () => {
    const raw = new DatabaseSync(':memory:');
    dbRef.current = {
      execAsync: async (sql: string) => raw.exec(sql),
      getFirstAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).get(...params) as T | null,
      getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as T[],
      runAsync: async (sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).run(...params),
      withTransactionAsync: async (task: () => Promise<void>) => {
        raw.exec('BEGIN');
        try { await task(); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    let transactionQueue: Promise<void> = Promise.resolve();
    dbRef.current.withExclusiveTransactionAsync = (task: (db: typeof dbRef.current) => Promise<void>) => {
      const transactionDb = dbRef.current;
      const operation = transactionQueue.catch(() => undefined).then(() => transactionDb.withTransactionAsync(() => task(transactionDb)));
      transactionQueue = operation;
      return operation;
    };
    await migrateDatabase(dbRef.current);
    const { useTavernStore } = await import('./tavern-store');
    const { enqueueNovelWrite } = await import('@/db/novel-write-repository');
    const { loadNovelStateDocuments } = await import('@/db/repositories/novel-state-documents');
    const template = useTavernStore.getState().novels[0];
    useTavernStore.setState({ databaseMode: 'sqlite' });
    const chapter = {
      id: 'rollback-chapter', index: 1, title: '原章名', content: '原正文',
      summary: '原摘要', goal: '原目标', status: 'final' as const, createdAt: 'now', updatedAt: 'now',
    };
    const id = useTavernStore.getState().createNovel({
      ...template, name: '章节回退测试', chapters: [chapter], chapterBackups: [], quickTravel: undefined,
    });
    const getNovel = () => useTavernStore.getState().novels.find((item) => item.id === id)!;
    try {
      useTavernStore.getState().backupNovelChapter(id, chapter.id);
      const backup = getNovel().chapterBackups![0];
      expect(backup).toMatchObject({ summary: chapter.summary, goal: chapter.goal });
      useTavernStore.getState().updateNovelChapter(id, chapter.id, {
        title: '新版', content: '新正文', summary: '新摘要', goal: '新目标',
      });
      // A confirmed chapter must become a new draft when restoring old text.
      useTavernStore.setState((state) => ({
        novels: state.novels.map((novel) => novel.id === id
          ? { ...novel, canonRevision: 7, chapters: novel.chapters!.map((item) => ({ ...item, status: 'final' as const })) }
          : novel),
      }));
      await useTavernStore.getState().rollbackNovelChapter(id, chapter.id, backup.id);
      expect(getNovel().chapters![0]).toMatchObject({
        title: chapter.title, content: chapter.content, summary: chapter.summary, goal: chapter.goal, status: 'draft',
      });
      expect(getNovel().canonRevision).toBe(7);
      await enqueueNovelWrite(id, async () => undefined);
      const stored = raw.prepare('SELECT title, content, status, json_extra FROM chapters WHERE id = ?').get(chapter.id)!;
      expect(stored).toMatchObject({ title: chapter.title, content: chapter.content, status: 'draft' });
      expect(JSON.parse(String(stored.json_extra))).toMatchObject({ summary: chapter.summary, goal: chapter.goal });
      const reloaded = await loadNovelStateDocuments(dbRef.current, id);
      expect(reloaded.chapterBackups).toEqual([backup]);

      // Pre-metadata backups remain usable, and cannot be applied to another chapter.
      useTavernStore.setState((state) => ({
        novels: state.novels.map((novel) => novel.id === id
          ? { ...novel, chapterBackups: [{ id: 'legacy', chapterId: chapter.id, title: '旧备份', content: '旧正文', createdAt: 'now' }] }
          : novel),
      }));
      const beforeWrongChapter = getNovel().chapters;
      await useTavernStore.getState().rollbackNovelChapter(id, 'other-chapter', 'legacy');
      expect(getNovel().chapters).toBe(beforeWrongChapter);
      await useTavernStore.getState().rollbackNovelChapter(id, chapter.id, 'legacy');
      expect(getNovel().chapters![0]).toMatchObject({
        title: '旧备份', content: '旧正文', summary: chapter.summary, goal: chapter.goal, status: 'draft',
      });
    } finally {
      for (const novel of useTavernStore.getState().novels) await enqueueNovelWrite(novel.id, async () => undefined);
      useTavernStore.setState({ databaseMode: 'pending' });
      raw.close();
    }
  });
});
