import { describe, expect, it, vi } from 'vitest';

import {
  commitNovelPersistence,
  createWebNovelStateStorage,
  createNovelPersistenceGate,
  resumeNovelPersistence,
  suspendNovelPersistence,
  waitForNovelPersistence,
} from './novel-persistence-gate';

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: vi.fn(async (name: string) => values.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      values.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => {
      values.delete(name);
    }),
  };
}

describe('web novel persistence storage', () => {
  it('bypasses quota-limited AsyncStorage for new large snapshots', async () => {
    const quotaError = new Error("Failed to execute 'setItem' on 'Storage': exceeded the quota");
    quotaError.name = 'QuotaExceededError';
    const legacy = memoryStorage();
    legacy.setItem.mockRejectedValue(quotaError);
    const indexedDb = memoryStorage();
    const storage = createWebNovelStateStorage(legacy, indexedDb);
    const largeSnapshot = `data:image/png;base64,${'A'.repeat(6_000_000)}`;

    await expect(storage.setItem('tavern-mobile-store-v1', largeSnapshot)).resolves.toBeUndefined();
    const encoded = indexedDb.setItem.mock.calls[0][1] as string;
    expect(JSON.parse(encoded)).toMatchObject({ marker: 'tavern-state', value: largeSnapshot });
    expect(legacy.setItem).not.toHaveBeenCalled();
  });

  it('migrates an existing legacy snapshot into IndexedDB on first read', async () => {
    const legacy = memoryStorage({ 'tavern-mobile-store-v1': '{"state":{"novels":[]}}' });
    const indexedDb = memoryStorage();
    const storage = createWebNovelStateStorage(legacy, indexedDb);

    await expect(storage.getItem('tavern-mobile-store-v1'))
      .resolves.toBe('{"state":{"novels":[]}}');
    const encoded = indexedDb.setItem.mock.calls[0][1] as string;
    expect(JSON.parse(encoded)).toMatchObject({ marker: 'tavern-state', value: '{"state":{"novels":[]}}' });
    expect(legacy.removeItem).toHaveBeenCalledWith('tavern-mobile-store-v1');
  });

  it('reads the fallback snapshot after IndexedDB failed in a previous adapter', async () => {
    const oldPrimary = memoryStorage({ 'store': '{"version":"old"}' });
    const legacy = memoryStorage();
    const first = createWebNovelStateStorage(legacy, oldPrimary);
    oldPrimary.setItem.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await first.setItem('store', '{"version":"new"}');

    const second = createWebNovelStateStorage(legacy, oldPrimary);
    await expect(second.getItem('store')).resolves.toBe('{"version":"new"}');
  });

  it('does not let a stale fallback mask a later primary write', async () => {
    const indexedDb = memoryStorage();
    const legacy = memoryStorage();
    const first = createWebNovelStateStorage(legacy, indexedDb);
    indexedDb.setItem.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await first.setItem('store', 'new-fallback');

    const second = createWebNovelStateStorage(legacy, indexedDb);
    await second.setItem('store', 'new-primary');
    // A fresh adapter must still observe the primary envelope, not the old fallback.
    await expect(createWebNovelStateStorage(legacy, indexedDb).getItem('store'))
      .resolves.toBe('new-primary');
  });

  it('throws when both primary and fallback writes fail', async () => {
    const primary = memoryStorage();
    const legacy = memoryStorage();
    primary.setItem.mockRejectedValue(new Error('primary failed'));
    legacy.setItem.mockRejectedValue(new Error('fallback failed'));
    await expect(createWebNovelStateStorage(legacy, primary).setItem('store', 'value'))
      .rejects.toThrow('fallback failed');
  });

  it('serializes same-key writes so an earlier slow write cannot finish last', async () => {
    const indexedDb = memoryStorage();
    const legacy = memoryStorage();
    const originalSet = indexedDb.setItem.getMockImplementation()!;
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstReady = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    indexedDb.setItem
      .mockImplementationOnce(async (name, value) => {
        firstStarted();
        await firstRelease;
        await originalSet(name, value);
      })
      .mockImplementation(originalSet);
    const storage = createWebNovelStateStorage(legacy, indexedDb);
    const first = storage.setItem('store', 'first');
    await firstReady;
    const second = storage.setItem('store', 'second');
    expect(indexedDb.setItem).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);
    await expect(storage.getItem('store')).resolves.toBe('second');
  });

  it('serializes migration reads with an overlapping write', async () => {
    const indexedDb = memoryStorage({ store: JSON.stringify({ marker: 'tavern-state', revision: 1, value: 'old' }) });
    const legacy = memoryStorage();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const originalGet = indexedDb.getItem.getMockImplementation()!;
    indexedDb.getItem.mockImplementationOnce(async (name) => {
      await readGate;
      return originalGet(name);
    });
    const storage = createWebNovelStateStorage(legacy, indexedDb);
    const read = storage.getItem('store');
    const write = storage.setItem('store', 'new');
    releaseRead();
    await expect(read).resolves.toBe('old');
    await write;
    await expect(storage.getItem('store')).resolves.toBe('new');
  });

  it('prefers a future legacy revision and never masks it with an older primary copy', async () => {
    const indexedDb = memoryStorage({ store: JSON.stringify({ marker: 'tavern-state', revision: 4, value: 'primary' }) });
    const legacy = memoryStorage({ store: JSON.stringify({ marker: 'tavern-state', revision: 9, value: 'future' }) });
    const storage = createWebNovelStateStorage(legacy, indexedDb);
    await expect(storage.getItem('store')).resolves.toBe('future');
    await expect(createWebNovelStateStorage(legacy, indexedDb).getItem('store')).resolves.toBe('future');
  });

  it('rejects deletion when either adapter copy fails', async () => {
    const indexedDb = memoryStorage();
    const legacy = memoryStorage();
    indexedDb.removeItem.mockRejectedValue(new Error('primary delete failed'));
    await expect(createWebNovelStateStorage(legacy, indexedDb).removeItem('store'))
      .rejects.toThrow('primary delete failed');
  });

  it('keeps non-suspended write failures observable and recovers on the next write', async () => {
    const storage = memoryStorage();
    const gate = createNovelPersistenceGate(storage);
    storage.setItem.mockRejectedValueOnce(new Error('write failed'));
    await expect(gate.setItem('retry', 'first')).rejects.toThrow('write failed');
    await expect(waitForNovelPersistence()).rejects.toThrow('write failed');
    await expect(gate.setItem('retry', 'second')).resolves.toBeUndefined();
    await expect(gate.getItem('retry')).resolves.toBe('second');
  });

  it('retains suspended values after a failed flush and retries them successfully', async () => {
    const storage = memoryStorage();
    const gate = createNovelPersistenceGate(storage);
    suspendNovelPersistence();
    await gate.setItem('queued', 'value');
    storage.setItem.mockRejectedValueOnce(new Error('flush failed'));
    resumeNovelPersistence();
    await expect(waitForNovelPersistence()).rejects.toThrow('flush failed');
    await expect(waitForNovelPersistence()).resolves.toBeUndefined();
    await expect(gate.getItem('queued')).resolves.toBe('value');
  });

  it('commit supersedes an older pending snapshot and resume cannot roll it back', async () => {
    const storage = memoryStorage();
    const gate = createNovelPersistenceGate(storage);
    suspendNovelPersistence();
    await gate.setItem('snapshot', 'old');
    await commitNovelPersistence(storage, 'snapshot', 'new');
    resumeNovelPersistence();
    await waitForNovelPersistence();
    await expect(gate.getItem('snapshot')).resolves.toBe('new');
  });
});
