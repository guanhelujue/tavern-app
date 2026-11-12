import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getComicPageLayout } from '../constants/novel-comic';
import type { ImageApiSettings } from './image-generation';
import type { ComicPage, NovelComicDocument } from '../types/novel-comic';
import { buildComicPageWorkflow, generateNovelComicImages } from './novel-comic-renderer';

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  executeComfyWorkflow: vi.fn(),
  uploadComfyImage: vi.fn(),
  persistGeneratedImage: vi.fn(),
}));
const { generateImage, executeComfyWorkflow, persistGeneratedImage } = mocks;
vi.mock('./image-generation', () => ({ generateImage: mocks.generateImage }));
vi.mock('./comfyui-image-generation', () => ({ executeComfyWorkflow: mocks.executeComfyWorkflow, uploadComfyImage: mocks.uploadComfyImage }));
vi.mock('../utils/novel-images', () => ({ persistGeneratedImage: mocks.persistGeneratedImage }));

const apiSettings = { baseUrl: 'http://comfy.test:8188', apiKey: 'k', protocol: 'comfyui' } as ImageApiSettings;
const output = (name: string) => ({ filename: name, subfolder: 'out', type: 'output' as const });

function panel(id: string, index: number, status: 'pending' | 'completed' = 'pending') {
  return { id, index, beat: 'beat', sourceText: '沈遥走进书店', characterIds: ['hero'], location: 'bookshop', time: 'evening', camera: 'medium shot', action: 'walks inside', continuity: 'blue shirt', prompt: `live-action shot ${id}`, negativePrompt: 'text, collage', caption: `幕${index + 1}`, dialogue: [{ speaker: '沈遥', text: '你好' }], aspect: 'portrait' as const, width: 768, height: 1024, seed: index + 1, status, ...(status === 'completed' ? { imageUri: `file:///old-${id}.png`, comfyOutput: output(`${id}.png`) } : {}) };
}

function document(overrides: Partial<NovelComicDocument> = {}): NovelComicDocument {
  const page: ComicPage = { id: 'page-1', index: 0, kind: 'daily', layout: 'daily-grid', panels: [panel('p1', 0), panel('p2', 1), panel('p3', 2), panel('p4', 3)], status: 'pending' };
  return { schemaVersion: 1, id: 'doc', novelId: 'novel', sourceId: 'chapter', sourceKind: 'chapter', sourceTitle: '第一章', sourceHash: 'hash', visualStyle: 'photorealistic', modelId: 'qwen-image-2.1', createdAt: 'now', updatedAt: 'now', characters: [{ id: 'hero', name: '沈遥', appearance: '18岁，黑发', outfit: '蓝色上衣', referenceImageUri: 'file:///hero.png' }], pages: [page], status: 'planned', ...overrides };
}

function wireSceneMocks() {
  generateImage.mockImplementation(async (options: { onSubmitted?: (id: string) => unknown; prompt: string }) => {
    await options.onSubmitted?.(`scene-${generateImage.mock.calls.length}`);
    return { uri: `file:///new-${generateImage.mock.calls.length}.png`, promptId: `scene-${generateImage.mock.calls.length}`, comfyOutput: output(`new-${generateImage.mock.calls.length}.png`) };
  });
  executeComfyWorkflow.mockResolvedValue({ source: { base64: 'cGFnZQ==', mimeType: 'image/png' }, promptId: 'page-prompt', output: output('page.png') });
  persistGeneratedImage.mockResolvedValue('file:///page.png');
}

beforeEach(() => { vi.clearAllMocks(); wireSceneMocks(); });

describe('comic page workflow', () => {
  it('preserves page dimensions, panel order, captions and dialogue annotations', () => {
    const doc = document(); const page = doc.pages[0];
    const graph = buildComicPageWorkflow(doc, page, ['a.png', 'b.png', 'c.png', 'd.png']);
    const layout = getComicPageLayout(page.layout);
    expect(graph['1'].inputs).toMatchObject({ width: layout.width, height: layout.height });
    const annotations = JSON.parse(String(graph['1'].inputs.layout_json));
    expect(annotations.panels).toHaveLength(4);
    expect(annotations.panels[0]).toMatchObject({ ...layout.panels[0], caption: '幕1', dialogue: page.panels[0].dialogue });
    expect(graph['11'].inputs.image).toBe('a.png');
    expect(graph['14'].inputs.image).toBe('d.png');
  });
});

