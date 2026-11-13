import { describe, expect, it, vi } from 'vitest';
import { requestPlanningReply, updatePlanningMemory, generatePlanningFields } from './generator';
import { createPlanningSession, type PlanningSession } from './domain';
import { requestCompletionWithUsage, requestPlainCompletion } from '../../services/llm';

vi.mock('../../services/llm', () => ({ requestCompletionWithUsage: vi.fn(), requestPlainCompletion: vi.fn() }));
const apiSettings = { maxTokens: 1000 } as any;

describe('planning generator', () => {
  it('refuses final conversion while a turn has unsynchronized memory', async () => {
    const session = { ...createPlanningSession({ kind: 'creation', id: 'pending' }), pending: { id: 't1', prompt: '改成三个宗门' } };
    await expect(generatePlanningFields({ apiSettings, session, targetInstructions: '字段 title', maxTokens: 500 })).rejects.toThrow('尚未更新');
  });
  it('sends upper context together with memory and does not send transcript', async () => {
    vi.mocked(requestPlainCompletion).mockResolvedValue('自然语言回复');
    const session = createPlanningSession({ kind: 'world', id: 'w' }, '确认规则');
    await requestPlanningReply({ apiSettings, session, context: '全书只读设定', prompt: '继续', maxTokens: 500 });
    const req = vi.mocked(requestPlainCompletion).mock.calls.at(-1)![0];
    expect(req.messages[0].content).toContain('全书只读设定'); expect(req.messages[0].content).toContain('确认规则');
    expect(req.messages[0].content).not.toContain('messages');
  });
  it('updates only memory and preserves existing messages', async () => {
    vi.mocked(requestCompletionWithUsage).mockResolvedValue({ content: '{"add":[{"id":"x","text":"新设定","status":"confirmed","sourceTurnId":"t"}]}' } as any);
    const session: PlanningSession = { ...createPlanningSession({ kind: 'creation', id: 'c' }), messages: [{ id: 't-user', role: 'user', content: 'x' }] };
    const next = await updatePlanningMemory({ apiSettings, session, prompt: 'x', reply: '好', turnId: 't', maxTokens: 500 });
    expect(next.messages).toEqual(session.messages); expect(next.items.some((item) => item.text === '新设定')).toBe(true);
    expect(vi.mocked(requestCompletionWithUsage).mock.calls.at(-1)![0].responseFormat).toBe('json');
  });
  it('generates from confirmed items only', async () => {
    vi.mocked(requestCompletionWithUsage).mockResolvedValue({ content: '{"title":"x"}' } as any);
    let session = createPlanningSession({ kind: 'creation', id: 'c' });
    session = { ...session, items: [{ id: 'a', text: '确定', status: 'confirmed', sourceTurnId: 't' }, { id: 'b', text: '候选', status: 'candidate', sourceTurnId: 't' }] };
    await generatePlanningFields({ apiSettings, session, targetInstructions: '字段 title', maxTokens: 500 });
    const req = vi.mocked(requestCompletionWithUsage).mock.calls.at(-1)![0];
    expect(req.messages[1].content).toContain('确定'); expect(req.messages[1].content).not.toContain('候选');
  });
});
