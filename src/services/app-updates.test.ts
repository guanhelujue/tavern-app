import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForAppUpdate, compareAppVersions, selectAppUpdateAsset } from './app-updates';
import type { AppRelease } from './app-updates';

const asset = (name: string, tag = 'v1.10.0', size = 12, url = `https://github.com/guanhelujue/tavern-app/releases/download/${tag}/${name}`) => ({ name, browserDownloadUrl: url, size });
const release = (tag = 'v1.10.0') => ({ tag_name: tag, name: tag, body: '', published_at: null, html_url: `https://github.com/guanhelujue/tavern-app/releases/tag/${tag}`, draft: false, prerelease: false, assets: ['full', 'standard'].map((variant) => ({ name: `guanhelujue-${variant}.apk`, browser_download_url: `https://github.com/guanhelujue/tavern-app/releases/download/${tag}/guanhelujue-${variant}.apk`, size: 12, state: 'uploaded' })) });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('app updates', () => {
  it('compares semantic versions numerically and prereleases below stable', () => {
    expect(compareAppVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareAppVersions('v1.0.0-beta.1+build', '1.0.0')).toBe(-1);
    expect(compareAppVersions('1.0.0', '1.0.0+build')).toBe(0);
    expect(() => compareAppVersions('1.01.0', '1.0.0')).toThrow();
  });
  it('selects exact uploaded variant assets and rejects URL spoofing or missing assets', () => {
    const parsed = { tagName: 'v1.10.0', name: 'v1.10.0', body: '', publishedAt: null, htmlUrl: 'https://github.com/guanhelujue/tavern-app/releases/tag/v1.10.0', assets: [asset('guanhelujue-standard.apk')] } as AppRelease;
    expect(selectAppUpdateAsset(parsed, 'standard')?.name).toBe('guanhelujue-standard.apk');
    expect(selectAppUpdateAsset({ ...parsed, assets: [{ ...asset('guanhelujue-standard.apk'), browserDownloadUrl: 'https://github.com/guanhelujue/tavern-app-evil/releases/download/v1.10.0/guanhelujue-standard.apk' }] }, 'standard')).toBeUndefined();
    expect(selectAppUpdateAsset({ ...parsed, assets: [{ ...asset('guanhelujue-standard.apk'), size: 0 }] }, 'standard')).toBeUndefined();
  });
  it.each([['newer', '1.0.0', 'update-available'], ['equal', '1.10.0', 'up-to-date'], ['local newer', '2.0.0', 'local-newer']])('reports %s release state', async (_label, current, status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(release()), { status: 200 })));
    await expect(checkForAppUpdate(current, 'full')).resolves.toMatchObject({ status });
  });
  it.each([404, 403, 429])('reports GitHub status %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow(status === 404 ? '尚未公开' : '请求受限');
  });
  it('rejects malformed releases and handles timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow('无效');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('AbortError'), { name: 'AbortError' })));
    await expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow('超时');
  });

  it('fetches latest and selects the matching standard APK from the actual API schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(release()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await checkForAppUpdate('1.0.0', 'standard');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/guanhelujue/tavern-app/releases/latest');
    expect(result.matchingAsset?.name).toBe('guanhelujue-standard.apk');
    expect(result.matchingAsset?.browserDownloadUrl).toContain('/releases/download/v1.10.0/guanhelujue-standard.apk');
  });

  it.each([{ draft: true }, { prerelease: true }, { tag_name: 'latest' }, { html_url: 'https://github.com/guanhelujue/tavern-app-evil/releases/tag/v1.10.0' }])('rejects unsuitable releases: %j', async (patch) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...release(), ...patch }))));
    await expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow();
  });

  it('keeps release navigation available when an APK is missing or not uploaded', async () => {
    const payload = release();
    payload.assets[0].state = 'new';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
    const result = await checkForAppUpdate('1.0.0', 'full');
    expect(result.status).toBe('update-available');
    expect(result.matchingAsset).toBeUndefined();
    expect(result.latest.htmlUrl).toContain('/releases/tag/v1.10.0');
  });

  it('aborts an unresponsive request after fifteen seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const check = expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });

  it('reports network errors without claiming the app is up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(checkForAppUpdate('1.0.0', 'full')).rejects.toThrow('网络异常');
  });
});