describe('comic image rendering', () => {
  it('uses each character original reference for every frame', async () => {
    const result = await generateNovelComicImages({ document: document(), apiSettings, fetchImpl: vi.fn() as typeof fetch });
    expect(result.status).toBe('completed');
    const sceneCalls = generateImage.mock.calls.filter(([options]) => options.purpose === 'scene');
    expect(sceneCalls).toHaveLength(4);
    for (const [options] of sceneCalls) {
      expect(options.referenceImageUris).toEqual(['file:///hero.png']);
      expect(options.referenceImageUris).not.toContain(expect.stringContaining('new-'));
    }
    expect(executeComfyWorkflow).toHaveBeenCalledTimes(1);
  });

  it('generates a missing actor portrait once and checkpoints its submitted prompt ID', async () => {
    const updates: NovelComicDocument[] = [];
    const doc = document({ characters: [{ id: 'hero', name: '沈遥', appearance: '18岁，黑发', outfit: '蓝色上衣' }] });
    generateImage.mockImplementation(async (options: { purpose: string; onSubmitted?: (id: string) => unknown }) => {
      await options.onSubmitted?.(options.purpose === 'portrait' ? 'portrait-pending' : 'scene-pending');
      return options.purpose === 'portrait' ? { uri: 'file:///hero-generated.png', promptId: 'portrait-pending' } : { uri: 'file:///scene.png', promptId: 'scene-pending', comfyOutput: output('scene.png') };
    });
    await generateNovelComicImages({ document: doc, apiSettings, onUpdate: async (next) => { updates.push(next); }, fetchImpl: vi.fn() as typeof fetch });
    expect(generateImage.mock.calls.filter(([options]) => options.purpose === 'portrait')).toHaveLength(1);
    expect(updates.some((next) => next.characters[0].referenceComfyPromptId === 'portrait-pending')).toBe(true);
    expect(updates.at(-1)?.characters[0].referenceImageUri).toBe('file:///hero-generated.png');
  });

  it('rerenders only the selected panel and recomposes its page', async () => {
    const pages = document();
    pages.pages[0] = { ...pages.pages[0], status: 'completed', imageUri: 'file:///page-old.png', panels: [panel('p1', 0, 'completed'), panel('p2', 1, 'completed'), panel('p3', 2, 'completed'), panel('p4', 3, 'completed')] };
    await generateNovelComicImages({ document: pages, apiSettings, onlyPanelId: 'p2', fetchImpl: vi.fn() as typeof fetch });
    expect(generateImage.mock.calls.filter(([options]) => options.purpose === 'scene')).toHaveLength(1);
    expect(generateImage.mock.calls.find(([options]) => options.purpose === 'scene')?.[0].prompt).toContain('p2');
    expect(executeComfyWorkflow).toHaveBeenCalledTimes(1);
  });

  it('preserves a submitted panel prompt ID across generic failures and resumes it', async () => {
    const updates: NovelComicDocument[] = [];
    generateImage.mockImplementationOnce(async (options: { onSubmitted?: (id: string) => unknown }) => { await options.onSubmitted?.('pending-scene'); throw new Error('network down'); });
    await expect(generateNovelComicImages({ document: document(), apiSettings, onUpdate: async (next) => { updates.push(next); }, fetchImpl: vi.fn() as typeof fetch })).rejects.toThrow('network down');
    expect(updates.at(-1)?.pages[0].panels[0]).toMatchObject({ status: 'error', comfyPromptId: 'pending-scene' });

    vi.clearAllMocks(); wireSceneMocks();
    const resumed = document(); resumed.pages[0].panels[0].comfyPromptId = 'pending-scene';
    await generateNovelComicImages({ document: resumed, apiSettings, fetchImpl: vi.fn() as typeof fetch });
    expect(generateImage.mock.calls[0]?.[0].resumePromptId).toBe('pending-scene');
  });

  it('stops before any generation when already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateNovelComicImages({ document: document(), apiSettings, signal: controller.signal, fetchImpl: vi.fn() as typeof fetch })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generateImage).not.toHaveBeenCalled(); expect(executeComfyWorkflow).not.toHaveBeenCalled();
  });
});
