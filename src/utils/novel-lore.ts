import {
  MAX_NOVEL_LORE_CONTENT_LENGTH,
  NOVEL_LORE_TYPE_LABELS,
  SYSTEM_NOVEL_LORE_COLLECTIONS,
  getSystemLoreCollectionId,
  isNovelLoreTypeId,
  type NovelLoreCollection,
  type NovelLoreTypeId,
} from '@/constants/novel-lore';
import type { Novel, NovelLoreEntry, WorldbookEntry } from '@/types/tavern';
import { asString, generateId, normalizeAliases } from '@/utils/helpers';

const createLoreId = () => generateId('lore');

export function createEmptyLoreEntry(
  type: NovelLoreTypeId = 'lore',
  collectionId?: string,
): NovelLoreEntry {
  const timestamp = new Date().toISOString();
  return {
    id: createLoreId(),
    type,
    ...(collectionId ? { collectionId } : {}),
    name: '',
    aliases: [],
    content: '',
    enabled: true,
    updatedAt: timestamp,
  };
}

export function normalizeLoreEntry(
  item: Partial<NovelLoreEntry> | null | undefined,
  index = 0,
): NovelLoreEntry {
  const timestamp = new Date().toISOString();
  const id = asString(item?.id) || `lore-legacy-${index}`;
  const type: NovelLoreTypeId = isNovelLoreTypeId(item?.type) ? item.type : 'custom';
  const content = asString(item?.content).slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH);

  return {
    id,
    type,
    ...(asString(item?.collectionId) ? { collectionId: asString(item?.collectionId) } : {}),
    name: asString(item?.name),
    aliases: normalizeAliases(item?.aliases),
    content,
    enabled: item?.enabled !== false,
    ...(item?.stale === true ? { stale: true } : {}),
    updatedAt: asString(item?.updatedAt) || timestamp,
  };
}

export function normalizeLoreCollection(
  item: Partial<NovelLoreCollection> | null | undefined,
  index = 0,
): NovelLoreCollection | null {
  const name = asString(item?.name).trim().slice(0, 28);
  if (!name) {
    return null;
  }

  const rawId = asString(item?.id).trim();
  const id = rawId || `atlas-custom-${index}`;
  if (SYSTEM_NOVEL_LORE_COLLECTIONS.some((collection) => collection.id === id)) {
    return null;
  }

  return {
    id,
    name,
    description: asString(item?.description).trim().slice(0, 80),
    defaultType: isNovelLoreTypeId(item?.defaultType) ? item.defaultType : 'custom',
  };
}

export function ensureNovelLoreCollections(
  collections: NovelLoreCollection[] | null | undefined,
): NovelLoreCollection[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  return (Array.isArray(collections) ? collections : [])
    .map((item, index) => normalizeLoreCollection(item, index))
    .filter((item): item is NovelLoreCollection => Boolean(item))
    .filter((item) => {
      const nameKey = item.name.toLocaleLowerCase();
      if (seenIds.has(item.id) || seenNames.has(nameKey)) {
        return false;
      }
      seenIds.add(item.id);
      seenNames.add(nameKey);
      return true;
    });
}

export function getNovelLoreCollections(
  collections: NovelLoreCollection[] | null | undefined,
): NovelLoreCollection[] {
  return [...SYSTEM_NOVEL_LORE_COLLECTIONS, ...ensureNovelLoreCollections(collections)];
}

export function resolveLoreCollectionId(
  entry: Pick<NovelLoreEntry, 'type' | 'collectionId'>,
  collections: readonly NovelLoreCollection[],
): string {
  if (entry.collectionId && collections.some((collection) => collection.id === entry.collectionId)) {
    return entry.collectionId;
  }
  return getSystemLoreCollectionId(entry.type);
}

export function ensureNovelLoreEntries(
  novel: Pick<Novel, 'loreEntries'> | { loreEntries?: NovelLoreEntry[] | null },
): NovelLoreEntry[] {
  const raw = Array.isArray(novel.loreEntries) ? novel.loreEntries : [];
  return raw.map((item, index) => normalizeLoreEntry(item, index));
}

export function getLoreTriggerKeys(entry: NovelLoreEntry): string[] {
  const keys = [entry.name, ...entry.aliases]
    .map((item) => item.trim())
    .filter(Boolean);
  return keys.filter((item, index, list) =>
    list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index,
  );
}

export function formatLoreInjectContent(entry: NovelLoreEntry): string {
  const name = entry.name.trim() || '未命名';
  const typeLabel = NOVEL_LORE_TYPE_LABELS[entry.type] ?? '设定';
  const content = entry.content.trim();
  return [`【设定·${typeLabel}·${name}】`, content].filter(Boolean).join('\n');
}

/**
 * Convert novel lore entries into worldbook entries
 * so they only inject when mentioned.
 */
export function loreEntriesToWorldbookEntries(
  entries: NovelLoreEntry[],
): WorldbookEntry[] {
  const timestamp = new Date().toISOString();

  return entries
    .filter(
      (item) =>
        item.enabled !== false && item.stale !== true && item.name.trim() && item.content.trim(),
    )
    .map((item) => {
      const keys = getLoreTriggerKeys(item);
      return {
        id: `novel-lore-${item.id}`,
        keys,
        content: formatLoreInjectContent(item),
        enabled: true,
        createdAt: item.updatedAt || timestamp,
        updatedAt: item.updatedAt || timestamp,
      } satisfies WorldbookEntry;
    })
    .filter((item) => item.keys.length > 0);
}

/** Short roster for optional core hint (names only). */
export function formatLoreRosterForCore(novel: Pick<Novel, 'loreEntries'>): string {
  const names = ensureNovelLoreEntries(novel)
    .filter((item) => item.enabled !== false && item.name.trim())
    .map((item) => item.name.trim());

  if (names.length === 0) {
    return '';
  }

  return `【设定名录】${names.join('、')}\n（详细设定在设定库中；对话提到该名称时才会带上。）`;
}
