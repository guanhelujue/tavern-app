import type { WorldbookEntry } from '@/types/tavern';

const DEFAULT_SCAN_MESSAGE_COUNT = 3;

export type LoreLikeEntry = {
  keys: string[] | string;
  content: string;
  enabled: boolean;
  insertion_order?: number;
  constant?: boolean;
  position?: 'before_char' | 'after_char';
  case_sensitive?: boolean;
  selective?: boolean;
  secondary_keys?: string[];
  aliases?: string[];
  priority?: number;
  combinationKey?: string;
  maxInjectionTokens?: number;
};

export function normalizeWorldbookKeys(keys: string[] | string) {
  const rawKeys = Array.isArray(keys) ? keys : keys.split(/[,，]/);
  return rawKeys.map((key) => key.trim()).filter(Boolean);
}

function buildScanText(recentTexts: string[], scanMessageCount: number) {
  return recentTexts.slice(-Math.max(1, scanMessageCount)).join('\n');
}

function keysMatchScan(
  keys: string[],
  scanText: string,
  scanTextLower: string,
  caseSensitive: boolean,
): boolean {
  if (keys.length === 0) {
    return false;
  }
  return keys.some((key) =>
    caseSensitive ? scanText.includes(key) : scanTextLower.includes(key.toLowerCase()),
  );
}

function entryMatchesScan(
  entry: LoreLikeEntry,
  scanText: string,
  scanTextLower: string,
): boolean {
  const keys = [
    ...normalizeWorldbookKeys(entry.keys),
    ...normalizeWorldbookKeys(entry.aliases ?? []),
    ...normalizeWorldbookKeys(entry.combinationKey ?? ''),
  ];
  const caseSensitive = entry.case_sensitive === true;
  if (!keysMatchScan(keys, scanText, scanTextLower, caseSensitive)) {
    return false;
  }

  // selective: primary keys match AND at least one secondary key matches (when present).
  if (entry.selective === true) {
    const secondary = normalizeWorldbookKeys(entry.secondary_keys ?? []);
    if (secondary.length > 0) {
      return keysMatchScan(secondary, scanText, scanTextLower, caseSensitive);
    }
  }

  return true;
}


export type WorldbookMatch = {
  id: string;
  content: string;
  priority: number;
  estimatedTokens: number;
  reason: string;
};

/** Follow references in selected entries until no new entry fits the injection budget. */
export function scanWorldbookEntriesRecursively(
  entries: WorldbookEntry[],
  seed: string,
  maxTokens: number,
): WorldbookMatch[] {
  const selected: WorldbookMatch[] = [];
  const visited = new Set<string>();
  let remaining = maxTokens;
  let query = seed;
  while (query && remaining > 0) {
    const matches = scanWorldbookEntriesDetailed({
      entries: entries.filter((entry) => !visited.has(entry.id) && !entry.stale),
      recentTexts: [query],
      scanMessageCount: 1,
    });
    const next: string[] = [];
    for (const match of matches) {
      visited.add(match.id);
      const tokens = Math.ceil(match.content.length / 2);
      if (tokens > remaining) continue;
      selected.push(match);
      remaining -= tokens;
      next.push(match.content);
    }
    query = next.join('\n');
  }
  return selected;
}

export function scanWorldbookEntriesDetailed({
  entries,
  recentTexts,
  scanMessageCount = DEFAULT_SCAN_MESSAGE_COUNT,
}: {
  entries: WorldbookEntry[];
  recentTexts: string[];
  scanMessageCount?: number;
}): WorldbookMatch[] {
  const scanText = buildScanText(recentTexts, scanMessageCount);
  const scanTextLower = scanText.toLowerCase();

  if (!scanText) {
    return [];
  }

  return entries
    .filter((entry) => entry.enabled)
    .filter((entry) =>
      entryMatchesScan(
        {
          keys: entry.keys,
          content: entry.content,
          enabled: entry.enabled,
          aliases: entry.aliases,
          priority: entry.priority,
          combinationKey: entry.combinationKey,
          maxInjectionTokens: entry.maxInjectionTokens,
        },
        scanText,
        scanTextLower,
      ),
    )
    .map((entry) => {
      const rawContent = entry.content.trim();
      const maxTokens =
        typeof entry.maxInjectionTokens === 'number' && entry.maxInjectionTokens > 0
          ? Math.round(entry.maxInjectionTokens)
          : undefined;
      const content =
        maxTokens && rawContent.length > maxTokens * 4
          ? rawContent.slice(0, maxTokens * 4).trimEnd() + '…'
          : rawContent;
      return {
        id: entry.id,
        content,
        priority:
          typeof entry.priority === 'number' && Number.isFinite(entry.priority)
            ? entry.priority
            : 0,
        estimatedTokens: Math.ceil(content.length / 4),
        reason: '关键词或别名命中：' + normalizeWorldbookKeys(entry.keys).join('、'),
      };
    })
    .filter((entry) => entry.content)
    .sort((left, right) => right.priority - left.priority);
}

/** Apply session binding filter to global worldbook entries. */
export function filterBoundGlobalWorldbook(
  entries: WorldbookEntry[],
  boundIds: string[] | undefined,
): WorldbookEntry[] {
  if (boundIds === undefined) {
    return entries;
  }
  if (boundIds.length === 0) {
    return [];
  }
  const allowed = new Set(boundIds);
  return entries.filter((entry) => allowed.has(entry.id));
}
