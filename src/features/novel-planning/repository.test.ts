import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPlanningSession, loadPlanningSession, savePlanningSession } from './repository';
import { createPlanningSession } from './domain';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async (key: string) => store.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }), removeItem: vi.fn(async (key: string) => { store.delete(key); }) } }));

describe('planning repository CAS', () => {
  beforeEach(() => store.clear());
  it('rejects same-revision collisions including pending state and stale revisions', async () => {
    const first = createPlanningSession({ kind: 'creation', id: 'cas' });
    await savePlanningSession(first, null);
    const withPending = { ...first, pending: { id: 't', prompt: 'x' } };
    await savePlanningSession(withPending, first);
    await expect(savePlanningSession({ ...first, pending: { id: 'other', prompt: 'y' } }, first)).rejects.toThrow(/已更新/);
    await savePlanningSession({ ...withPending, revision: 1 }, withPending);
    await expect(savePlanningSession(withPending, withPending)).rejects.toThrow(/已更新/);
  });
  it('throws for corrupt stored sessions instead of replacing them', async () => {
    const session = createPlanningSession({ kind: 'world', id: 'bad' });
    await savePlanningSession(session, null);
    const key = 'novel-planning-v1:world:bad'; store.set(key, '{broken');
    await expect(loadPlanningSession(session.scope)).rejects.toThrow();
    await expect(savePlanningSession(session, undefined)).rejects.toThrow();
    await clearPlanningSession(session.scope);
  });
});
