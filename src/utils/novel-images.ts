import {
  copyAsync,
  documentDirectory,
  downloadAsync,
  EncodingType,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { GeneratedImageSource } from '@/types/image-generation';

export const DEFAULT_CHAT_BACKGROUND_OPACITY = 0.35;
export const MIN_CHAT_BACKGROUND_OPACITY = 0.05;
export const MAX_CHAT_BACKGROUND_OPACITY = 1;

const NOVEL_IMAGE_DIR = 'novel-images';
const NOVEL_VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']);

function getExtension(uri: string, fallback = 'jpg') {
  const match = uri.split('?')[0]?.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || fallback;
}

function isRemoteOrInlineUri(uri: string) {
  return (
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('blob:') ||
    uri.startsWith('data:')
  );
}

/** Ensure local filesystem paths are loadable by expo-image on native. */
function ensureFileUri(uri: string) {
  const trimmed = uri.trim();
  if (!trimmed || isRemoteOrInlineUri(trimmed) || trimmed.startsWith('content://')) {
    return trimmed;
  }

  if (trimmed.startsWith('file://')) {
    return trimmed;
  }

  // Absolute native paths without scheme (rare, but seen after some migrations).
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `file://${trimmed}`;
  }

  return trimmed;
}

/** Persist only a stable relative key for app-document files. */
export function toStoredNovelImageRef(uri: string) {
  const trimmed = uri.trim();

  if (!trimmed || isRemoteOrInlineUri(trimmed) || trimmed.startsWith('content://')) {
    return trimmed;
  }

  if (trimmed.startsWith(`${NOVEL_IMAGE_DIR}/`)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const marker = `/${NOVEL_IMAGE_DIR}/`;
  const index = normalized.indexOf(marker);

  if (index >= 0) {
    return normalized.slice(index + 1);
  }

  // Also accept bare "novel-images/..." without leading slash variants.
  const bareIndex = normalized.indexOf(`${NOVEL_IMAGE_DIR}/`);
  if (bareIndex >= 0) {
    return normalized.slice(bareIndex);
  }

  return trimmed;
}

/**
 * Resolve a stored image ref to a loadable URI at runtime.
 * Absolute documentDirectory paths break after app reinstall/update — remap them.
 */
export function resolveNovelImageUri(stored?: string | null) {
  const trimmed = stored?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (isRemoteOrInlineUri(trimmed)) {
    // blob: URLs from web cannot load on native — treat as missing there.
    if (Platform.OS !== 'web' && trimmed.startsWith('blob:')) {
      return undefined;
    }
    return trimmed;
  }

  if (trimmed.startsWith(`${NOVEL_IMAGE_DIR}/`)) {
    if (!documentDirectory) {
      return undefined;
    }
    return ensureFileUri(`${documentDirectory}${trimmed}`);
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const marker = `/${NOVEL_IMAGE_DIR}/`;
  const index = normalized.indexOf(marker);

  if (index >= 0) {
    if (!documentDirectory) {
      return undefined;
    }
    return ensureFileUri(`${documentDirectory}${normalized.slice(index + 1)}`);
  }

  const bareIndex = normalized.indexOf(`${NOVEL_IMAGE_DIR}/`);
  if (bareIndex >= 0) {
    if (!documentDirectory) {
      return undefined;
    }
    return ensureFileUri(`${documentDirectory}${normalized.slice(bareIndex)}`);
  }

  return ensureFileUri(trimmed);
}

function mimeTypeFromImageUri(uri: string) {
  const extension = getExtension(uri, '').toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'avif') return 'image/avif';
  return 'image/jpeg';
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return output;
}

/** Read a stored portrait into a provider-neutral inline image payload. */
export async function readNovelImageAsInlineData(storedUri: string) {
  const resolved = resolveNovelImageUri(storedUri)?.trim() ?? '';
  if (!resolved) throw new Error('无法读取当前立绘。');

  const dataMatch = resolved.match(/^data:([^;,]+)?(;base64)?,(.*)$/is);
  if (dataMatch?.[2]) {
    const mimeType = dataMatch[1]?.trim() || 'image/jpeg';
    const base64 = dataMatch[3]?.trim() || '';
    if (!base64) throw new Error('当前立绘没有可读取的图像数据。');
    return { mimeType, base64, dataUri: `data:${mimeType};base64,${base64}` };
  }

  if (/^(?:https?:|blob:)/i.test(resolved)) {
    const response = await fetch(resolved);
    if (!response.ok) throw new Error(`读取立绘失败（HTTP ${response.status}）。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim()
      || mimeTypeFromImageUri(resolved);
    const base64 = bytesToBase64(bytes);
    return { mimeType, base64, dataUri: `data:${mimeType};base64,${base64}` };
  }

  const base64 = await readAsStringAsync(resolved, { encoding: EncodingType.Base64 });
  if (!base64) throw new Error('当前立绘没有可读取的图像数据。');
  const mimeType = mimeTypeFromImageUri(resolved);
  return { mimeType, base64, dataUri: `data:${mimeType};base64,${base64}` };
}

async function ensureNovelImageDir() {
  if (!documentDirectory) {
    return null;
  }

  const directory = `${documentDirectory}${NOVEL_IMAGE_DIR}/`;

  try {
    await makeDirectoryAsync(directory, { intermediates: true });
  } catch {
    // Directory may already exist.
  }

  return directory;
}

async function copyPickedImageToTarget(sourceUri: string, targetUri: string) {
  try {
    await copyAsync({
      from: sourceUri,
      to: targetUri,
    });
  } catch {
    // Android Photo Picker content:// sometimes rejects copyAsync — fall back to base64.
    const base64 = await readAsStringAsync(sourceUri, { encoding: EncodingType.Base64 });
    await writeAsStringAsync(targetUri, base64, { encoding: EncodingType.Base64 });
  }

  const info = await getInfoAsync(targetUri);
  if (!info.exists) {
    throw new Error('图片保存失败，请重试。');
  }
}

export async function persistPickedImage(sourceUri: string, kind: 'cover' | 'background') {
  if (Platform.OS === 'web') {
    return persistWebImageUri(sourceUri);
  }

  const directory = await ensureNovelImageDir();

  if (!directory) {
    throw new Error('无法访问应用存储目录，请检查存储权限后重试。');
  }

  const extension = getExtension(sourceUri);
  const fileName = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const targetUri = `${directory}${fileName}`;

  await copyPickedImageToTarget(sourceUri, targetUri);

  // Store relative path so reinstalls/updates don't break the image.
  return `${NOVEL_IMAGE_DIR}/${fileName}`;
}

function extensionFromMimeType(mimeType?: string) {
  const normalized = mimeType?.toLowerCase().split(';')[0].trim();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'png';
}

function splitDataUri(uri: string) {
  const match = uri.match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/is);
  if (!match) return undefined;
  return {
    mimeType: match[1]?.trim() || undefined,
    data: match[2] ?? '',
  };
}

/**
 * Browser image-picker results are commonly temporary `blob:` URLs. Keep a
 * data URI in the persisted novel state instead; blob URLs are revoked when
 * the page/session is recreated and therefore cannot survive a reload. Remote
 * generated-image URLs are converted on a best-effort basis because some
 * providers also issue expiring links.
 */
async function persistWebImageUri(sourceUri: string) {
  const trimmed = sourceUri.trim();
  const isBlob = /^blob:/i.test(trimmed);
  const isRemote = /^https?:/i.test(trimmed);
  if (!trimmed || (!isBlob && !isRemote)) {
    return trimmed;
  }

  try {
    const response = await fetch(trimmed);
    if (!response.ok) {
      throw new Error(`无法读取图片（HTTP ${response.status}）。`);
    }

    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
          resolve(reader.result);
        } else {
          reject(new Error('无法将图片转换为可保存格式。'));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error('读取图片失败。'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    // A blob URL must be converted or the selected image will disappear after
    // reload. For remote URLs, keep the original as a graceful CORS fallback.
    if (isBlob) {
      throw error;
    }
    return trimmed;
  }
}

/** Save an image returned by a remote model and return a stable relative ref. */
export async function persistGeneratedImage(
  source: GeneratedImageSource,
  kind: 'cover' | 'background' | 'portrait' | 'scene',
) {
  const sourceUri = source.uri?.trim() ?? '';
  const dataUri = sourceUri ? splitDataUri(sourceUri) : undefined;
  const base64 = source.base64?.trim() || dataUri?.data || '';
  const mimeType = source.mimeType || dataUri?.mimeType;

  if (Platform.OS === 'web') {
    if (sourceUri) return persistWebImageUri(sourceUri);
    if (base64) return `data:${mimeType || 'image/png'};base64,${base64}`;
    throw new Error('图像模型未返回可显示的图片。');
  }

  const directory = await ensureNovelImageDir();
  if (!directory) throw new Error('无法访问应用存储目录，图片未保存。');

  const extension = sourceUri && !dataUri ? getExtension(sourceUri, extensionFromMimeType(mimeType)) : extensionFromMimeType(mimeType);
  const fileName = `generated-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const targetUri = `${directory}${fileName}`;

  if (base64) {
    await writeAsStringAsync(targetUri, base64, { encoding: EncodingType.Base64 });
  } else if (/^https?:\/\//i.test(sourceUri)) {
    await downloadAsync(sourceUri, targetUri);
  } else {
    throw new Error('图像模型返回了无法保存的图片地址。');
  }

  const info = await getInfoAsync(targetUri);
  if (!info.exists) throw new Error('生成图片保存失败，请重试。');
  return `${NOVEL_IMAGE_DIR}/${fileName}`;
}

export async function persistPickedVideo(sourceUri: string) {
  if (Platform.OS === 'web') {
    return sourceUri;
  }

  const directory = await ensureNovelImageDir();

  if (!directory) {
    throw new Error('无法访问应用存储目录，请检查存储权限后重试。');
  }

  const extension = getExtension(sourceUri, 'mp4');
  const fileName = `background-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const targetUri = `${directory}${fileName}`;

  await copyPickedImageToTarget(sourceUri, targetUri);

  return `${NOVEL_IMAGE_DIR}/${fileName}`;
}

export async function pickNovelImage(kind: 'cover' | 'background' | 'portrait') {
  // Web uses a file input — no media-library permission API.
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('需要相册权限才能选择图片。请在系统设置中允许访问照片。');
    }
  }

  const cropPortrait = kind === 'cover' || kind === 'portrait';
  // Expo SDK 57 only honors a custom crop aspect on Android. Crop chat
  // backgrounds to the same portrait ratio as the bundled backdrops so
  // contentFit="cover" does not silently hide large parts of arbitrary photos.
  // Keep the original asset on web and iOS; iOS forces the crop UI to a square.
  const cropBackground = kind === 'background' && Platform.OS === 'android';
  const allowsEditing = Platform.OS !== 'web' && (cropPortrait || cropBackground);
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing,
    aspect: cropBackground ? [9, 16] : cropPortrait ? [3, 4] : undefined,
    quality: 0.85,
  });

  if (result.canceled || !result.assets[0]?.uri) {
    return null;
  }

  return persistPickedImage(result.assets[0].uri, kind === 'portrait' ? 'cover' : kind);
}

export async function pickNovelVideo() {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('需要相册权限才能选择视频背景。请在系统设置中允许访问照片和视频。');
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
  });

  if (result.canceled || !result.assets[0]?.uri) {
    return null;
  }

  return persistPickedVideo(result.assets[0].uri);
}

/** Pick either an image or a video for a novel conversation background. */
export async function pickNovelBackground() {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('需要相册权限才能选择对话背景。请在系统设置中允许访问照片和视频。');
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    quality: 0.85,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset?.uri) return null;
  return asset.type === 'video'
    ? persistPickedVideo(asset.uri)
    : persistPickedImage(asset.uri, 'background');
}

export function isNovelVideoUri(uri?: string | null) {
  const value = uri?.split('?')[0].toLowerCase() ?? '';
  const extension = value.match(/\.([a-z0-9]+)$/)?.[1];
  return Boolean(extension && NOVEL_VIDEO_EXTENSIONS.has(extension));
}


export function clampChatBackgroundOpacity(value: number) {
  if (Number.isNaN(value)) {
    return DEFAULT_CHAT_BACKGROUND_OPACITY;
  }

  return Math.min(MAX_CHAT_BACKGROUND_OPACITY, Math.max(MIN_CHAT_BACKGROUND_OPACITY, value));
}
