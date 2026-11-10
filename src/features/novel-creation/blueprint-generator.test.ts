import { describe, expect, it, vi } from 'vitest';

import { requestCompletionWithUsage } from '../../services/llm';
import type { ApiSettings } from '../../types/tavern';
import { buildBlueprintSystemPrompt, generateBlueprintProposals, normalizeBlueprintProposals } from './blueprint-generator';

vi.mock('../../services/llm', () => ({ requestCompletionWithUsage: vi.fn() }));

const apiSettings: ApiSettings = {
  baseUrl: 'https://example.invalid', apiKey: 'test-key', model: 'test-model',
  temperature: 0.8, maxTokens: 4000, contextWindowMessages: 20,
  streamingEnabled: false, requestTimeoutMs: 30_000, requestRetryCount: 0,
  debugPromptInspectorEnabled: false, replyLengthPreset: 'normal', continuationOnTruncation: false,
};

const longBlueprint = {
  title: '潮汐失语症', premise: '每次退潮，全城都会忘记一个人。',
  protagonist: { identity: '档案员', desire: '保存妹妹存在过的证据', obstacle: '记忆规则会反噬记录者' },
  setting: '记忆随潮汐消退的海港城。', stakes: '主角也会失去最重要的记忆。',
  opening: '妹妹的户籍在主角眼前变成白纸。', direction: '从私人拯救走向全城记忆权的争夺。',
  tone: '潮湿、克制', constraints: [],
  longForm: {
    engine: '每次潮汐都会抹除不同群体的记忆，而保存记忆会改变城市权力和人物关系。',
    arcs: ['保存妹妹并发现潮汐规则的代价', '争夺档案权并引发城市阵营分裂', '决定谁有权定义全城的共同记忆'],
    openThreads: ['妹妹消失的真正原因', '旧档案馆被封存的实验记录', '主角童年记忆被谁改写'],
  },
};

describe('normalizeBlueprintProposals', () => {
  it('rejects a one-shot demo premise without a renewable long-form engine', () => {
    const proposals = normalizeBlueprintProposals({
      blueprints: [{
        title: '最后一班电车',
        premise: '末班电车上的乘客发现司机已经死去。',
        protagonist: {
          identity: '夜班护士',
          desire: '让电车安全停下',
          obstacle: '列车无法减速，乘客互相猜疑',
        },
        setting: '封闭的夜间电车。',
        stakes: '所有乘客会死亡。',
        opening: '主角敲开驾驶室，发现司机已经死亡。',
        direction: '查明真相并让列车停下。',
        tone: '悬疑紧张',
        constraints: [],
      }],
    });

    expect(proposals).toEqual([]);
  });

  it('accepts a proposal with a renewable engine, three arcs, and three open threads', () => {
    const proposals = normalizeBlueprintProposals({
      blueprints: [{
        title: '潮汐失语症',
        premise: '每次退潮，全城都会忘记一个人。',
        protagonist: { identity: '档案员', desire: '保存妹妹存在过的证据', obstacle: '记忆规则会反噬记录者' },
        setting: '记忆随潮汐消退的海港城。',
        stakes: '主角也会失去最重要的记忆。',
        opening: '妹妹的户籍在主角眼前变成白纸。',
        direction: '从私人拯救走向全城记忆权的争夺。',
        tone: '潮湿、克制',
        constraints: [],
        longForm: {
          engine: '每次潮汐都会抹除不同群体的记忆，而保存记忆会改变城市权力和人物关系。',
          arcs: ['保存妹妹并发现规则', '争夺档案权并引发城市分裂', '决定谁有权定义共同记忆'],
          openThreads: ['妹妹消失的原因', '旧档案馆的秘密', '主角被篡改的童年'],
        },
      }],
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].longForm.arcs).toHaveLength(3);
  });

  it('rejects generic filler that only labels three acts without concrete runway', () => {
    const proposals = normalizeBlueprintProposals({
      blueprints: [{
        title: '升级之路', premise: '主角踏上冒险。',
        protagonist: { identity: '冒险者', desire: '变强', obstacle: '敌人很多' },
        setting: '幻想世界', stakes: '会失败', opening: '遇到第一个敌人', direction: '最终获胜', tone: '热血', constraints: [],
        longForm: {
          engine: '主角会不断遇到新的挑战并逐步升级',
          arcs: ['初期冒险', '中期升级', '最终决战'],
          openThreads: ['身世', '敌人', '伙伴'],
        },
      }],
    });
    expect(proposals).toEqual([]);
  });

  it('asks the model for novel-scale carrying capacity instead of a one-shot hook', () => {
    const prompt = buildBlueprintSystemPrompt();
    expect(prompt).toContain('80–200 章');
    expect(prompt).toContain('可再生的故事引擎');
    expect(prompt).toContain('3–5 个卷级阶段');
    expect(prompt).toContain('至少 3 条');
  });

  it('retries once when the first model response lacks novel-scale capacity', async () => {
    const request = vi.mocked(requestCompletionWithUsage);
    request.mockReset();
    request
      .mockResolvedValueOnce({ content: JSON.stringify({ blueprints: [{
        title: '短梗', premise: '解决一件事。', protagonist: { identity: '路人', desire: '脱困', obstacle: '门锁了' },
        setting: '密室', stakes: '迟到', opening: '门锁了', direction: '打开门', tone: '紧张', constraints: [],
      }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({
        blueprints: [0, 1, 2].map((index) => ({ ...longBlueprint, title: `${longBlueprint.title}${index + 1}` })),
      }) });

    const proposals = await generateBlueprintProposals({ apiSettings, seed: '海港与失忆', maxTokens: 4000 });
    expect(proposals).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].messages.at(-1)?.content).toContain('未达到长篇承载标准');
  });
});
