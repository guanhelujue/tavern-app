import type { LocalImageModelId } from '../constants/image-models';
import type {
  ComfyImageOutput,
  GeneratedImageSource,
  ImageGenerationMode,
  ImageGenerationOptions,
} from '../types/image-generation';
import { asRecord } from '../utils/helpers';
import { readNovelImageAsInlineData } from '../utils/novel-images';
import { ensureLocalComfyReady } from './local-comfy-launcher';
import { traceImageRequest, withImageRequestTrace, type ImageTraceSettings } from './image-request-trace';

export type ComfyWorkflow = Record<string, {
  class_type: string;
  inputs: Record<string, unknown>;
}>;

export type ComfyApiSettings = ImageTraceSettings & { auth?: string };

export const COMFY_IMAGE_PRESETS = {
  portrait: { width: 768, height: 1024 },
  square: { width: 768, height: 768 },
  landscape: { width: 1024, height: 768 },
  wide: { width: 1024, height: 576 },
  tall: { width: 768, height: 1152 },
} as const;

function imageSize(width = 768, height = 1024) {
  if (![width, height].every((value) => Number.isInteger(value) && value >= 512 && value <= 1536 && value % 32 === 0)
    || width * height > 1024 * 1024) {
    throw new Error('单幕图片的边长须为 512–1536、32 的倍数，总像素不超过 1024×1024。');
  }
  return { width, height };
}

const tiledVae = { tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 };
const negativeDefault = 'bad anatomy, extra fingers, watermark, text, logo, collage, panel border';

/** Build one versioned local workflow; callers never need ComfyUI node IDs. */
export function buildComfyImageWorkflow({
  model, prompt, negativePrompt = negativeDefault, width: requestedWidth, height: requestedHeight,
  seed = Math.floor(Math.random() * 2 ** 48), referenceNames = [], denoise, steps,
}: {
  model: LocalImageModelId;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  referenceNames?: string[];
  denoise?: number;
  steps?: number;
}): { graph: ComfyWorkflow; width: number; height: number; mode: ImageGenerationMode; seed: number } {
  const { width, height } = imageSize(requestedWidth, requestedHeight);
  const mode = referenceNames.length ? 'image-to-image' : 'text-to-image';
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('随机种子须为非负安全整数。');
  if (referenceNames.length > (model === 'qwen-image-2.1' ? 4 : 1)) {
    throw new Error(model === 'qwen-image-2.1'
      ? '当前 12GB 工作流每幕最多使用四张角色参考图，请拆分镜头。'
      : 'MOSS 和 Z-Image 当前只支持单张原图重绘；多角色参考请选择 Qwen Image 2.1。');
  }
  if (denoise !== undefined && (!Number.isFinite(denoise) || denoise <= 0 || denoise > 1)) {
    throw new Error('重绘强度须大于 0 且不超过 1。');
  }
  if (steps !== undefined && (!Number.isInteger(steps) || steps < 4 || steps > 80)) {
    throw new Error('采样步数须为 4–80 的整数。');
  }
  const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  const graph: ComfyWorkflow = {};
  const isQwen = model === 'qwen-image-2.1';
  const isMoss = model === 'moss-image';
  graph['1'] = isQwen
    ? node('UnetLoaderGGUF', { unet_name: 'qwen-image-2.1-UC-Q6_K.gguf' })
    : node('UNETLoader', { unet_name: isMoss ? 'moss_image_sft_int8_convrot.safetensors' : 'zImageTurbo_turbo.safetensors', weight_dtype: 'default' });
  graph['2'] = node('CLIPLoader', {
    clip_name: isQwen ? 'qwen3vl_8b_int8_convrot.safetensors' : isMoss ? 'qwen3.5_9b_w4a8_gptq.safetensors' : 'qwen_3_4b.safetensors',
    type: isQwen ? 'qwen_image' : isMoss ? 'moss_image' : 'lumina2', device: 'default',
  });
  graph['3'] = node('VAELoader', { vae_name: isQwen ? 'qwen_image_2.1_vae_bf16.safetensors' : isMoss ? 'flux2-vae.safetensors' : 'ae.safetensors' });
  if (isQwen) {
    graph['4'] = node('TextEncodeQwenImage21', {
      clip: ['2', 0], prompt, negative_prompt: negativePrompt,
      // Zero preserves the exact, already fitted reference dimensions. In t2i
      // the encoder's square latent is unused; node 7 owns the requested size.
      resolution: 0, ...(referenceNames.length ? { vae: ['3', 0] } : {}),
    });
    graph['5'] = node('QwenImage21Cache', { model: ['1', 0], device: 'cpu', dtype: 'int8' });
  } else {
    graph['4'] = node('CLIPTextEncode', { clip: ['2', 0], text: prompt });
    graph['5'] = isMoss
      ? node('CLIPTextEncode', { clip: ['2', 0], text: negativePrompt })
      : node('ConditioningZeroOut', { conditioning: ['4', 0] });
    graph['6'] = isMoss
      ? node('SkipLayerGuidanceDiTSimple', { model: ['1', 0], double_layers: '', single_layers: '22', start_percent: 0, end_percent: 1 })
      : node('ModelSamplingAuraFlow', { model: ['1', 0], shift: 3, sampling: 'flow' });
  }
  for (const [index, name] of referenceNames.entries()) {
    const loadId = String(11 + index * 2);
    const fitId = String(12 + index * 2);
    graph[loadId] = node('LoadImage', { image: name });
    graph[fitId] = node('TavernFitReference', { image: [loadId, 0], width, height });
    if (isQwen) graph['4'].inputs[`images.image_${index + 1}`] = [fitId, 0];
  }
  let latent: [string, number];
  if (!referenceNames.length) {
    graph['7'] = node(isQwen || isMoss ? 'EmptyFlux2LatentImage' : 'EmptySD3LatentImage', { width, height, batch_size: 1 });
    latent = ['7', 0];
  } else if (isQwen) {
    latent = ['4', 2];
  } else {
    graph['7'] = node('VAEEncodeTiled', { pixels: ['12', 0], vae: ['3', 0], ...tiledVae });
    latent = ['7', 0];
  }
  graph['8'] = node('KSampler', {
    model: [isQwen ? '5' : '6', 0], seed, steps: steps ?? (isQwen ? 40 : isMoss ? 50 : 8),
    cfg: isMoss ? 3 : 1, sampler_name: model === 'z-image' ? 'res_multistep' : 'euler', scheduler: 'simple',
    positive: ['4', 0], negative: isQwen ? ['4', 1] : ['5', 0], latent_image: latent,
    denoise: isQwen || !referenceNames.length ? 1 : denoise ?? (isMoss ? 0.55 : 0.75),
  });
  graph['9'] = node('VAEDecodeTiled', { samples: ['8', 0], vae: ['3', 0], ...tiledVae });
  graph['90'] = node('SaveImage', { images: ['9', 0], filename_prefix: `Tavern/Images/${model}/${mode}` });
  return { graph, width, height, mode, seed };
}

