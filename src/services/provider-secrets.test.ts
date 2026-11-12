import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeProviderApiKey, saveImageProviderApiKey, saveProviderApiKey } from './provider-secrets';

const storage = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(),
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => storage);
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.isAvailableAsync.mockResolvedValue(true);
});

describe('provider secret write ordering', () => {
  it('keeps the latest key when an earlier write is slow', async () => {
    const firstWrite = deferred();
    let persisted = '';
    storage.setItemAsync.mockImplementation(async (_key: string, value: string) => {
      if (value === 'old') await firstWrite.promise;
      persisted = value;
    });
    const first = saveProviderApiKey('ordered', 'old');
    const second = saveProviderApiKey('ordered', 'new');
    await vi.waitFor(() => expect(storage.setItemAsync).toHaveBeenCalled());
    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(persisted).toBe('new');
  });

  it('does not resurrect a key after its provider is deleted', async () => {
    const firstWrite = deferred();
    let persisted: string | undefined;
    storage.setItemAsync.mockImplementation(async (_key: string, value: string) => {
      await firstWrite.promise;
      persisted = value;
    });
    storage.deleteItemAsync.mockImplementation(async () => { persisted = undefined; });
    const write = saveProviderApiKey('deleted', 'secret');
    const remove = removeProviderApiKey('deleted');
    await vi.waitFor(() => expect(storage.setItemAsync).toHaveBeenCalled());
    firstWrite.resolve();
    await Promise.all([write, remove]);
    expect(persisted).toBeUndefined();
  });

  it('allows another save after a failed write', async () => {
    storage.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce(undefined);
    const failed = saveProviderApiKey('retry', 'old').catch((error: unknown) => error);
    const saved = saveProviderApiKey('retry', 'new');
    expect(await failed).toBeInstanceOf(Error);
    await saved;
    expect(storage.setItemAsync).toHaveBeenLastCalledWith(expect.any(String), 'new');
  });

  it('does not block image keys behind a slow text-provider write', async () => {
    const firstWrite = deferred();
    storage.setItemAsync.mockImplementation(async (_key: string, value: string) => {
      if (value === 'text-key') await firstWrite.promise;
    });
    const textWrite = saveProviderApiKey('shared', 'text-key');
    await saveImageProviderApiKey('shared', 'image-key');
    expect(storage.setItemAsync).toHaveBeenCalledWith(expect.any(String), 'image-key');
    firstWrite.resolve();
    await textWrite;
  });
});
