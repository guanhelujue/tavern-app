import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearDebugRequestHistory,
  getDebugRequestHistory,
  subscribeDebugRequestHistory,
} from './debug-request-history';
import { executeComfyWorkflow } from './comfyui-image-generation';
import { generateImage } from './image-generation';
import { formatImageDebugValue } from './image-request-trace';

vi.mock('../utils/novel-images', () => ({
  persistGeneratedImage: vi.fn(async () => 'file:///generated.png'),
  readNovelImageAsInlineData: vi.fn(async () => ({
    base64: 'AQIDBA==',
    dataUri: 'data:image/png;base64,AQIDBA==',
    mimeType: 'image/png',
  })),
}));

const localSettings = {
  baseUrl: 'http://127.0.0.1:8188',
  apiKey: 'local-secret',
  auth: 'bearer' as const,
  debugPromptInspectorEnabled: true,
};

afterEach(() => {
  clearDebugRequestHistory();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image request trace', () => {
  it('records a pending entry immediately and publishes updates while the request is in flight', async () => {
    let resolvePrompt!: (response: Response) => void;
    const promptResponse = new Promise<Response>((resolve) => { resolvePrompt = resolve; });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return promptResponse;
      if (url.endsWith('/history/pending')) return new Response(JSON.stringify({ pending: {
        status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'out.png' }] } },
      } }));
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeDebugRequestHistory(listener);
    const pending = executeComfyWorkflow({
      apiSettings: localSettings,
      graph: { '1': { class_type: 'Test', inputs: { token: 'local-secret' } } },
      fetchImpl: fetchImpl as typeof fetch,
      pollIntervalMs: 0,
    });

    await vi.waitFor(() => expect(getDebugRequestHistory()).toHaveLength(1));
    expect(getDebugRequestHistory()[0]).toMatchObject({ status: 'pending', purpose: 'image-workflow' });
    expect(listener).toHaveBeenCalled();

    clearDebugRequestHistory();
    resolvePrompt(new Response(JSON.stringify({ prompt_id: 'pending' })));
    await expect(pending).resolves.toMatchObject({ promptId: 'pending' });
    expect(getDebugRequestHistory()).toHaveLength(0);
    unsubscribe();
  });

  it('keeps local startup, upload, JSON workflow, task id and download in one redacted record', async () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost:8081/debug' } });
    let submittedBody: Record<string, unknown> | undefined;
    let systemStatsCalls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/system_stats') {
        if (++systemStatsCalls === 1) throw new TypeError('offline');
        return new Response(JSON.stringify({ system: { comfyui_version: 'test' } }));
      }
      if (path === '/api/local-comfy' && init?.method === 'POST') return new Response(JSON.stringify({ state: 'starting' }));
      if (path === '/api/local-comfy') return new Response(JSON.stringify({ state: 'ready' }));
      if (path === '/upload/image') return new Response(JSON.stringify({ name: 'reference.png' }));
      if (path === '/prompt') {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ prompt_id: 'local-task' }));
      }
      if (path === '/history/local-task') return new Response(JSON.stringify({ 'local-task': {
        status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'result.png' }] } },
      } }));
      if (path === '/view') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected ${path} ${String(init?.method)}`);
    });

    await expect(generateImage({
      apiSettings: localSettings,
      model: 'moss-image',
      purpose: 'portrait',
      prompt: 'a portrait with local-secret',
      referenceImageUri: 'file:///reference.png',
      seed: 42,
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toMatchObject({ promptId: 'local-task' });

    const snapshot = getDebugRequestHistory()[0];
    expect(snapshot).toMatchObject({ status: 'success', purpose: 'image-portrait', promptId: 'local-task' });
    expect(snapshot?.steps?.map((step) => step.label)).toEqual(expect.arrayContaining([
      '检查 ComfyUI 服务', '本地启动服务', '上传参考图', '提交 ComfyUI 工作流', '查询任务结果', '下载生成图片',
    ]));
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('local-secret');
    expect(serialized).not.toContain('AQIDBA==');
    const submitStep = snapshot?.steps?.find((step) => step.label === '提交 ComfyUI 工作流');
    expect(submitStep?.requestBody).toContain('"prompt"');
    const tracedSubmit = JSON.parse(submitStep!.requestBody!) as Record<string, unknown>;
    const expectedPrompt = JSON.parse(JSON.stringify(submittedBody?.prompt).replaceAll('local-secret', '<REDACTED>'));
    expect(tracedSubmit.prompt).toEqual(expectedPrompt);
    expect((submittedBody?.prompt as Record<string, unknown>)['1']).toMatchObject({
      class_type: 'UNETLoader',
      inputs: { unet_name: 'moss_image_sft_int8_convrot.safetensors' },
    });
    expect(((submittedBody?.prompt as Record<string, unknown>)['8'] as Record<string, unknown>).inputs).toMatchObject({ seed: 42 });
  });

  it('merges repeated GET polls, does not revive a cleared entry, and isolates concurrent tasks', async () => {
    let historyCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'poll-task' }));
      if (url.endsWith('/history/poll-task')) {
        historyCalls += 1;
        return historyCalls < 2 ? new Response(JSON.stringify({})) : new Response(JSON.stringify({ 'poll-task': {
          status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'poll.png' }] } },
        } }));
      }
      if (url.includes('/view?')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }));
      throw new Error(`unexpected ${url}`);
    });
    await executeComfyWorkflow({ apiSettings: localSettings, graph: {}, fetchImpl: fetchImpl as typeof fetch, pollIntervalMs: 0 });
    const snapshot = getDebugRequestHistory()[0];
    expect(snapshot?.steps?.find((step) => step.label === '查询任务结果')?.count).toBe(2);

    clearDebugRequestHistory();
    const makeRemote = (task: string) => generateImage({
      apiSettings: { baseUrl: 'https://image.example/v1', apiKey: '', protocol: 'openai-images', debugPromptInspectorEnabled: true },
      model: 'gpt-image-2', purpose: 'scene', prompt: task,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }))) as typeof fetch,
    });
    await Promise.all([makeRemote('one'), makeRemote('two')]);
    expect(getDebugRequestHistory()).toHaveLength(2);
    expect(getDebugRequestHistory().map((entry) => entry.messages[0]?.content)).toEqual(expect.arrayContaining(['one', 'two']));
  });

  it('records Gemini and Responses image responses without leaking query keys or image data', async () => {
    const geminiFetch = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }],
    })));
    await generateImage({
      apiSettings: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gem-secret', protocol: 'google-generate-content', debugPromptInspectorEnabled: true },
      model: 'gemini-2.5-flash-image', purpose: 'portrait', prompt: 'gemini', fetchImpl: geminiFetch as typeof fetch,
    });
    const geminiSnapshot = getDebugRequestHistory()[0];
    expect(geminiSnapshot?.steps?.find((step) => step.label === '提交图像生成请求')?.responseBody).toContain('[image data omitted');
    expect(JSON.stringify(geminiSnapshot)).not.toContain('gem-secret');
    expect(JSON.stringify(geminiSnapshot)).not.toContain('ZmFrZQ==');

    clearDebugRequestHistory();
    const responsesFetch = vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'UmVzcG9uc2Vz' }],
    })));
    await generateImage({
      apiSettings: { baseUrl: 'https://image.example/v1', apiKey: 'responses-secret', protocol: 'openai-responses-image', debugPromptInspectorEnabled: true },
      model: 'gpt-5.5', purpose: 'scene', prompt: 'responses', fetchImpl: responsesFetch as typeof fetch,
    });
    const responsesSnapshot = getDebugRequestHistory()[0];
    expect(responsesSnapshot?.steps?.find((step) => step.label === '提交图像生成请求')?.responseBody).toContain('[image data omitted');
    expect(JSON.stringify(responsesSnapshot)).not.toContain('responses-secret');
    expect(JSON.stringify(responsesSnapshot)).not.toContain('UmVzcG9uc2Vz');
  });

  it('resumes an existing ComfyUI task with GET-only polling and preserves its prompt id', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (url.endsWith('/history/resume-task')) return new Response(JSON.stringify({ 'resume-task': {
        status: { status_str: 'success' }, outputs: { '90': { images: [{ filename: 'resume.png' }] } },
      } }));
      if (url.includes('/view?')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      throw new Error(`unexpected ${url}`);
    });
    await expect(executeComfyWorkflow({
      apiSettings: localSettings, resumePromptId: 'resume-task', fetchImpl: fetchImpl as typeof fetch, pollIntervalMs: 0,
    })).resolves.toMatchObject({ promptId: 'resume-task' });
    expect(methods).toEqual(['GET', 'GET']);
    expect(getDebugRequestHistory()[0]).toMatchObject({ promptId: 'resume-task', status: 'success' });
  });

  it('records remote failure and cancellation, while the disabled switch leaves no record', async () => {
    const failedFetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'upstream failed' } }), { status: 500 }));
    await expect(generateImage({
      apiSettings: { baseUrl: 'https://image.example/v1', apiKey: '', protocol: 'openai-images', debugPromptInspectorEnabled: true },
      model: 'gpt-image-2', purpose: 'portrait', prompt: 'failure', fetchImpl: failedFetch as typeof fetch,
    })).rejects.toThrow('upstream failed');
    expect(getDebugRequestHistory()[0]).toMatchObject({ status: 'error', error: expect.stringContaining('upstream failed') });

    clearDebugRequestHistory();
    const controller = new AbortController();
    const cancelFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/prompt')) return new Response(JSON.stringify({ prompt_id: 'cancel-task' }));
      throw new Error('unexpected');
    });
    await expect(executeComfyWorkflow({
      apiSettings: localSettings, graph: {}, fetchImpl: cancelFetch as typeof fetch,
      signal: controller.signal, onSubmitted: () => controller.abort(), pollIntervalMs: 0,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(getDebugRequestHistory()[0]).toMatchObject({ status: 'cancelled' });

    clearDebugRequestHistory();
    await expect(generateImage({
      apiSettings: { baseUrl: 'https://image.example/v1', apiKey: '', protocol: 'openai-images', debugPromptInspectorEnabled: false },
      model: 'gpt-image-2', purpose: 'portrait', prompt: 'disabled', fetchImpl: failedFetch as typeof fetch,
    })).rejects.toThrow('upstream failed');
    expect(getDebugRequestHistory()).toHaveLength(0);
  });

  it('redacts credentials, image payloads, and query secrets in arbitrary debug values', () => {
    const output = formatImageDebugValue({ authorization: 'secret', image: { mimeType: 'image/png', data: 'AQIDBA==' }, url: 'https://x.test/path?key=secret' }, 'secret');
    expect(output).toContain('<REDACTED>');
    expect(output).toContain('[image data omitted');
    expect(output).not.toContain('AQIDBA==');
  });
});
