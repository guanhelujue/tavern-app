import { describe, expect, it, vi } from 'vitest';
import { createPlanningSession, applyMemoryPatch } from './domain';
import { completePlanningTurn } from './turn';

describe('durable planning turn', () => {
  it('retries memory without repeating the reply or losing the pending user turn', async () => {
    let saved = { ...createPlanningSession({ kind: 'creation', id: 'test' }), pending: { id: 't1', prompt: '三个宗门' } } as ReturnType<typeof createPlanningSession>;
    const reply = vi.fn(async () => '可以，三个宗门之间可以有怎样的关系？');
    const remember = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (session) => applyMemoryPatch(session, { add: [{ id: 'sects', text: '三个宗门', status: 'confirmed' }] }, session.revision));
    const ports = { reply, remember, save: async (session: typeof saved) => { saved = session; } };
    await expect(completePlanningTurn(saved, ports)).rejects.toThrow('offline');
    expect(saved.pending?.reply).toContain('三个宗门');
    expect(saved.messages).toHaveLength(1);
    await completePlanningTurn(saved, ports);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(saved.pending).toBeUndefined();
    expect(saved.messages).toHaveLength(1);
    expect(saved.items[0].text).toBe('三个宗门');
  });

  it('does not advance memory when persisting the reply fails', async () => {
    const state = { ...createPlanningSession({ kind: 'creation', id: 'test' }), pending: { id: 't1', prompt: '想法' } };
    const remember = vi.fn();
    await expect(completePlanningTurn(state, { reply: async () => '建议', remember, save: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(remember).not.toHaveBeenCalled();
    expect(state.pending).toEqual({ id: 't1', prompt: '想法' });
  });
});
