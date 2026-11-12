import { describe, expect, it } from 'vitest';

import { requestOutlineTextRevision } from '@/services/novel-outline-assistant';
import { buildLegacyNovelInput } from '@/features/novel-creation/legacy-novel-adapter';
import type { StoryBlueprint } from '@/features/novel-creation/domain';
import type { ApiSettings, Novel, NovelOutline } from '@/types/tavern';

function apiSettings(): ApiSettings {
  return {
    baseUrl: 'https://example.test', apiKey: 'test', model: 'test-model', temperature: 0.3,
    maxTokens: 2000, contextWindowMessages: 20, streamingEnabled: false,
    requestTimeoutMs: 1000, requestRetryCount: 0, debugPromptInspectorEnabled: false,
    replyLengthPreset: 'normal', continuationOnTruncation: false,
  };
}

function novel(): Novel {
  const blueprint: StoryBlueprint = {
    id: 'novel-1', title: '高中灵异故事', premise: '沈砚和陆昭回到高中', setting: '灵异高中·现代校园',
    protagonist: { identity: '捉鬼师', desire: '查明真相', obstacle: '鬼王残魂' }, stakes: '最后告别', opening: '返校', direction: '双世界线与残魂宿命', tone: '', constraints: [],
    longForm: { engine: '双世界线', arcs: [], openThreads: [] },
  };
  return {
    id: 'novel-1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...buildLegacyNovelInput({ blueprint, promptDefaults: { systemPrompt: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '' } }),
    outline: {
      summary: '原来的全书主线', updatedAt: '2026-01-01T00:00:00.000Z', volumes: [{
        id: 'v1', title: '高中日常', summary: '原卷纲', chapters: [{ index: 1, title: '第一章', goal: '返校', sceneEnd: false }],
        plannedChapterCount: 15, wordsPerChapter: 1800, handoff: { incoming: '开篇' },
      }],
    },
  };
}

describe('requestOutlineTextRevision', () => {
  it('revises only volume metadata and never mutates the source outline', async () => {
    const source = novel();
    const outline: NovelOutline = source.outline!;
    const before = JSON.stringify(outline);
    const result = await requestOutlineTextRevision({
      novel: source, outline, volume: outline.volumes[0], apiSettings: apiSettings(), instruction: '强化前十五章的校园喜剧节奏。',
      requestCompletion: async ({ messages }) => {
        expect(messages[0].content).toContain('只修改当前卷');
        expect(messages[0].content).toContain('原来的全书主线');
        expect(messages[0].content).toContain('当前创作设定');
        return { content: JSON.stringify({ volume: {
          title: '高中日常', summary: '陆昭带着好奇心重返校园，笑料中埋下异常。', tone: '轻松搞笑',
          foreshadowing: '只呈现零星异常', outgoing: '两人开始追查异常',
          chapters: [{ index: 99, title: '越权章节', goal: '覆盖原章节', sceneEnd: true }],
          plannedChapterCount: 999, handoff: { incoming: '越权输入交接' },
        } }), promptTokens: 100, completionTokens: 40 };
      },
    });
    expect(JSON.stringify(outline)).toBe(before);
    expect(result.outline.summary).toBe('原来的全书主线');
    expect(result.outline.volumes[0].chapters).toEqual(outline.volumes[0].chapters);
    expect(result.outline.volumes[0].plannedChapterCount).toBe(15);
    expect(result.outline.volumes[0].handoff?.incoming).toBe('开篇');
    expect(result.outline.volumes[0].summary).toContain('陆昭');
    expect(result.tokens).toBe(140);
  });

  it('revises only whole-book summary and rejects an empty response', async () => {
    const source = novel();
    const outline: NovelOutline = source.outline!;
    const result = await requestOutlineTextRevision({
      novel: source, outline, apiSettings: apiSettings(), instruction: '让双世界线的宿命感更清楚。',
      requestCompletion: async () => ({ content: '{"summary":"新的双世界线主线"}' }),
    });
    expect(result.outline.summary).toBe('新的双世界线主线');
    expect(result.outline.volumes).toEqual(outline.volumes);
    await expect(requestOutlineTextRevision({
      novel: source, outline, apiSettings: apiSettings(), instruction: '请修改',
      requestCompletion: async () => ({ content: '' }),
    })).rejects.toThrow('没有返回');
    await expect(requestOutlineTextRevision({
      novel: source, outline, apiSettings: apiSettings(), instruction: '请修改',
      requestCompletion: async () => ({ content: '这不是 JSON' }),
    })).rejects.toThrow('有效 JSON');
    await expect(requestOutlineTextRevision({
      novel: source, outline, apiSettings: apiSettings(), instruction: '请修改',
      requestCompletion: async () => ({ content: '{"summary":""}' }),
    })).rejects.toThrow('主线为空');
  });
});
