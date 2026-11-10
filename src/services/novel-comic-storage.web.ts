import type { ComicSourceKind, NovelComicDocument } from '../types/novel-comic';

function key(novelId: string, sourceKind: ComicSourceKind, sourceId: string) {
  return JSON.stringify([novelId, sourceKind, sourceId]);
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持离线分镜存储。')); return; }
    const request = indexedDB.open('tavern-comics', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开分镜存储。'));
    request.onblocked = () => reject(new Error('分镜存储被旧页面占用，请关闭旧标签页后重试。'));
  });
}

/** IndexedDB avoids the small localStorage quota for a chapter's full-resolution photographs. */
export async function saveNovelComic(document: NovelComicDocument) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put(document, key(document.novelId, document.sourceKind, document.sourceId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('分镜图片保存失败，请检查浏览器存储空间。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('分镜图片保存被中断。'));
    });
  } finally { db.close(); }
}

export async function loadNovelComic(novelId: string, sourceKind: ComicSourceKind, sourceId: string): Promise<NovelComicDocument | null> {
  const db = await openDatabase();
  try {
    const parsed = await new Promise<NovelComicDocument | undefined>((resolve, reject) => {
      const request = db.transaction('documents', 'readonly').objectStore('documents').get(key(novelId, sourceKind, sourceId));
      request.onsuccess = () => resolve(request.result as NovelComicDocument | undefined);
      request.onerror = () => reject(request.error ?? new Error('分镜图片读取失败。'));
    });
    if (!parsed) return null;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.pages) || parsed.novelId !== novelId
      || parsed.sourceId !== sourceId || parsed.sourceKind !== sourceKind) {
      throw new Error('已保存的分镜数据格式不兼容，请先导出备份再重新规划。');
    }
    return parsed;
  } finally { db.close(); }
}
