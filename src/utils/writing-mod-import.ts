import * as DocumentPicker from 'expo-document-picker';
import { readTextFileAsync } from './file-text';
import type { WritingModSample } from './writing-mods';

/** MOD extraction reads the complete file; the separate short-style sampler is not used. */
export async function pickWritingModArticle(): Promise<WritingModSample | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/plain', 'text/markdown', 'text/*', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const asset = result.assets[0];
  const text = await readTextFileAsync(asset.uri);
  if (!text.trim()) throw new Error('文件为空，请选择包含正文的文本文件。');
  return { name: asset.name?.trim() || '未命名.txt', text };
}
