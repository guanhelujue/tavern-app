/** Opt-in hardware smoke test: COMFY_INTEGRATION=1 npm exec vitest -- run scripts/comfyui-integration.test.ts */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildComfyImageWorkflow } from '../src/services/comfyui-image-generation';
import { generateImage } from '../src/services/image-generation';
import { planNovelComic } from '../src/services/novel-comic-planner';
import { generateNovelComicImages } from '../src/services/novel-comic-renderer';
import { LOCAL_IMAGE_MODEL_IDS } from '../src/constants/image-models';
import type { GeneratedImageSource } from '../src/types/image-generation';
import type { ApiSettings } from '../src/types/tavern';
import type { NovelComicDocument } from '../src/types/novel-comic';

const io = vi.hoisted(() => ({ counter: 0, directory: '' }));
vi.mock('../src/services/llm', () => ({ requestCompletionWithUsage: vi.fn() }));
vi.mock('../src/utils/novel-images', () => ({
  readNovelImageAsInlineData: async (uri: string) => {
    if (uri.startsWith('data:')) {
      const match = uri.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) throw new Error('Unsupported inline image');
      return { mimeType: match[1], base64: match[2] };
    }
    return { mimeType: 'image/png', base64: (await readFile(uri.startsWith('file:') ? fileURLToPath(uri) : uri)).toString('base64') };
  },
  persistGeneratedImage: async (source: GeneratedImageSource) => {
    if (!source.base64) throw new Error('Expected binary image source');
    const path = resolve(io.directory, `image-${String(++io.counter).padStart(2, '0')}.png`);
    await writeFile(path, Buffer.from(source.base64, 'base64'));
    return pathToFileURL(path).href;
  },
}));

const active = process.env.COMFY_INTEGRATION === '1' || process.env.COMFY_RERENDER === '1';
const baseUrl = process.env.COMFY_BASE_URL || 'http://127.0.0.1:8188';
const apiSettings = { baseUrl, apiKey: '', protocol: 'comfyui' as const, auth: 'none' as const };
const reference = pathToFileURL(resolve('output/real-photo-img2img-20261023/reference.png')).href;

