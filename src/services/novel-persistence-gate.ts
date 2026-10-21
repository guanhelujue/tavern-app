import type { StateStorage } from 'zustand/middleware';

type PendingWrite = {
  storage: StateStorage;
  value: string;
};

let suspendedRequests = 0;
const pendingWrites = new Map<string, PendingWrite>();
let flushChain: Promise<void> = Promise.resolve();
let activePersistenceWrites: Promise<void> = Promise.resolve();

const WEB_STORAGE_DATABASE = 'tavern-mobile-storage';
const WEB_STORAGE_OBJECT_STORE = 'zustand-state';

function openWebStorageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const request = indexedDB.open(WEB_STORAGE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WEB_STORAGE_OBJECT_STORE)) {
        request.result.createObjectStore(WEB_STORAGE_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked.'));
  });
}

/** Large browser snapshots belong in IndexedDB; localStorage is commonly capped at 5–10 MB. */
export function createIndexedDbStateStorage(): StateStorage {
  return {
    getItem: async (name) => {
      const database = await openWebStorageDatabase();
      try {
        return await new Promise<string | null>((resolve, reject) => {
          const transaction = database.transaction(WEB_STORAGE_OBJECT_STORE, 'readonly');
          const request = transaction.objectStore(WEB_STORAGE_OBJECT_STORE).get(name);
          let value: string | null = null;
          request.onsuccess = () => {
            value = typeof request.result === 'string' ? request.result : null;
          };
          request.onerror = () => reject(request.error ?? new Error('Unable to read IndexedDB.'));
          transaction.oncomplete = () => resolve(value);
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB read failed.'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB read aborted.'));
        });
      } finally {
        database.close();
      }
    },
    setItem: async (name, value) => {
      const database = await openWebStorageDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(WEB_STORAGE_OBJECT_STORE, 'readwrite');
          const request = transaction.objectStore(WEB_STORAGE_OBJECT_STORE).put(value, name);
          request.onerror = () => reject(request.error ?? new Error('Unable to write IndexedDB.'));
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed.'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted.'));
        });
      } finally {
        database.close();
      }
    },
    removeItem: async (name) => {
      const database = await openWebStorageDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(WEB_STORAGE_OBJECT_STORE, 'readwrite');
          const request = transaction.objectStore(WEB_STORAGE_OBJECT_STORE).delete(name);
          request.onerror = () => reject(request.error ?? new Error('Unable to delete IndexedDB value.'));
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB delete failed.'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB delete aborted.'));
        });
      } finally {
        database.close();
      }
    },
  };
}

/**
 * Web adapter that migrates the old AsyncStorage/localStorage snapshot on read.
 * New writes go to IndexedDB and only fall back when IndexedDB is unavailable.
 */
