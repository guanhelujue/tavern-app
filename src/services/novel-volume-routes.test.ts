import { describe, expect, it } from 'vitest';
import { applyVolumeRouteToOutline, proposeNovelVolumeRoutes } from '@/services/novel-volume-routes';
import type { ApiSettings, Novel } from '@/types/tavern';

const settings: ApiSettings = { baseUrl: 'https://example.test', apiKey: 'test', model: 'test-model', temperature: .3, maxTokens: 2000, contextWindowMessages: 20, streamingEnabled: false, requestTimeoutMs: 1000, requestRetryCount: 0, debugPromptInspectorEnabled: false, replyLengthPreset: 'normal', continuationOnTruncation: false };
const novel = { id: 'n1', name: '测试作品', playerName: '', playerPersona: '', playerMotive: '', outline: { summary: '全书主线', updatedAt: '2026-01-01T00:00:00.000Z', volumes: [{ id: 'v1', title: '第一卷', summary: '当前卷', chapters: [] }, { id: 'v2', title: '第二卷', summary: '其他卷', chapters: [] }] } } as unknown as Novel;

describe('proposeNovelVolumeRoutes', () => {
  it('returns bounded candidates for the selected volume', async () => {
    const result = await proposeNovelVolumeRoutes({ novel, volume: novel.outline!.volumes[0], apiSettings: settings, requestCompletion: async ({ messages }) => {
      expect(messages[0].content).toContain('只讨论当前卷');
      return { content: JSON.stringify({ routes: [{ title: '暗线', summary: '推进暗线', turningPoint: '发现线索', risk: '节奏变慢', endingState: '进入追查' }, { title: '冲突', summary: '正面对抗', turningPoint: '盟友倒戈', risk: '代价上升', endingState: '关系破裂' }] }), promptTokens: 10, completionTokens: 20 };
    } });
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0].title).toBe('暗线');
    expect(result.routes[0].summary).toBe('推进暗线');
    expect(result.tokens).toBe(30);
  });

  it('rejects empty and malformed responses', async () => {
    await expect(proposeNovelVolumeRoutes({ novel, volume: novel.outline!.volumes[0], apiSettings: settings, requestCompletion: async () => ({ content: '' }) })).rejects.toThrow('没有返回');
    await expect(proposeNovelVolumeRoutes({ novel, volume: novel.outline!.volumes[0], apiSettings: settings, requestCompletion: async () => ({ content: 'bad' }) })).rejects.toThrow('有效 JSON');
  });

  it('keeps a complete route when a later sibling is incomplete', async () => {
    const result = await proposeNovelVolumeRoutes({ novel, volume: novel.outline!.volumes[0], apiSettings: settings,
      requestCompletion: async () => ({ content: '{"routes":[{"title":"a","summary":"b","turningPoint":"c","risk":"d","endingState":"e"},{"title":"unfinished"}]}' }) });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].endingState).toBe('e');
  });

  it.each([
    { routes: [] },
    { routes: [{ title: '缺少字段' }, { title: '另一条缺少字段' }] },
    { routes: [null, null] },
    { routes: [{}, {}, {}, {}] },
  ])('rejects unusable candidates %j', async (payload) => {
    await expect(proposeNovelVolumeRoutes({ novel, volume: novel.outline!.volumes[0], apiSettings: settings, requestCompletion: async () => ({ content: JSON.stringify(payload) }) })).rejects.toThrow();
  });

  it('updates only the selected volume while preserving its tone, risks, chapters and other volumes', () => {
    const outline = novel.outline!;
    const source = { ...outline, volumes: outline.volumes.map((item, index) => ({ ...item, tone: index === 0 ? '原基调' : '其他基调', foreshadowing: index === 0 ? '原伏笔' : '其他伏笔', chapters: [{ index: 1, title: '原章', goal: '原目标', sceneEnd: false }] })) };
    const before = JSON.stringify(source);
    const result = applyVolumeRouteToOutline(source, 'v1', { title: 'x', summary: '新梗概', turningPoint: '新转折', risk: '新风险', endingState: '新状态' });
    expect(result.volumes[0].summary).toContain('新梗概');
    expect(result.volumes[0].summary).toContain('新转折');
    expect(result.volumes[0].tone).toBe('原基调');
    expect(result.volumes[0].foreshadowing).toBe('原伏笔');
    expect(result.volumes[0].chapters).toEqual(source.volumes[0].chapters);
    expect(result.volumes[1]).toEqual(source.volumes[1]);
    expect(result.volumes[0].handoff?.outgoing).toBe('新状态');
    expect(JSON.stringify(source)).toBe(before);
  });
});
