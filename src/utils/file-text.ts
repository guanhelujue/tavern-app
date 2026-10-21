import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { decodeTextFileBytes } from './text-decoding';

/**
 * Read a picked file's raw text content across platforms.
 *
 * Read bytes before choosing an encoding. Response.text() and native UTF8
 * reads irreversibly replace GBK bytes with U+FFFD before we can inspect them.
 */
export async function readTextFileAsync(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`读取文件失败（${response.status}）`);
    return decodeTextFileBytes(new Uint8Array(await response.arrayBuffer()));
  }
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return decodeTextFileBytes(bytes);
}
