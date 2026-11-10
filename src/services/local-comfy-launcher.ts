import type { ImageGenerationOptions } from '../types/image-generation';
import { asRecord } from '../utils/helpers';
import { traceImageRequest, type ImageRequestTrace } from './image-request-trace';

const LAUNCHER_PATH = '/api/local-comfy';
const BRIDGE_UNAVAILABLE = '当前网页未接入本地启动服务，请重启酒馆网页服务后重试。';

function currentPageUrl() {
  return typeof window !== 'undefined' ? window.location?.href : undefined;
}

/** A phone, remote connection or exported website must never launch this PC's processes. */
export function canAutoStartLocalComfy(baseUrl: string, pageUrl = currentPageUrl()) {
  if (!pageUrl) return false;
  try {
    const page = new URL(pageUrl);
    const target = new URL(baseUrl);
    return page.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname)
      && target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)
      && target.port === '8188' && target.pathname === '/' && !target.search && !target.hash
      && !target.username && !target.password;
  } catch { return false; }
}

function abortError() {
  const error = new Error('已停止等待本地服务，本次不会继续提交生图请求。');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

async function requestJson(url: string, init: RequestInit, fetchImpl: typeof fetch, signal?: AbortSignal, timeoutMs = 5000, debugTrace?: ImageRequestTrace) {
  return traceImageRequest(debugTrace, { label: url.includes('/system_stats') ? '检查 ComfyUI 服务' : '本地启动服务',
    url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }, async (report) => {
    checkAbort(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      report(response.status);
      const data = asRecord(await response.json().catch(() => null));
      report(response.status, data);
      checkAbort(signal);
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      checkAbort(signal);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  });
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Readiness only: no model weights or image jobs are loaded by this operation. */
export async function ensureLocalComfyReady({
  baseUrl, headers = {}, fetchImpl = globalThis.fetch, signal, onProgress,
  pageUrl = currentPageUrl(), timeoutMs = 195_000, pollIntervalMs = 1500,
  debugTrace,
}: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: ImageGenerationOptions['onProgress'];
  pageUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  debugTrace?: ImageRequestTrace;
}) {
  if (!canAutoStartLocalComfy(baseUrl, pageUrl)) return false;
  checkAbort(signal);
  const root = baseUrl.trim().replace(/\/+$/, '');
  const bridgeUrl = new URL(LAUNCHER_PATH, pageUrl).href;
  async function isReady() {
    let result;
    try { result = await requestJson(`${root}/system_stats`, { headers }, fetchImpl, signal, 3000, debugTrace); }
    catch { checkAbort(signal); return false; }
    if (!result.ok) throw new Error(`本地 ComfyUI 返回 HTTP ${result.status}，请检查图像接口地址与权限。`);
    if (typeof asRecord(result.data.system).comfyui_version !== 'string') {
      throw new Error('8188 端口返回的不是 ComfyUI 状态，请检查本地图像接口。');
    }
    return true;
  }
  onProgress?.({ phase: 'starting', message: '检查本地 ComfyUI 服务…' });
  if (await isReady()) return true;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const bridgeHeaders = { 'X-Tavern-Local-Launch': '1', 'Content-Type': 'application/json' };
  async function bridgeRequest(method: 'GET' | 'POST') {
    let result;
    try {
      result = await requestJson(method === 'GET' ? `${bridgeUrl}?baseUrl=${encodeURIComponent(root)}` : bridgeUrl, {
        method, headers: bridgeHeaders, ...(method === 'POST' ? { body: JSON.stringify({ baseUrl: root }) } : {}),
      }, fetchImpl, signal, 5000, debugTrace);
    } catch { checkAbort(signal); throw new Error(BRIDGE_UNAVAILABLE); }
    if (!result.ok) throw new Error(typeof result.data.message === 'string'
      ? result.data.message : typeof result.data.error === 'string' ? result.data.error : BRIDGE_UNAVAILABLE);
    if (!['starting', 'ready', 'stopped', 'failed'].includes(String(result.data.state))) throw new Error(BRIDGE_UNAVAILABLE);
    return result.data;
  }

  onProgress?.({ phase: 'starting', message: 'ComfyUI 未连接，正在后台启动，就绪后继续生成…' });
  let state = await bridgeRequest('POST');
  while (true) {
    checkAbort(signal);
    if (state.state === 'failed' || state.state === 'stopped') {
      throw new Error(`${typeof state.message === 'string' ? state.message : 'ComfyUI 启动失败，请重试。'}${typeof state.logPath === 'string' ? ` 日志：${state.logPath}` : ''}`);
    }
    if (state.state === 'ready') {
      if (!await isReady()) throw new Error('ComfyUI 已运行，但网页仍无法访问。请检查跨域配置；后台启动脚本已包含所需参数，当前运行的进程不会被强制重启。');
      onProgress?.({ phase: 'starting', message: 'ComfyUI 已就绪，继续生成…' });
      return true;
    }
    if (Date.now() >= deadline) throw new Error('等待 ComfyUI 启动超时。请查看 output/comfy-api-server/launcher.log 后重试，本次尚未提交生图任务。');
    onProgress?.({ phase: 'starting', message: `正在后台启动 ComfyUI（${Math.floor((Date.now() - startedAt) / 1000)} 秒），就绪后继续生成…` });
    await wait(pollIntervalMs, signal);
    state = await bridgeRequest('GET');
  }
}
