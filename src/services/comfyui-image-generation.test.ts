import { describe, expect, it, vi } from 'vitest';

import {
  buildComfyImageWorkflow,
  executeComfyWorkflow,
  generateComfyImage,
  uploadComfyImage,
  type ComfyApiSettings,
} from './comfyui-image-generation';

vi.mock('../utils/novel-images', () => ({
  readNovelImageAsInlineData: vi.fn(async () => ({ mimeType: 'image/png', base64: 'AQIDBA==' })),
}));

const settings: ComfyApiSettings = { baseUrl: 'http://comfy.test:8188/api?x=1', apiKey: 'secret', auth: 'bearer' };
const models = ['qwen-image-2.1', 'moss-image', 'z-image'] as const;

describe('ComfyUI workflow contracts', () => {
  it.each(models)('builds a valid %s text workflow', (model) => {
    const result = buildComfyImageWorkflow({ model, prompt: 'a room', width: 768, height: 1024, seed: 7 });
    expect(result.mode).toBe('text-to-image');
    expect(result.width).toBe(768);
    expect(result.height).toBe(1024);
    expect(result.graph['8'].inputs.latent_image).toEqual(['7', 0]);
    expect(result.graph['90'].inputs.images).toEqual(['9', 0]);
  });

  it.each(models)('builds a reference workflow for %s with fitted image input', (model) => {
    const result = buildComfyImageWorkflow({ model, prompt: 'the same person reading', width: 768, height: 1024, seed: 8, referenceNames: ['actor.png'] });
    expect(result.mode).toBe('image-to-image');
    expect(result.graph['11']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'actor.png' } });
    expect(result.graph['12']).toMatchObject({ class_type: 'TavernFitReference', inputs: { width: 768, height: 1024 } });
    if (model === 'qwen-image-2.1') {
      expect(result.graph['4'].inputs['images.image_1']).toEqual(['12', 0]);
      expect(result.graph['8'].inputs.latent_image).toEqual(['4', 2]);
      expect(result.graph['4'].inputs.resolution).toBe(0);
    } else {
      expect(result.graph['8'].inputs.latent_image).toEqual(['7', 0]);
      expect(result.graph['7'].inputs.pixels).toEqual(['12', 0]);
    }
  });

  it('maps up to four Qwen references and rejects multiple MOSS/Z references', () => {
    const qwen = buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'cast', referenceNames: ['a', 'b', 'c', 'd'] });
    expect(qwen.graph['4'].inputs).toMatchObject({ 'images.image_1': ['12', 0], 'images.image_2': ['14', 0], 'images.image_3': ['16', 0], 'images.image_4': ['18', 0] });
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'cast', referenceNames: ['a', 'b', 'c', 'd', 'e'] })).toThrow('最多使用四张');
    expect(() => buildComfyImageWorkflow({ model: 'moss-image', prompt: 'cast', referenceNames: ['a', 'b'] })).toThrow('只支持单张');
    expect(() => buildComfyImageWorkflow({ model: 'z-image', prompt: 'cast', referenceNames: ['a', 'b'] })).toThrow('只支持单张');
  });

  it('rejects invalid pixel budgets, seeds, denoise and steps', () => {
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'x', width: 1536, height: 1024 })).toThrow('总像素');
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'x', seed: -1 })).toThrow('随机种子');
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'x', denoise: 0 })).toThrow('重绘强度');
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'x', denoise: 1.1 })).toThrow('重绘强度');
    expect(() => buildComfyImageWorkflow({ model: 'qwen-image-2.1', prompt: 'x', steps: 3 })).toThrow('采样步数');
  });
});