async function pngSize(uri: string) {
  const bytes = await readFile(fileURLToPath(uri));
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.skipIf(!active)('real local image integration', () => {
  it.skipIf(process.env.COMFY_INTEGRATION !== '1')('runs all six routes and plans/renders photorealistic daily and battle pages', async () => {
    io.directory = resolve('output/comfy-integration-20261024');
    await mkdir(io.directory, { recursive: true });
    const records: object[] = [];
    const record = async (row: object) => {
      records.push(row);
      await writeFile(resolve(io.directory, 'routes.json'), JSON.stringify(records, null, 2));
    };
    // Export the exact production graphs, rather than maintaining a second set of templates.
    for (const model of LOCAL_IMAGE_MODEL_IDS) {
      const directory = resolve('integrations/comfyui/workflows', model);
      await mkdir(directory, { recursive: true });
      for (const withImage of [false, true]) {
        const built = buildComfyImageWorkflow({ model, prompt: withImage
          ? 'Keep the identity of the person in the reference photograph. A live-action medium shot of the same young man in a light blue sweatshirt sitting on a wooden park bench and reading an open paperback book, looking down at the pages, daylight, realistic photography.'
          : 'A photorealistic portrait of an adult East Asian man aged 24, short black hair, light blue sweatshirt, dark trousers, natural skin texture, soft daylight, a quiet park background, one person, no text.', seed: 20261024, referenceNames: withImage ? ['tavern-reference.png'] : [] });
        await writeFile(resolve(directory, `${built.mode}.api.json`), JSON.stringify(built.graph, null, 2));
      }
    }
    // Keep the original identity reference for story shots. Also exercise the character t2i entry.
    for (const model of LOCAL_IMAGE_MODEL_IDS) {
      for (const withImage of [false, true]) {
        const graph = buildComfyImageWorkflow({ model, prompt: 'placeholder', referenceNames: withImage ? ['tavern-reference.png'] : [], seed: 20261024 });
        const saved = JSON.parse(await readFile(resolve('integrations/comfyui/workflows', model, `${graph.mode}.api.json`), 'utf8'));
        const started = Date.now();
        console.log(`START ${model} ${graph.mode}`);
        const result = await generateImage({ apiSettings, model, purpose: withImage ? 'scene' : 'portrait', prompt: saved['4'].inputs.prompt || saved['4'].inputs.text,
          width: 768, height: 1024, seed: 20261024,
          referenceImageUri: withImage ? reference : undefined,
          onSubmitted: async (promptId) => { await writeFile(resolve(io.directory, 'pending.json'), JSON.stringify({ model, mode: graph.mode, promptId })); },
        });
        expect(result.mode).toBe(graph.mode);
        expect(await pngSize(result.uri)).toEqual({ width: 768, height: 1024 });
        await record({ seconds: Math.round((Date.now() - started) / 1000), ...result });
        console.log(`PASS ${model} ${graph.mode} ${Math.round((Date.now() - started) / 1000)}s`);
      }
    }
    const keySource = await readFile('scripts/image_generation_demo.py', 'utf8');
    const key = process.env.COMIC_LLM_API_KEY || keySource.match(/^DEFAULT_API_KEY\s*=\s*['"]([^'"]+)['"]/m)?.[1];
    if (!key) throw new Error('No configured local proxy key');
    const modelsResponse = await fetch('http://127.0.0.1:8317/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!modelsResponse.ok) throw new Error(`Text model discovery HTTP ${modelsResponse.status}`);
    const listed = await modelsResponse.json() as { data: { id: string }[] };
    const available = listed.data.map((item) => item.id);
    const plannerModel = process.env.COMIC_LLM_MODEL || ['gpt-5.5', 'gpt-5.4', 'gemini-3-flash-preview'].find((model) => available.includes(model)) || available.find((model) => !/image|audio|embedding|tts|realtime/i.test(model));
    if (!plannerModel) throw new Error('No text model available');
    console.log(`PLANNER ${plannerModel}`);
    const content = '傍晚，沈遥穿着浅蓝色长袖上衣、深灰色长裤和白色运动鞋，走进安静的公园。他在长椅上坐下，翻开一本没有字样的深蓝色书。读到一半，他抬起头，看着树叶间漏下的夕阳。\n\n一阵风吹过，沈遥合上书，起身来到长椅旁的空地。他练过基础拳术，今天只做无人对抗的练习。他把书留在长椅上，左脚向前，双手护在脸前。随后他朝右前方打出一记直拳，右臂伸直，左手仍护在下巴旁，脚下稳稳落地。空地上只有他一个人，没有受伤的人。';
    await writeFile(resolve(io.directory, 'chapter.txt'), content);
    const document = await planNovelComic({ novelId: 'integration', sourceId: 'sample', sourceKind: 'chapter', sourceTitle: '公园的傍晚',
      content, pageCount: 2, storyMode: 'auto', characters: [{ id: 'hero', name: '沈遥', appearance: '成年东亚男性，黑色短发，身形清瘦', outfit: '浅蓝色长袖上衣、深灰色长裤、白色运动鞋', referenceImageUri: reference }],
      apiSettings: { baseUrl: 'http://127.0.0.1:8317', apiKey: key, model: plannerModel } as ApiSettings,
      requestCompletion: async ({ messages, maxTokens, temperature, signal }) => {
        const response = await fetch('http://127.0.0.1:8317/v1/chat/completions', { method: 'POST', signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: plannerModel, messages: [...messages.slice(0, -1), { role: 'user', content: `${messages.at(-1)!.content}\n本次演示：第1页使用 daily-focus，3幕，第一幕用 wide，后两幕 portrait；第2页使用 battle-impact，1幕，tall，展示出拳瞬间。角色已经齐全，根级 characters 返回空数组。` }], max_tokens: maxTokens, temperature, stream: false }),
        });
        if (!response.ok) throw new Error(`Planner HTTP ${response.status}: ${(await response.text()).slice(0, 250)}`);
        const raw = await response.json();
        await writeFile(resolve(io.directory, 'llm-response.json'), JSON.stringify(raw, null, 2));
        return { content: raw.choices[0].message.content, model: raw.model };
      },
    });
    await writeFile(resolve(io.directory, 'plan.json'), JSON.stringify(document, null, 2));
    let previousProgress = '';
    const rendered = await generateNovelComicImages({ document, apiSettings,
      onProgress: (message) => { if (message !== previousProgress) { previousProgress = message; console.log(message); } },
      onUpdate: async (next) => { await writeFile(resolve(io.directory, 'document.json'), JSON.stringify(next, null, 2)); },
    });
    expect(rendered.status).toBe('completed');
    for (const page of rendered.pages) expect(await pngSize(page.imageUri!)).toEqual({ width: 1536, height: 2304 });
    for (const panel of rendered.pages.flatMap((page) => page.panels)) expect(await pngSize(panel.imageUri!)).toEqual({ width: panel.width, height: panel.height });
    console.log('PASS daily + battle pages, all exact dimensions');
  }, 1_200_000);

  it.skipIf(process.env.COMFY_RERENDER !== '1')('regenerates just the edited shot and recomposes its page', async () => {
    const root = resolve('output/comfy-integration-20261024');
    io.directory = resolve(root, 'single-panel-retry');
    await mkdir(io.directory, { recursive: true });
    const original: NovelComicDocument = JSON.parse(await readFile(resolve(root, 'document.json'), 'utf8'));
    expect(original.status).toBe('completed');
    const panel = original.pages[0].panels[2];
    panel.prompt = 'A single frozen moment in a live-action photograph: the same young East Asian man in the light blue long-sleeve sweatshirt, dark gray trousers and white sneakers walks away from a wooden bench toward an open grassy clearing in a quiet park at sunset. Both his hands are empty and relaxed at his sides. One closed deep-blue book rests on the bench behind him; only one book exists in the scene, no book in his hands. Full body, three-quarter view, natural walking posture, warm sunlight from behind the trees. Preserve the reference person’s face, haircut, clothes and slim build. Photorealistic skin, realistic anatomy, no text, no collage, no illustration.';
    panel.action = '空手走向空地，唯一的书留在长椅上';
    panel.continuity = '双手空着；一本合上的深蓝色书放在身后长椅上；浅蓝上衣和深灰长裤不变；夕阳从树后照入。';
    let previousProgress = '';
    const result = await generateNovelComicImages({ document: original, apiSettings, onlyPanelId: panel.id,
      onProgress: (message) => { if (message !== previousProgress) { previousProgress = message; console.log(message); } },
      onUpdate: async (next) => { await writeFile(resolve(root, 'document-after-retry.json'), JSON.stringify(next, null, 2)); },
    });
    expect(result.status).toBe('completed');
    expect(result.pages[0].panels[2].imageUri).not.toBe(panel.imageUri);
    expect(result.pages[0].panels.slice(0, 2).map((p) => p.imageUri)).toEqual(original.pages[0].panels.slice(0, 2).map((p) => p.imageUri));
    expect(result.pages[1]).toEqual(original.pages[1]);
    expect(await pngSize(result.pages[0].imageUri!)).toEqual({ width: 1536, height: 2304 });
  }, 300_000);
});
