import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimAppOpeningSequence,
  resetAppOpeningSequenceForTests,
  type OpeningSessionStorage,
} from './app-opening-state';

function createStorage(initialValue: string | null = null): OpeningSessionStorage {
  const values = new Map<string, string>();
  if (initialValue) values.set('tavern-opening-sequence-seen-v1', initialValue);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
  };
}

describe('app opening sequence session gate', () => {
  beforeEach(() => resetAppOpeningSequenceForTests());

  it('allows the full opening only once in the same process', () => {
    expect(claimAppOpeningSequence()).toBe(true);
    expect(claimAppOpeningSequence()).toBe(false);
  });

  it('does not replay after a web document reload in the same session', () => {
    const storage = createStorage('seen');
    expect(claimAppOpeningSequence(storage)).toBe(false);
  });

  it('records the first web play for later reloads', () => {
    const storage = createStorage();
    expect(claimAppOpeningSequence(storage)).toBe(true);
    resetAppOpeningSequenceForTests();
    expect(claimAppOpeningSequence(storage)).toBe(false);
  });
});
