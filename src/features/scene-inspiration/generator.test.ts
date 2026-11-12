import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestPlainCompletion } from '../../services/llm';
import type { ApiSettings, Novel } from '../../types/tavern';
import {
  buildSceneInspirationSystemPrompt,
  isChapterContinuationIntent,
  requestSceneInspirationReply,
  trimInspirationHistory,
} from './generator';

vi.mock('../../services/llm', () => ({ requestPlainCompletion: vi.fn() }));

const novel = {
  name: '沧海问剑',
  worldName: '九州',
  worldEra: '宗门林立，秘境每十年开启一次。',
  gameRules: '作者约束：每章必须有具体行动。',
  cast: [{ name: '沈砚', profession: '学生', age: '17', personality: '克制', motive: '查明真相' }],
  outline: { volumes: [{ chapters: [{ index: 1, title: '入局', goal: '发现异常' }] }] },
  chapters: [{ index: 1, title: '开端', summary: '主角发现旧桥异象。', status: 'final' }],
} as unknown as Novel;

describe('scene inspiration request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('injects the world and keeps the user prompt in charge', () => {
    const prompt = buildSceneInspirationSystemPrompt(novel, {
      jailbreakEnabled: true,
      jailbreakPrompt: '作者提示词必须保留。',
      modEnabled: true,
      modPrompt: '每次提供三个剧情思路。',
    });
    expect(prompt).toContain('宗门林立');
    expect(prompt).toContain('用户的提示词是主要要求');
    expect(prompt).toContain('作者提示词必须保留。');
    expect(prompt).toContain('每次提供三个剧情思路。');
    expect(prompt).not.toContain('年龄');
  });

  it('omits disabled extensions even when their saved text is nonempty', () => {
    const prompt = buildSceneInspirationSystemPrompt(novel, {
      jailbreakEnabled: false, jailbreakPrompt: 'DISABLED_AUTHOR_TEXT',
      modEnabled: false, modPrompt: 'DISABLED_MOD_TEXT',
    });
    expect(prompt).not.toContain('DISABLED_');
    expect(prompt).not.toContain('【破限词】');
    expect(prompt).not.toContain('【MOD】');
    expect(prompt).not.toContain('SFW');
  });

  it('sends bounded recent history in continuous mode and keeps the current prompt once', async () => {
    vi.mocked(requestPlainCompletion).mockResolvedValueOnce('可以让拍卖会的筹码是修为。');

    const reply = await requestSceneInspirationReply({
      apiSettings: { maxTokens: 3200 } as ApiSettings,
      novel,
      prompt: '给我一个特别的秘境竞争玩法。',
      history: [
        { id: 'u1', role: 'user', content: '先讨论秘境规则。' },
        { id: 'a1', role: 'assistant', content: '可以用筹码。' },
        { id: 'u2', role: 'user', content: '给我一个特别的秘境竞争玩法。' },
      ],
    });

    expect(reply).toBe('可以让拍卖会的筹码是修为。');
    expect(requestPlainCompletion).toHaveBeenCalledTimes(1);
    const request = vi.mocked(requestPlainCompletion).mock.calls[0]?.[0];
    expect(request?.messages).toHaveLength(4);
    expect(request?.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(request?.messages[1]?.content).toBe('先讨论秘境规则。');
    expect(request?.messages[3]?.content).toBe('给我一个特别的秘境竞争玩法。');
    expect(request?.messages[0]?.content).toContain('公开角色卡');
    expect(request?.messages[0]?.content).toContain('最近定稿摘要');
  });

  it('supports single-turn mode without history', async () => {
    vi.mocked(requestPlainCompletion).mockResolvedValueOnce('只看当前问题。');
    await requestSceneInspirationReply({ apiSettings: { maxTokens: 3200 } as ApiSettings, novel, prompt: '只回答当前问题', history: [{ id: 'x', role: 'assistant', content: '旧话题' }], continuity: 'single' });
    const request = vi.mocked(requestPlainCompletion).mock.calls[0]?.[0];
    expect(request?.messages).toHaveLength(2);
  });

  it('classifies continuation commands before making a model request', () => {
    expect(isChapterContinuationIntent('下一章')).toBe(true);
    expect(isChapterContinuationIntent('继续写正文！')).toBe(true);
    expect(isChapterContinuationIntent('帮我设计一个下一章的冲突')).toBe(false);
  });

  it('trims history by count and character budget', () => {
    const result = trimInspirationHistory(Array.from({ length: 20 }, (_, index) => ({ id: `${index}`, role: 'assistant' as const, content: 'x'.repeat(100) })), '当前', 3, 180);
    expect(result).toHaveLength(2);
    expect(result.every((message) => message.content.length <= 100)).toBe(true);
  });
});