export function comfyRoot(baseUrl: string) {
  const root = baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/(?:prompt|history|view|upload\/image)$/, '');
  if (!/^https?:\/\//i.test(root)) throw new Error('请填写 ComfyUI 的 HTTP 地址，例如 http://127.0.0.1:8188。');
  return root;
}

function headers(settings: ComfyApiSettings): Record<string, string> {
  const key = settings.apiKey?.trim();
  if (!key || settings.auth === 'none') return {};
  return settings.auth === 'x-api-key' ? { 'x-api-key': key } : { Authorization: `Bearer ${key}` };
}

function aborted() { const error = new Error('图像任务已停止等待；已提交的 ComfyUI 任务可稍后恢复。'); error.name = 'AbortError'; return error; }

async function jsonRequest(base: string, path: string, settings: ComfyApiSettings, fetchImpl: typeof fetch,
  signal?: AbortSignal, payload?: unknown) {
  const label = path === '/prompt' ? '提交 ComfyUI 工作流' : path === '/queue' ? '查询队列' : '查询任务结果';
  return traceImageRequest(settings.debugTrace,
    { label, url: `${base}${path}`, method: payload === undefined ? 'GET' : 'POST', body: payload }, async (report) => {
      if (signal?.aborted) throw aborted();
      const response = await fetchImpl(`${base}${path}`, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: { ...headers(settings), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        signal, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      report(response.status);
      const raw = await response.text();
      let data: Record<string, unknown>;
      try { data = asRecord(JSON.parse(raw)); } catch {
        report(response.status, raw);
        throw new Error(`ComfyUI 返回了无效数据（HTTP ${response.status}）。`);
      }
      report(response.status, data);
      if (!response.ok) {
        const details = asRecord(data.error);
        const nodeErrors = asRecord(data.node_errors);
        const hint = Object.keys(nodeErrors).length ? '请检查本地模型文件及 TavernFitReference/TavernComicPage 节点是否已安装。' : '';
        throw new Error(`ComfyUI 请求失败：${String(details.message || data.error || response.status)}。${hint}`);
      }
      return data;
    });
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function uploadComfyImage(uri: string, settings: ComfyApiSettings, fetchImpl: typeof fetch = globalThis.fetch, signal?: AbortSignal) {
  const inline = await readNovelImageAsInlineData(uri);
  if (signal?.aborted) throw aborted();
  if (!/^image\/[a-z0-9.+-]+$/i.test(inline.mimeType)) throw new Error('参考文件须为图片。');
  const decoded = atob(inline.base64);
  const boundary = `tavern-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Every header character is ASCII (the filename is fixed and MIME is validated).
  const encodeHeader = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
  const head = encodeHeader(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="tavern-reference.png"\r\nContent-Type: ${inline.mimeType}\r\n\r\n`);
  const tail = encodeHeader(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + decoded.length + tail.length);
  body.set(head);
  for (let index = 0; index < decoded.length; index += 1) body[head.length + index] = decoded.charCodeAt(index);
  body.set(tail, head.length + decoded.length);
  const url = `${comfyRoot(settings.baseUrl)}/upload/image`;
  return traceImageRequest(settings.debugTrace, { label: '上传参考图', url, method: 'POST',
    body: { contentType: 'multipart/form-data', filename: 'tavern-reference.png', mimeType: inline.mimeType, bytes: decoded.length } }, async (report) => {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { ...headers(settings), 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer, signal,
      });
      report(response.status);
      const data = asRecord(await response.json());
      report(response.status, data);
      if (!response.ok || typeof data.name !== 'string') throw new Error(`参考图上传失败（HTTP ${response.status}）。`);
      const subfolder = typeof data.subfolder === 'string' ? data.subfolder : '';
      return subfolder ? `${subfolder}/${data.name}` : data.name;
    });
}

export function comfyOutputUrl(baseUrl: string, output: ComfyImageOutput) {
  const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder, type: output.type });
  return `${comfyRoot(baseUrl)}/view?${params.toString()}`;
}

