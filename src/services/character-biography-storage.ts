import { Platform } from 'react-native';

import { getAppDatabase } from '@/db/database';
import {
  deleteCharacterBiographies as deleteCharacterBiographiesFromDatabase,
  deleteNovelBiographies as deleteNovelBiographiesFromDatabase,
  listCharacterBiographies,
  replaceCharacterBiographies,
} from '@/db/repositories/character-biographies';
import { ensureNovelExists } from '@/db/repositories/novels';
import { createIndexedDbStateStorage } from '@/services/novel-persistence-gate';
import type { NovelCharacterBiography } from '@/types/tavern';

type BiographyOwner = {
  novelId: string;
  characterId: string;
};

const WEB_KEY_PREFIX = 'character-biographies-v1';
const webStorage = Platform.OS === 'web' ? createIndexedDbStateStorage() : null;
const webNovelWriteQueues = new Map<string, Promise<void>>();

function enqueueWebNovelWrite(novelId: string, task: () => Promise<void>) {
  const previous = webNovelWriteQueues.get(novelId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const settled = next.then(() => undefined, () => undefined);
  webNovelWriteQueues.set(novelId, settled);
  void settled.finally(() => {
    if (webNovelWriteQueues.get(novelId) === settled) {
      webNovelWriteQueues.delete(novelId);
    }
  });
  return next;
}

function ownerKey({ novelId, characterId }: BiographyOwner) {
  return `${WEB_KEY_PREFIX}:${encodeURIComponent(novelId)}:${encodeURIComponent(characterId)}`;
}

function novelIndexKey(novelId: string) {
  return `${WEB_KEY_PREFIX}:index:${encodeURIComponent(novelId)}`;
}

export function normalizeCharacterBiographies(value: unknown): NovelCharacterBiography[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const biographies: NovelCharacterBiography[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) continue;
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const id = rawId || `biography-${Date.now()}-${biographies.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim()
      ? raw.createdAt
      : new Date().toISOString();
    biographies.push({
      id,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '未命名小传',
      request: typeof raw.request === 'string' ? raw.request.trim() : '',
      content,
      createdAt,
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
        ? raw.updatedAt
        : createdAt,
    });
  }
  return biographies;
}

async function readWebIndex(novelId: string): Promise<string[]> {
  const raw = await webStorage?.getItem(novelIndexKey(novelId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
  } catch {
    return [];
  }
}

async function writeWebIndex(novelId: string, characterIds: string[]) {
  const unique = [...new Set(characterIds.map((item) => item.trim()).filter(Boolean))];
  if (unique.length) {
    await webStorage?.setItem(novelIndexKey(novelId), JSON.stringify(unique));
  } else {
    await webStorage?.removeItem(novelIndexKey(novelId));
  }
}

export async function loadCharacterBiographies(
  owner: BiographyOwner,
): Promise<NovelCharacterBiography[]> {
  if (Platform.OS === 'web') {
    const raw = await webStorage?.getItem(ownerKey(owner));
    if (!raw) return [];
    try {
      return normalizeCharacterBiographies(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  const db = await getAppDatabase();
  return normalizeCharacterBiographies(
    await listCharacterBiographies(db, owner.novelId, owner.characterId),
  );
}

export async function saveCharacterBiographies(
  owner: BiographyOwner,
  value: unknown,
): Promise<void> {
  const entries = normalizeCharacterBiographies(value);
  if (Platform.OS === 'web') {
    return enqueueWebNovelWrite(owner.novelId, async () => {
      const index = await readWebIndex(owner.novelId);
      if (entries.length) {
        await webStorage?.setItem(ownerKey(owner), JSON.stringify(entries));
        await writeWebIndex(owner.novelId, [...index, owner.characterId]);
      } else {
        await webStorage?.removeItem(ownerKey(owner));
        await writeWebIndex(owner.novelId, index.filter((id) => id !== owner.characterId));
      }
    });
  }
  const db = await getAppDatabase();
  await ensureNovelExists(db, owner.novelId);
  const write = async () => replaceCharacterBiographies(
    db,
    owner.novelId,
    owner.characterId,
    entries,
  );
  if (typeof db.withTransactionAsync === 'function') {
    await db.withTransactionAsync(write);
  } else {
    await write();
  }
}

export async function deleteCharacterBiographyCollection(owner: BiographyOwner): Promise<void> {
  if (Platform.OS === 'web') {
    return enqueueWebNovelWrite(owner.novelId, async () => {
      const index = await readWebIndex(owner.novelId);
      await webStorage?.removeItem(ownerKey(owner));
      await writeWebIndex(owner.novelId, index.filter((id) => id !== owner.characterId));
    });
  }
  const db = await getAppDatabase();
  await deleteCharacterBiographiesFromDatabase(db, owner.novelId, owner.characterId);
}

export async function deleteNovelBiographyCollections(novelId: string): Promise<void> {
  if (Platform.OS === 'web') {
    return enqueueWebNovelWrite(novelId, async () => {
      const characterIds = await readWebIndex(novelId);
      await Promise.all(characterIds.map((characterId) =>
        webStorage?.removeItem(ownerKey({ novelId, characterId })),
      ));
      await webStorage?.removeItem(novelIndexKey(novelId));
    });
  }
  const db = await getAppDatabase();
  await deleteNovelBiographiesFromDatabase(db, novelId);
}

export async function loadNovelBiographyCollections(
  novelId: string,
  characterIds: string[],
): Promise<Record<string, NovelCharacterBiography[]>> {
  const rows = await Promise.all(characterIds.map(async (characterId) => [
    characterId,
    await loadCharacterBiographies({ novelId, characterId }),
  ] as const));
  return Object.fromEntries(rows.filter(([, entries]) => entries.length));
}

export async function replaceNovelBiographyCollections(
  novelId: string,
  collections: Record<string, NovelCharacterBiography[]> | undefined,
): Promise<void> {
  await deleteNovelBiographyCollections(novelId);
  for (const [characterId, entries] of Object.entries(collections ?? {})) {
    await saveCharacterBiographies({ novelId, characterId }, entries);
  }
}
