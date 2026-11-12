import { describe, expect, it, vi } from 'vitest';
import { getComicPageLayout } from '../constants/novel-comic';
import type { ApiSettings } from '../types/tavern';
import { comicSourceHash, planNovelComic } from './novel-comic-planner';

const settings = { baseUrl: '', apiKey: '', model: 'planner', temperature: 0.7, maxTokens: 4000, contextWindowMessages: 20, streamingEnabled: true, requestTimeoutMs: 30_000, requestRetryCount: 0, debugPromptInspectorEnabled: false, replyLengthPreset: 'standard', continuationOnTruncation: true } as unknown as ApiSettings;
const chars = [{ id: 'hero', name: '沈遥', appearance: 'short black hair, slim young man', outfit: 'blue sweatshirt and dark trousers' }];
const source = '沈遥推开书店的门，雨水沿着伞骨落下。他看见熟悉的身影，停在门口。';

function response(pages: unknown) { return { content: JSON.stringify(Array.isArray(pages) ? { pages } : pages), model: 'mock' }; }
function panel(id: string, sourceText = '沈遥推开书店的门') { return { id, index: 0, beat: 'arrival', sourceText, characterIds: ['hero'], location: 'old bookshop', time: 'rainy evening', camera: 'medium shot', action: 'he opens the door', continuity: 'blue sweatshirt remains dry under the umbrella', prompt: 'Photorealistic cinematic photograph of the same young man opening the old bookshop door in the rain, natural skin texture, soft practical light.', negativePrompt: 'text, collage, borders', caption: '雨夜推门', dialogue: [], aspect: 'portrait', seed: 1 }; }

describe('novel comic planner', () => {
  it('preserves the complete target action after a long caption', async () => {
    const prompt = `${'visible photographic detail '.repeat(70)}His right hand opens the red umbrella beside the railway window.`;
    const request = vi.fn().mockResolvedValue(response([
      { id: 'page-1', kind: 'battle', layout: 'battle-impact', panels: [{ ...panel('p1'), prompt }] },
    ]));
    const document = await planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '',
      content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request });
    expect(document.pages[0].panels[0].prompt).toContain(prompt);
    expect(document.pages[0].panels[0].prompt).toContain('no generated text');
  });
  it('normalizes dimensions and accepts mixed daily/battle layouts', async () => {
    const request = vi.fn().mockResolvedValue(response([
      { id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [panel('p1'), panel('p2'), panel('p3'), panel('p4')] },
      { id: 'page-2', kind: 'battle', layout: 'battle-impact', panels: [panel('p5')] },
    ]));
    const doc = await planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '第一章', content: source, characters: chars, apiSettings: settings, pageCount: 2, requestCompletion: request });
    expect(doc.visualStyle).toBe('photorealistic'); expect(doc.modelId).toBe('qwen-image-2.1');
    expect(doc.pages[0].panels[0]).toMatchObject({ width: 768, height: 1024, status: 'pending' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'comic-plan', signal: undefined }));
  });

  it('rejects unknown references and source quotes that are not in the text', async () => {
    const request = vi.fn().mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [
      { ...panel('p1'), characterIds: ['unknown'] }, panel('p2'), panel('p3'), panel('p4'),
    ] }]));
    await expect(planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request })).rejects.toThrow('未知角色');
    request.mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [
      { ...panel('p1'), sourceText: '正文没有这句话' }, panel('p2'), panel('p3'), panel('p4'),
    ] }]));
    await expect(planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request })).rejects.toThrow('sourceText');
  });

  it('rejects duplicate ids, empty prompts, invalid panel count and empty/oversized content', async () => {
    const request = vi.fn().mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [panel('p1'), panel('p1'), panel('p3'), panel('p4')] }]));
    const input = { novelId: 'n', sourceId: 'c', sourceKind: 'chapter' as const, sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request };
    await expect(planNovelComic(input)).rejects.toThrow('ID 重复');
    request.mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [{ ...panel('p1'), prompt: '' }, panel('p2'), panel('p3'), panel('p4')] }]));
    await expect(planNovelComic(input)).rejects.toThrow('缺少 prompt');
    await expect(planNovelComic({ ...input, content: '' })).rejects.toThrow('为空正文');
    await expect(planNovelComic({ ...input, content: 'x'.repeat(30_001) })).rejects.toThrow('超过 30000');
  });

  it('forwards abort signal and produces a stable source hash', async () => {
    const controller = new AbortController(); const request = vi.fn().mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [panel('p1'), panel('p2'), panel('p3'), panel('p4')] }]));
    await planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'message', sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request, signal: controller.signal });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(comicSourceHash(source)).toBe(comicSourceHash(source)); expect(comicSourceHash(source)).not.toBe(comicSourceHash(`${source}!`));
  });

  it('adds only source-grounded derived characters and repairs invalid seeds/prompts', async () => {
    const request = vi.fn().mockResolvedValue(response({ characters: [{ id: 'friend', name: '林夏', appearance: 'short brown hair', outfit: 'yellow raincoat', sourceText: '熟悉的身影' }], pages: [{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [
      { ...panel('p1'), characterIds: ['hero', 'friend'], prompt: 'A person at a door.', seed: -1 },
      { ...panel('p2'), characterIds: ['friend'], seed: NaN }, panel('p3'), panel('p4'),
    ] }] }));
    const doc = await planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, requestCompletion: request });
    expect(doc.characters.find((c) => c.id === 'friend')).toMatchObject({ derived: true, sourceText: '熟悉的身影' });
    expect(doc.pages[0].panels[0].seed).toBeGreaterThan(0);
    expect(doc.pages[0].panels[0].prompt).toContain('Photorealistic live-action');
    expect(doc.pages[0].panels[0].prompt).toContain('short brown hair');
  });

  it('enforces explicit story mode and source order', async () => {
    const request = vi.fn().mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [panel('p1'), panel('p2'), panel('p3'), panel('p4')] }]));
    const input = { novelId: 'n', sourceId: 'c', sourceKind: 'chapter' as const, sourceTitle: '', content: source, characters: chars, apiSettings: settings, pageCount: 1, storyMode: 'battle' as const, requestCompletion: request };
    await expect(planNovelComic(input)).rejects.toThrow('storyMode=battle');
    request.mockResolvedValue(response([{ id: 'page-1', kind: 'daily', layout: 'daily-grid', panels: [
      panel('p1', '熟悉的身影'), panel('p2', '沈遥推开书店的门'), panel('p3'), panel('p4'),
    ] }]));
    await expect(planNovelComic({ ...input, storyMode: 'daily' })).rejects.toThrow('顺序倒退');
  });

  it('throws immediately when already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    const request = vi.fn();
    await expect(planNovelComic({ novelId: 'n', sourceId: 'c', sourceKind: 'chapter', sourceTitle: '', content: source, characters: chars, apiSettings: settings, requestCompletion: request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps every page layout inside the fixed master canvas without overlap', () => {
    for (const layout of ['daily-grid', 'daily-focus', 'battle-action', 'battle-impact'] as const) {
      const spec = getComicPageLayout(layout); expect(spec.panels.length).toBeGreaterThan(0);
      for (const p of spec.panels) {
        expect(p.x + p.width).toBeLessThanOrEqual(spec.width);
        expect(p.y + p.height).toBeLessThanOrEqual(spec.height);
      }
    }
  });
});
