import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAutoStartLocalComfy, ensureLocalComfyReady } from './local-comfy-launcher';

const baseUrl = 'http://127.0.0.1:8188';
const pageUrl = 'http://localhost:8081/explore';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ready = () => json({ system: { comfyui_version: 'test' } });
afterEach(() => vi.unstubAllGlobals());

describe('local ComfyUI startup', () => {
  it.each([
    ['http://192.168.1.2:8188', pageUrl],
    ['http://127.0.0.1:8189', pageUrl],
    ['http://127.0.0.1:8188/proxy', pageUrl],
    ['http://user:pass@127.0.0.1:8188', pageUrl],
    ['http://127.0.0.1:8188?command=start', pageUrl],
    [baseUrl, 'https://example.com'],
    [baseUrl, 'http://localhost.evil.test:8081'],
  ])('does not launch for %s from %s', async (baseUrl, pageUrl) => {
    const fetchImpl = vi.fn();
    expect(canAutoStartLocalComfy(baseUrl, pageUrl)).toBe(false);
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reuses a running server without calling the process bridge', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ready());
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${baseUrl}/system_stats`);
  });

  it('starts once, waits for readiness and preserves model-independent settings', async () => {
    let probes = 0;
    const progress: string[] = [];
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url).endsWith('/system_stats')) {
        if (++probes === 1) throw new TypeError('offline');
        expect(init?.headers).toEqual({ Authorization: 'Bearer local-key' });
        return ready();
      }
      expect(String(url)).toContain('http://localhost:8081/api/local-comfy');
      expect(init?.headers).toEqual({ 'X-Tavern-Local-Launch': '1', 'Content-Type': 'application/json' });
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ baseUrl });
        return json({ state: 'starting' });
      }
      return json({ state: 'ready' });
    });
    await ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl, headers: { Authorization: 'Bearer local-key' }, pollIntervalMs: 0, onProgress: (p) => progress.push(p.message ?? '') });
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(progress.some((message) => message.includes('后台启动'))).toBe(true);
    expect(progress.at(-1)).toContain('已就绪');
  });

  it.each([403, 500])('does not try to start over a server returning HTTP %s', async (status) => {
    const fetchImpl = vi.fn(async () => json({}, status));
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).rejects.toThrow(`HTTP ${status}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a different service on port 8188 without launching', async () => {
    const fetchImpl = vi.fn(async () => json({ healthy: true }));
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).rejects.toThrow('不是 ComfyUI');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable launcher on static exports', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/system_stats')) throw new TypeError('offline');
      return new Response('<html>static app</html>');
    });
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).rejects.toThrow('重启酒馆网页服务');
  });

  it('surfaces launch failures and a usable log path', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/system_stats')) throw new TypeError('offline');
      return json({ state: 'failed', message: '未找到秋叶 Python', logPath: 'output/comfy-api-server/launcher.log' });
    });
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).rejects.toThrow('未找到秋叶 Python 日志：output/');
  });

  it('distinguishes browser access failure from an offline server', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/system_stats')) throw new TypeError('CORS blocked');
      return json({ state: 'ready' });
    });
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl })).rejects.toThrow('网页仍无法访问');
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/api/local-comfy'))).toHaveLength(1);
  });

  it('cancels before starting without making a request', async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn();
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels a startup wait without interrupting the shared service', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/system_stats')) throw new TypeError('offline');
      controller.abort(); return json({ state: 'starting' });
    });
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl.mock.calls).toHaveLength(2);
    expect(fetchImpl.mock.calls.some(([url]) => /interrupt|shutdown/.test(String(url)))).toBe(false);
  });

  it('bounds startup waiting and does not repeat the start request', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith('/system_stats')) throw new TypeError('offline');
      return json({ state: 'starting' });
    });
    await expect(ensureLocalComfyReady({ baseUrl, pageUrl, fetchImpl, timeoutMs: 0 })).rejects.toThrow('启动超时');
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });
});
