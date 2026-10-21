import {
  cacheDirectory,
  deleteAsync,
  downloadAsync,
  EncodingType,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

function imageExtension(uri: string, mimeType?: string) {
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('gif')) return 'gif';
  return uri.split('?')[0]?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'jpg';
}

async function materializeImage(uri: string) {
  const trimmed = uri.trim();
  if (!trimmed) throw new Error('没有可保存的图片。');
  if (trimmed.startsWith('file://')) return { uri: trimmed, temporary: false };
  if (!cacheDirectory) throw new Error('设备缓存目录不可用。');

  const dataMatch = trimmed.match(/^data:([^;,]+);base64,(.+)$/s);
  const extension = imageExtension(trimmed, dataMatch?.[1]);
  const target = `${cacheDirectory}persona-${Date.now()}.${extension}`;

  if (dataMatch) {
    await writeAsStringAsync(target, dataMatch[2], {
      encoding: EncodingType.Base64,
    });
    return { uri: target, temporary: true };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    await downloadAsync(trimmed, target);
    return { uri: target, temporary: true };
  }

  if (trimmed.startsWith('/')) {
    return { uri: `file://${trimmed}`, temporary: false };
  }

  throw new Error('当前图片地址无法写入系统相册。');
}

export async function saveImageToDevice(uri: string) {
  const permission = await requestPermissionsAsync(true, ['photo']);
  if (permission.status !== 'granted') {
    throw new Error('未获得相册保存权限。');
  }

  const local = await materializeImage(uri);
  try {
    await Asset.create(local.uri);
  } finally {
    if (local.temporary) {
      await deleteAsync(local.uri, { idempotent: true }).catch(() => undefined);
    }
  }
}