describe('ComfyUI transport contracts', () => {
  it('waits for local startup before uploading references or submitting the selected model', async () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost:8081/novels' } });
    let probes = 0;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === '/system_stats') {
        if (++probes === 1) throw new TypeError('offline');
        return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }));
      }
      if (path === '/api/local-comfy') return new Response(JSON.stringify({ state: 'ready' }));
      if (path === '/upload/image') return new Response(JSON.stringify({ name: 'actor.png' }));
      if (path === '/prompt') {
        const body = JSON.parse(String(init?.body));
        expect(body.prompt['1'].inputs.unet_name).toBe('moss_image_sft_int8_convrot.safetensors');
        return new Response(JSON.stringify({ prompt_id: 'started' }));
      }
      if (path === '/history/started') return new Response(JSON.stringify({ started: { status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'portrait.png' }] } } } }));
      if (path === '/view') return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected request ${path}`);
    });
    try {
      const result = await generateComfyImage({ apiSettings: { baseUrl: 'http://127.0.0.1:8188', auth: 'none' }, model: 'moss-image', prompt: 'portrait', referenceImageUri: 'file:///actor.png', fetchImpl });
      expect(result.promptId).toBe('started');
      expect(calls).toEqual(['/system_stats', '/api/local-comfy', '/system_stats', '/upload/image', '/prompt', '/history/started', '/view']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('uploads original bytes with filename/subfolder and auth', async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
      const body = new Uint8Array(init?.body as ArrayBuffer);
      expect(new TextDecoder().decode(body)).toContain('filename="tavern-reference.png"');
      expect([...body]).toContain(1); expect([...body]).toContain(4);
      return new Response(JSON.stringify({ name: 'actor.png', subfolder: 'tavern' }), { status: 200 });
    });
    await expect(uploadComfyImage('file:///actor.png', settings, fetchImpl)).resolves.toBe('tavern/actor.png');
  });

  it('submits, polls history, and downloads binary output with auth', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestUrl = String(url);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
      if (requestUrl.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 });
      if (requestUrl.endsWith('/history/p1')) return new Response(JSON.stringify({ p1: { status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'out.png', subfolder: 'x', type: 'output' }] } } } }), { status: 200 });
      if (requestUrl.includes('/view?')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected ${requestUrl}`);
    });
    const result = await executeComfyWorkflow({ apiSettings: settings, graph: { '1': { class_type: 'Test', inputs: {} } }, fetchImpl, pollIntervalMs: 0 });
    expect(result.promptId).toBe('p1'); expect(result.output).toEqual({ filename: 'out.png', subfolder: 'x', type: 'output' });
    expect(result.source).toMatchObject({ mimeType: 'image/png', base64: 'iVBORw==' });
  });

  it('resumes without upload or prompt submission', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).endsWith('/history/resume')
      ? new Response(JSON.stringify({ resume: { status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'r.png', subfolder: '', type: 'output' }] } } } }))
      : new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }));
    const result = await generateComfyImage({ apiSettings: settings, model: 'qwen-image-2.1', prompt: 'resume', referenceImageUri: 'file:///actor.png', resumePromptId: 'resume', fetchImpl, pollIntervalMs: 0 } as never);
    expect(result.promptId).toBe('resume');
    expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain(expect.stringContaining('/upload/image'));
    expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain(expect.stringContaining('/prompt'));
  });

  it('aborts after submission without interrupting the server job', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).endsWith('/prompt')
      ? new Response(JSON.stringify({ prompt_id: 'submitted' }))
      : new Response(JSON.stringify({ submitted: { status: {} } })));
    await expect(executeComfyWorkflow({ apiSettings: settings, graph: { '1': { class_type: 'Test', inputs: {} } }, fetchImpl, signal: controller.signal, onSubmitted: () => controller.abort(), pollIntervalMs: 0 })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain(expect.stringContaining('/interrupt'));
  });

  it('reports execution errors and successful jobs with empty outputs', async () => {
    const errorFetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).endsWith('/prompt')
      ? new Response(JSON.stringify({ prompt_id: 'bad' }))
      : new Response(JSON.stringify({ bad: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'boom' }]] } } })));
    await expect(executeComfyWorkflow({ apiSettings: settings, graph: {}, fetchImpl: errorFetch, pollIntervalMs: 0 })).rejects.toMatchObject({ name: 'ComfyExecutionError', message: expect.stringContaining('boom') });
    const emptyFetch = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).endsWith('/prompt')
      ? new Response(JSON.stringify({ prompt_id: 'empty' }))
      : new Response(JSON.stringify({ empty: { status: { status_str: 'success' }, outputs: {} } })));
    await expect(executeComfyWorkflow({ apiSettings: settings, graph: {}, fetchImpl: emptyFetch, pollIntervalMs: 0 })).rejects.toMatchObject({ name: 'ComfyExecutionError', message: expect.stringContaining('没有返回图片') });
  });

  it('allows a fresh retry when a server restart removed the resumed prompt', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => new Response(JSON.stringify(
      String(url).endsWith('/queue') ? { queue_running: [], queue_pending: [] } : {},
    )));
    await expect(executeComfyWorkflow({ apiSettings: settings, resumePromptId: 'lost', fetchImpl, pollIntervalMs: 0 }))
      .rejects.toMatchObject({ name: 'ComfyExecutionError', message: expect.stringContaining('重新提交这一幕') });
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).endsWith('/prompt'))).toBe(true);
  });
});