export function createWebNovelStateStorage(
  legacyStorage: StateStorage,
  indexedDbStorage: StateStorage = createIndexedDbStateStorage(),
): StateStorage {
  type Envelope = { marker: 'tavern-state'; revision: number; value: string };
  type Candidate = { value: string; revision: number; source: 'indexed' | 'legacy' };
  const writes = new Map<string, Promise<unknown>>();
  let revisionSeed = Date.now();
  const observedKeys = new Set<string>();

  const nextRevision = () => {
    revisionSeed = Math.max(Date.now(), revisionSeed + 1);
    return revisionSeed;
  };
  const encode = (value: string, revision: number) =>
    JSON.stringify({ marker: 'tavern-state', revision, value } satisfies Envelope);
  const decode = (raw: string | null, source: Candidate['source']): Candidate | null => {
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Envelope>;
      if (parsed.marker === 'tavern-state' && typeof parsed.revision === 'number' && Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 && typeof parsed.value === 'string') {
        revisionSeed = Math.max(revisionSeed, parsed.revision);
        return { value: parsed.value, revision: parsed.revision, source };
      }
    } catch {
      // Existing unwrapped snapshots remain readable and are older than envelopes.
    }
    return { value: raw, revision: 0, source };
  };
  const enqueueWrite = <T>(name: string, write: () => Promise<T>): Promise<T> => {
    const previous = writes.get(name) ?? Promise.resolve();
    const operation = previous.then(() => write(), () => write());
    writes.set(name, operation);
    operation.then(
      () => { if (writes.get(name) === operation) writes.delete(name); },
      () => { if (writes.get(name) === operation) writes.delete(name); },
    );
    return operation;
  };

  return {
    getItem: (name) => enqueueWrite(name, async () => {
      const [indexedResult, legacyResult] = await Promise.allSettled([
        indexedDbStorage.getItem(name),
        legacyStorage.getItem(name),
      ]);
      const indexed = indexedResult.status === 'fulfilled'
        ? decode(indexedResult.value, 'indexed') : null;
      const legacy = legacyResult.status === 'fulfilled'
        ? decode(legacyResult.value, 'legacy') : null;
      if (!indexed && !legacy) {
        if (indexedResult.status === 'rejected') throw indexedResult.reason;
        if (legacyResult.status === 'rejected') throw legacyResult.reason;
        return null;
      }
      observedKeys.add(name);
      const selected = indexed && legacy && legacy.revision > indexed.revision ? legacy : (indexed ?? legacy)!;
      try {
        if (selected.source === 'legacy') {
          await indexedDbStorage.setItem(name, encode(selected.value, selected.revision || nextRevision()));
          await legacyStorage.removeItem(name);
        } else if (legacy) {
          await legacyStorage.removeItem(name);
        }
      } catch {
        // Keep whichever readable copy remains if migration cleanup cannot complete.
      }
      return selected.value;
    }),
    setItem: (name, value) => enqueueWrite(name, async () => {
      if (!observedKeys.has(name)) {
        const existing = await Promise.allSettled([indexedDbStorage.getItem(name), legacyStorage.getItem(name)]);
        existing.forEach((result, index) => { if (result.status === 'fulfilled') decode(result.value, index === 0 ? 'indexed' : 'legacy'); });
        observedKeys.add(name);
      }
      const revision = nextRevision();
      try {
        await indexedDbStorage.setItem(name, encode(value, revision));
      } catch {
        await legacyStorage.setItem(name, encode(value, revision));
      }
    }),
    removeItem: (name) => enqueueWrite(name, async () => {
      const results = await Promise.allSettled([
        indexedDbStorage.removeItem(name),
        legacyStorage.removeItem(name),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
        throw failed.reason;
      }
    }),
  };
}

function trackPersistenceWrite(write: () => Promise<unknown>): Promise<void> {
  const operation = activePersistenceWrites.catch(() => undefined).then(async () => { await write(); });
  activePersistenceWrites = operation;
  // Keep the rejection observable by explicit saves without an unhandled
  // rejection when Zustand's synchronous setState ignores the returned promise.
  void operation.catch(() => undefined);
  return operation;
}

export function suspendNovelPersistence() { suspendedRequests += 1; }

export function resumeNovelPersistence() {
  suspendedRequests = Math.max(0, suspendedRequests - 1);
  if (suspendedRequests === 0) void flushPendingNovelPersistence().catch(() => undefined);
}

export function flushPendingNovelPersistence(): Promise<void> {
  const writes = [...pendingWrites.entries()];
  pendingWrites.clear();
  if (!writes.length) return activePersistenceWrites;
  flushChain = trackPersistenceWrite(async () => {
    for (let index = 0; index < writes.length; index += 1) {
      const [name, write] = writes[index];
      try { await write.storage.setItem(name, write.value); }
      catch (error) {
        for (const [remainingName, remaining] of writes.slice(index)) {
          if (!pendingWrites.has(remainingName)) pendingWrites.set(remainingName, remaining);
        }
        throw error;
      }
    }
  });
  return flushChain;
}

export function waitForNovelPersistence(): Promise<void> {
  return flushPendingNovelPersistence();
}

/** Explicit save supersedes any older deferred snapshot, even during another stream. */
export function commitNovelPersistence(storage: StateStorage, name: string, value: string): Promise<void> {
  pendingWrites.delete(name);
  return trackPersistenceWrite(async () => { await storage.setItem(name, value); });
}

export function createNovelPersistenceGate(storage: StateStorage): StateStorage {
  return {
    getItem: (name) => storage.getItem(name),
    removeItem: (name) => {
      pendingWrites.delete(name);
      return trackPersistenceWrite(async () => { await storage.removeItem(name); });
    },
    setItem: (name, value) => {
      if (suspendedRequests > 0) {
        pendingWrites.set(name, { storage, value });
        return;
      }
      pendingWrites.delete(name);
      return trackPersistenceWrite(async () => { await storage.setItem(name, value); });
    },
  };
}
