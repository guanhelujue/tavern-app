import { describe, expect, it } from 'vitest';
import { applyMemoryPatch, buildPlanningContext, createPlanningSession, undoPlanningMemory } from './domain';

describe('planning memory', () => {
  it('compiles only the current facts after repeated corrections without losing untouched details', () => {
    let state = createPlanningSession({ kind: 'creation', id: 'revision-story' });
    state = applyMemoryPatch(state, { add: [
      { id: 'sects', text: '七个宗门统治世界', status: 'confirmed' },
      { id: 'cost', text: '修炼消耗寿命', status: 'confirmed' },
    ] }, 0);
    state = applyMemoryPatch(state, { update: [{ id: 'sects', text: '三个宗门统治世界' }] }, 1);
    state = applyMemoryPatch(state, { add: [{ id: 'hero', text: '主角来自没落宗门', status: 'confirmed' }] }, 2);
    const compiled = buildPlanningContext(state, true);
    expect(compiled).toContain('三个宗门');
    expect(compiled).toContain('修炼消耗寿命');
    expect(compiled).toContain('主角来自没落宗门');
    expect(compiled).not.toContain('七个宗门');
    expect(state.history[1].items[0].text).toContain('七个宗门');
  });
  it('supports the exact UI add/edit/confirm/discard operation format', () => {
    let state = createPlanningSession({ kind: 'creation', id: 'ui' });
    state = applyMemoryPatch(state, { operations: [{ op: 'add', id: 'rule', text: '七宗', status: 'confirmed' }] }, 0);
    state = applyMemoryPatch(state, { operations: [{ op: 'update', id: 'rule', text: '三宗', status: 'confirmed' }] }, 1);
    expect(state.items[0].text).toBe('三宗');
    state = applyMemoryPatch(state, { operations: [{ op: 'update', id: 'rule', status: 'discarded' }] }, 2);
    expect(buildPlanningContext(state)).not.toContain('三宗');
    expect(() => applyMemoryPatch(state, { update: [{ id: 'rule', text: '四宗' }], discard: ['rule'] }, 3)).toThrow('重复');
  });
  it('preserves omitted items and rejects stale patches atomically', () => {
    const start = createPlanningSession({ kind: 'creation', id: 'a' }, '海港');
    const next = applyMemoryPatch(start, { add: [{ id: 'rule', text: '潮汐会抹除记忆', status: 'confirmed', sourceTurnId: 't1' }] }, 0);
    expect(next.items.map((item) => item.id)).toEqual(['seed', 'rule']);
    expect(() => applyMemoryPatch(next, { discard: ['rule'], update: [{ id: 'missing', text: 'x' }] }, 1)).toThrow();
    expect(next.items.find((item) => item.id === 'rule')?.status).toBe('confirmed');
    expect(() => applyMemoryPatch(next, { discard: ['rule'] }, 0)).toThrow(/已更新/);
  });
  it('supports explicit discard, undo, and generation context filtering', () => {
    let session = createPlanningSession({ kind: 'world', id: 'w' });
    session = applyMemoryPatch(session, { add: [{ id: 'c', text: '候选', status: 'candidate' }, { id: 'q', text: '待定', status: 'question' }, { id: 'f', text: '确定', status: 'confirmed' }] }, 0);
    expect(buildPlanningContext(session, true)).toContain('确定');
    expect(buildPlanningContext(session, true)).not.toContain('候选');
    session = applyMemoryPatch(session, { discard: ['f'] }, 1);
    expect(buildPlanningContext(session)).not.toContain('确定');
    session = undoPlanningMemory(session);
    expect(session.items.find((item) => item.id === 'f')?.status).toBe('confirmed');
  });
});