/** Only observes this prompt ID; stopping one client never interrupts another user's GPU job. */
export function executeComfyWorkflow(options: Parameters<typeof executeComfyWorkflowRequest>[0]) {
  return withImageRequestTrace(options.apiSettings, 'ComfyUI workflow', 'workflow', undefined,
    (debugTrace) => executeComfyWorkflowRequest({ ...options, apiSettings: { ...options.apiSettings, debugTrace } }));
}

async function executeComfyWorkflowRequest({ apiSettings, graph, resumePromptId, fetchImpl = globalThis.fetch,
  signal, onSubmitted, onProgress, outputNodeId = '90', timeoutMs = 20 * 60_000, pollIntervalMs = 1500,
}: {
  apiSettings: ComfyApiSettings;
  graph?: ComfyWorkflow;
  resumePromptId?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onSubmitted?: ImageGenerationOptions['onSubmitted'];
  onProgress?: ImageGenerationOptions['onProgress'];
  outputNodeId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ source: GeneratedImageSource; promptId: string; output: ComfyImageOutput }> {
  const base = comfyRoot(apiSettings.baseUrl);
  let promptId = resumePromptId;
  if (promptId) apiSettings.debugTrace?.progress('恢复已有任务，不重复提交工作流', promptId);
  if (!promptId) {
    if (!graph) throw new Error('缺少生图工作流。');
    const response = await jsonRequest(base, '/prompt', apiSettings, fetchImpl, signal, {
      prompt: graph, client_id: `tavern-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (typeof response.prompt_id !== 'string') throw new Error('ComfyUI 未返回任务编号。');
    promptId = response.prompt_id;
    apiSettings.debugTrace?.progress('已提交 ComfyUI 工作流', promptId);
    await onSubmitted?.(promptId);
  }
  onProgress?.({ phase: 'queued', promptId, message: '已进入 ComfyUI 队列' });
  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  let missingResumeChecks = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw aborted();
    const history = await jsonRequest(base, `/history/${encodeURIComponent(promptId)}`, apiSettings, fetchImpl, signal);
    const item = asRecord(history[promptId]);
    const status = asRecord(item.status);
    if (status.status_str === 'error') {
      const messages = Array.isArray(status.messages) ? status.messages : [];
      const failure = messages.find((message) => Array.isArray(message) && message[0] === 'execution_error');
      const details = Array.isArray(failure) ? asRecord(failure[1]) : {};
      const failureError = new Error(`ComfyUI 生成失败：${String(details.exception_message || '请检查工作流与模型加载日志。')}`);
      failureError.name = 'ComfyExecutionError';
      throw failureError;
    }
    const images = asRecord(asRecord(item.outputs)[outputNodeId]).images;
    if (status.status_str === 'success' && Array.isArray(images) && images.length) {
      const file = asRecord(images[0]);
      if (typeof file.filename !== 'string') throw new Error('ComfyUI 输出缺少文件名。');
      const output = { filename: file.filename, subfolder: String(file.subfolder ?? ''), type: String(file.type ?? 'output') };
      onProgress?.({ phase: 'saving', promptId, message: '下载生成图片' });
      const source = await traceImageRequest(apiSettings.debugTrace,
        { label: '下载生成图片', url: comfyOutputUrl(base, output) }, async (report) => {
          const response = await fetchImpl(comfyOutputUrl(base, output), { headers: headers(apiSettings), signal });
          report(response.status);
          if (!response.ok) throw new Error(`生成图片下载失败（HTTP ${response.status}），可恢复此任务重试下载。`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          report(response.status, { ...output, bytes: bytes.length, mimeType: response.headers.get('content-type') });
          const chunks: string[] = [];
          for (let offset = 0; offset < bytes.length; offset += 8192) {
            chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
          }
          return { base64: btoa(chunks.join('')), mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png' };
        });
      return { source, promptId, output };
    }
    if (status.status_str === 'success' || status.completed === true) {
      const error = new Error(status.status_str === 'success'
        ? 'ComfyUI 任务完成但没有返回图片，请重试该幕。'
        : 'ComfyUI 任务被中断，请重试该幕。');
      error.name = 'ComfyExecutionError';
      throw error;
    }
    if (polls++ % 3 === 0) {
      const queue = await jsonRequest(base, '/queue', apiSettings, fetchImpl, signal);
      const running = Array.isArray(queue.queue_running) && queue.queue_running.some((job) => Array.isArray(job) && job[1] === promptId);
      const queued = Array.isArray(queue.queue_pending) && queue.queue_pending.some((job) => Array.isArray(job) && job[1] === promptId);
      if (resumePromptId && !Object.keys(item).length && !running && !queued) {
        if (++missingResumeChecks >= 2) {
          const error = new Error('ComfyUI 找不到已保存的任务，服务可能已重启。请继续生成以重新提交这一幕。');
          error.name = 'ComfyExecutionError';
          throw error;
        }
      } else { missingResumeChecks = 0; }
      onProgress?.({ phase: running ? 'generating' : 'queued', promptId, message: running ? 'ComfyUI 正在生成' : '等待前面的图像任务完成' });
    }
    await delay(pollIntervalMs, signal);
  }
  throw new Error(`图像任务等待超时，可凭任务编号 ${promptId} 恢复，无需重复提交。`);
}

export function generateComfyImage(options: Parameters<typeof generateComfyImageRequest>[0]) {
  return withImageRequestTrace(options.apiSettings, options.model, 'generation', options.prompt,
    (debugTrace) => generateComfyImageRequest({ ...options, apiSettings: { ...options.apiSettings, debugTrace } }));
}

async function generateComfyImageRequest({ apiSettings, model, prompt, fetchImpl = globalThis.fetch, signal,
  referenceImageUri, referenceImageUris, width, height, negativePrompt, seed, denoise, steps,
  resumePromptId, onSubmitted, onProgress,
}: ImageGenerationOptions & {
  apiSettings: ComfyApiSettings;
  model: LocalImageModelId;
  prompt: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const uris = [...new Set([referenceImageUri, ...(referenceImageUris ?? [])].filter((uri): uri is string => Boolean(uri?.trim())).map((uri) => uri.trim()))];
  // Validate before uploading. A resumed job needs no reference-image re-upload.
  const preview = buildComfyImageWorkflow({ model, prompt, width, height, negativePrompt, seed, denoise, steps, referenceNames: uris.map((_, index) => `reference-${index}.png`) });
  await ensureLocalComfyReady({ baseUrl: apiSettings.baseUrl, headers: headers(apiSettings), fetchImpl, signal, onProgress, debugTrace: apiSettings.debugTrace });
  let graph = preview.graph;
  if (!resumePromptId && uris.length) {
    onProgress?.({ phase: 'uploading', message: '上传角色原图' });
    const names: string[] = [];
    for (const uri of uris) names.push(await uploadComfyImage(uri, apiSettings, fetchImpl, signal));
    graph = buildComfyImageWorkflow({ model, prompt, width, height, negativePrompt, seed: preview.seed, denoise, steps, referenceNames: names }).graph;
  }
  const result = await executeComfyWorkflow({ apiSettings, graph, resumePromptId, fetchImpl, signal, onSubmitted, onProgress });
  return { ...result, width: preview.width, height: preview.height, seed: preview.seed, mode: preview.mode };
}
