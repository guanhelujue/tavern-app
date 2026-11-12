import { describe, expect, it, vi } from 'vitest';
import { getLorePlanningDraftId } from './lore-draft';

const values = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); },
} }));

describe('new lore planning continuity', () => {
  it('resumes an unfinished conversation and starts a new one after application', async () => {
    const first = await getLorePlanningDraftId('book', 'places', []);
    expect(await getLorePlanningDraftId('book', 'places', [])).toBe(first);
    expect(await getLorePlanningDraftId('other-book', 'places', [])).not.toBe(first);
    expect(await getLorePlanningDraftId('book', 'places', [first])).not.toBe(first);
  });
});
