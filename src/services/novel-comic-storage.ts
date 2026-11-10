import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ComicSourceKind, NovelComicDocument } from '../types/novel-comic';

export function comicStorageKey(novelId: string, sourceKind: ComicSourceKind, sourceId: string) {
  return `tavern-comic-v1:${encodeURIComponent(novelId)}:${sourceKind}:${encodeURIComponent(sourceId)}`;
}

/** Native images are durable document-directory files, so this stores only their references. */
export async function saveNovelComic(document: NovelComicDocument) {
  await AsyncStorage.setItem(comicStorageKey(document.novelId, document.sourceKind, document.sourceId), JSON.stringify(document));
}

export async function loadNovelComic(novelId: string, sourceKind: ComicSourceKind, sourceId: string): Promise<NovelComicDocument | null> {
  const raw = await AsyncStorage.getItem(comicStorageKey(novelId, sourceKind, sourceId));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as NovelComicDocument;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.pages) || parsed.novelId !== novelId
    || parsed.sourceId !== sourceId || parsed.sourceKind !== sourceKind) {
    throw new Error('已保存的分镜数据格式不兼容，请先导出备份再重新规划。');
  }
  return parsed;
}
