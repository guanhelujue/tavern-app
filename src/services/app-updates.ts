import { ENABLE_QUICK_TRAVEL } from '@/config/build-features';
import { APP_UPDATE_REPOSITORY, APP_UPDATE_TIMEOUT_MS, type AppBuildVariant } from '@/config/app-update';

export type AppReleaseAsset = { name: string; browserDownloadUrl: string; size?: number };
export type AppRelease = { tagName: string; name: string; body: string; publishedAt: string | null; htmlUrl: string; assets: AppReleaseAsset[] };
export type AppUpdateCheckResult = { status: 'update-available' | 'up-to-date' | 'local-newer'; currentVersion: string; latest: AppRelease; matchingAsset?: AppReleaseAsset; variant: AppBuildVariant };

const GITHUB_API_URL = `https://api.github.com/repos/${APP_UPDATE_REPOSITORY}/releases/latest`;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string[] };

export function getAppBuildVariant(): AppBuildVariant { return ENABLE_QUICK_TRAVEL ? 'full' : 'standard'; }

function parseVersion(value: string): ParsedVersion {
  const match = value.trim().match(VERSION_PATTERN);
  if (!match) throw new Error(`版本号格式无效：${value}`);
  if ([match[1], match[2], match[3]].some((part) => !Number.isSafeInteger(Number(part)) || (part.length > 1 && part.startsWith('0')))) throw new Error(`版本号格式无效：${value}`);
  if (match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw new Error(`版本号格式无效：${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split('.') ?? [] };
}

export function compareAppVersions(left: string, right: string): number {
  const a = parseVersion(left); const b = parseVersion(right);
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1; if (!b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const av = a.prerelease[i]; const bv = b.prerelease[i];
    if (av === undefined) return -1; if (bv === undefined) return 1; if (av === bv) continue;
    const an = /^\d+$/.test(av); const bn = /^\d+$/.test(bv);
    if (an && bn) return av.length !== bv.length ? (av.length > bv.length ? 1 : -1) : (av > bv ? 1 : -1);
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function repositoryUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && url.pathname.startsWith(`/${APP_UPDATE_REPOSITORY}/`); } catch { return false; }
}
function matchesReleasePath(value: unknown, path: string): value is string {
  if (!repositoryUrl(value)) return false;
  try { return decodeURIComponent(new URL(value).pathname) === `/${APP_UPDATE_REPOSITORY}/releases/${path}`; }
  catch { return false; }
}
function isReleaseUrl(value: unknown, tag: string): value is string { return matchesReleasePath(value, `tag/${tag}`); }
function isAssetUrl(value: unknown, tag: string, name: string): value is string { return matchesReleasePath(value, `download/${tag}/${name}`); }

export function selectAppUpdateAsset(release: AppRelease, variant: AppBuildVariant): AppReleaseAsset | undefined {
  const expected = `guanhelujue-${variant}.apk`.toLowerCase();
  return release.assets.find((asset) => asset.name.toLowerCase() === expected && typeof asset.size === 'number' && asset.size > 0 && isAssetUrl(asset.browserDownloadUrl, release.tagName, asset.name));
}

function parseRelease(value: unknown): AppRelease {
  if (!value || typeof value !== 'object') throw new Error('GitHub 返回的版本数据无效。');
  const item = value as Record<string, unknown>; const tag = typeof item.tag_name === 'string' ? item.tag_name : '';
  if (!tag || item.draft !== false || item.prerelease !== false || !isReleaseUrl(item.html_url, tag)) throw new Error('GitHub 返回的正式 Release 无效。');
  parseVersion(tag);
  const assets = Array.isArray(item.assets) ? item.assets.flatMap((asset) => {
    if (!asset || typeof asset !== 'object') return [];
    const entry = asset as Record<string, unknown>;
    return entry.state === 'uploaded' && typeof entry.name === 'string' && typeof entry.browser_download_url === 'string' && typeof entry.size === 'number' && entry.size > 0 && isAssetUrl(entry.browser_download_url, tag, entry.name) ? [{ name: entry.name, browserDownloadUrl: entry.browser_download_url, size: entry.size }] : [];
  }) : [];
  return { tagName: tag, name: typeof item.name === 'string' && item.name.trim() ? item.name : tag, body: typeof item.body === 'string' ? item.body : '', publishedAt: typeof item.published_at === 'string' ? item.published_at : null, htmlUrl: item.html_url as string, assets };
}

async function fetchRelease(): Promise<unknown> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), APP_UPDATE_TIMEOUT_MS);
  try {
    const response = await fetch(GITHUB_API_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
    if (!response.ok) { if (response.status === 404) throw new Error('GitHub 仓库或 Release 尚未公开。'); if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求受限，请稍后重试。'); throw new Error(`GitHub 检查失败（${response.status}）。`); }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new Error('检查更新超时，请稍后重试。');
    if (error instanceof Error && error.message.startsWith('GitHub ')) throw error;
    throw new Error('网络异常，无法检查更新，请稍后重试。');
  } finally { clearTimeout(timer); }
}

export async function checkForAppUpdate(currentVersion: string, variant: AppBuildVariant): Promise<AppUpdateCheckResult> {
  parseVersion(currentVersion); const latest = parseRelease(await fetchRelease()); const comparison = compareAppVersions(latest.tagName, currentVersion);
  return { status: comparison > 0 ? 'update-available' : comparison < 0 ? 'local-newer' : 'up-to-date', currentVersion, latest, matchingAsset: selectAppUpdateAsset(latest, variant), variant };
}
