import { resolveContextTokenBudget } from '@/services/context-budget';
import type { ApiSettings, Novel, WorldbookEntry } from '@/types/tavern';

export type ContextPackItem = {
  id: string;
  text: string;
  priority: number;
  sourceEventIds?: string[];
  stateVersion?: number;
  stale?: boolean;
};

export type NovelContextPack = {
  currentChapterGoal: ContextPackItem[];
  currentScene: ContextPackItem[];
  recentMessages: ContextPackItem[];
  recentChapterSummaries: ContextPackItem[];
  activeCharacters: ContextPackItem[];
  lockedWorldFacts: ContextPackItem[];
  relevantRelations: ContextPackItem[];
  unresolvedHooks: ContextPackItem[];
  styleConstraints: ContextPackItem[];
  worldbookEntries: ContextPackItem[];
  stateVersion: number;
  contextManifest: {
    budgetTokens: number;
    estimatedTokens: number;
    estimation: 'chars-div-2';
    selected: string[];
    clipped: string[];
    staleExcluded: string[];
    sourceVersions: Record<string, number | undefined>;
    selectionReasons: Record<string, string>;
  };
};

type PackInput = {
  novel?: Novel;
  currentChapterGoal?: string;
  currentScene?: string;
  recentMessages?: { id: string; role: string; content: string }[];
  recentChapterSummaries?: { id?: string; chapter: number; title: string; summary?: string; stateVersion?: number; stale?: boolean }[];
  activeCharacters?: { id: string; name: string; profile?: string; currentState?: string; stateVersion?: number; confidence?: number; locked?: boolean; stale?: boolean; sourceEventIds?: string[] }[];
  lockedWorldFacts?: { id: string; subject: string; content: string; stateVersion?: number; locked?: boolean; stale?: boolean; sourceEventIds?: string[] }[];
  relevantRelations?: { id: string; fromCharacter: string; toCharacter: string; relation: string; description?: string; stateVersion?: number; stale?: boolean; sourceEventIds?: string[] }[];
  unresolvedHooks?: { id: string; keyword: string; description: string; status?: string; stateVersion?: number; stale?: boolean; sourceEventIds?: string[] }[];
  styleConstraints?: string[];
  worldbookEntries?: WorldbookEntry[];
  /** Goal/user/previous-scene/entity terms used for deterministic local relevance ranking. */
  retrievalQuery?: string;
};

const SECTION_WEIGHTS = {
  currentChapterGoal: 0.12,
  currentScene: 0.14,
  recentMessages: 0.28,
  recentChapterSummaries: 0.08,
  activeCharacters: 0.1,
  lockedWorldFacts: 0.12,
  relevantRelations: 0.06,
  unresolvedHooks: 0.06,
  styleConstraints: 0.02,
  worldbookEntries: 0.02,
} as const;

function estimate(text: string) {
  return Math.ceil(text.length / 2);
}

function searchTerms(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ');
  const terms = new Set(normalized.split(/\s+/).filter((item) => item.length >= 2));
  for (const chunk of normalized.split(/\s+/)) {
    if (chunk.length > 2 && /[\u3400-\u9fff]/u.test(chunk)) {
      for (let index = 0; index < chunk.length - 1; index += 1) terms.add(chunk.slice(index, index + 2));
    }
  }
  return terms;
}

function applyRelevance(items: ContextPackItem[], query: string, reasons: Record<string, string>) {
  const terms = searchTerms(query);
  return items.map((item) => {
    const haystack = item.text.toLocaleLowerCase();
    const matches = [...terms].filter((term) => item.id.toLocaleLowerCase().includes(term) || haystack.includes(term));
    const entityMatch = matches.length > 0 ? Math.min(90, 30 + matches.length * 15) : 0;
    const lockedBonus = item.priority >= 100 ? 100 : 0;
    reasons[item.id] = lockedBonus ? '用户锁定/正史优先' : entityMatch ? `命中检索词：${matches.slice(0, 4).join('、')}` : '普通历史信息';
    return { ...item, priority: item.priority + lockedBonus + entityMatch };
  });
}

function makeItem(id: string, text: string, priority: number, metadata?: Partial<ContextPackItem>): ContextPackItem {
  return { id, text: text.trim(), priority, ...metadata };
}

function select(items: ContextPackItem[], budget: number, selected: string[], clipped: string[], staleExcluded: string[]) {
  let consumed = 0;
  const result: ContextPackItem[] = [];
  for (const item of items.sort((a, b) => b.priority - a.priority)) {
    if (item.stale) {
      staleExcluded.push(item.id);
      continue;
    }
    if (!item.text.trim()) continue;
    const remaining = Math.max(0, budget - consumed);
    if (remaining <= 0) {
      clipped.push(item.id);
      continue;
    }
    const maxChars = remaining * 2;
    const text = item.text.length > maxChars ? item.text.slice(0, maxChars) : item.text;
    if (text.length < item.text.length) clipped.push(item.id);
    result.push({ ...item, text });
    selected.push(item.id);
    consumed += estimate(text);
    if (consumed >= budget) break;
  }
  return result;
}

export function buildNovelContextPack(apiSettings: Pick<ApiSettings, 'contextWindowTokens' | 'maxTokens'>, input: PackInput): NovelContextPack {
  const budgetTokens = resolveContextTokenBudget(apiSettings);
  const selected: string[] = [];
  const clipped: string[] = [];
  const staleExcluded: string[] = [];
  const sourceVersions: Record<string, number | undefined> = {};
  const selectionReasons: Record<string, string> = {};
  const raw: Record<keyof typeof SECTION_WEIGHTS, ContextPackItem[]> = {
    currentChapterGoal: input.currentChapterGoal ? [makeItem('chapter-goal', input.currentChapterGoal, 100)] : [],
    currentScene: input.currentScene ? [makeItem('current-scene', input.currentScene, 100)] : [],
    recentMessages: (input.recentMessages ?? []).map((item, index) => makeItem(`message:${item.id}`, `${item.role}: ${item.content}`, 90 - index)),
    recentChapterSummaries: (input.recentChapterSummaries ?? []).map((item) => makeItem(`summary:${item.id ?? item.chapter}`, `${item.title}: ${item.summary ?? ''}`, 70, { stateVersion: item.stateVersion, stale: item.stale })),
    activeCharacters: (input.activeCharacters ?? []).map((item) => makeItem(`character:${item.id}`, `${item.name}: ${item.currentState ?? item.profile ?? ''}`, item.locked ? 100 : 70, { stateVersion: item.stateVersion, stale: item.stale, sourceEventIds: item.sourceEventIds })),
    lockedWorldFacts: (input.lockedWorldFacts ?? []).map((item) => makeItem(`world:${item.id}`, `${item.subject}: ${item.content}`, item.locked ? 110 : 80, { stateVersion: item.stateVersion, stale: item.stale, sourceEventIds: item.sourceEventIds })),
    relevantRelations: (input.relevantRelations ?? []).map((item) => makeItem(`relation:${item.id}`, `${item.fromCharacter} -> ${item.toCharacter}: ${item.relation}. ${item.description ?? ''}`, 65, { stateVersion: item.stateVersion, stale: item.stale, sourceEventIds: item.sourceEventIds })),
    unresolvedHooks: (input.unresolvedHooks ?? []).filter((item) => item.status !== 'resolved').map((item) => makeItem(`hook:${item.id}`, `${item.keyword}: ${item.description}`, 75, { stateVersion: item.stateVersion, stale: item.stale, sourceEventIds: item.sourceEventIds })),
    styleConstraints: (input.styleConstraints ?? []).map((item, index) => makeItem(`style:${index}`, item, 60)),
    worldbookEntries: (input.worldbookEntries ?? []).map((item) => makeItem(`worldbook:${item.id}`, item.content, item.priority ?? 40)),
  };
  const pack = {} as NovelContextPack;
  const sectionKeys = Object.keys(SECTION_WEIGHTS) as (keyof typeof SECTION_WEIGHTS)[];
  for (const section of sectionKeys) {
    const weight = SECTION_WEIGHTS[section];
    const ranked = applyRelevance(raw[section], input.retrievalQuery ?? '', selectionReasons);
    pack[section] = select(ranked, Math.max(64, Math.floor(budgetTokens * weight)), selected, clipped, staleExcluded);
    for (const item of pack[section]) sourceVersions[item.id] = item.stateVersion;
  }
  const estimatedTokens = sectionKeys
    .flatMap((section) => pack[section])
    .reduce((sum, item) => sum + estimate(item.text), 0);
  return {
    ...pack,
    stateVersion: Math.max(0, ...Object.values(sourceVersions).filter((value): value is number => typeof value === 'number')),
    contextManifest: { budgetTokens, estimatedTokens, estimation: 'chars-div-2', selected, clipped, staleExcluded, sourceVersions, selectionReasons },
  };
}

export function buildNovelContextPackFromState(apiSettings: Pick<ApiSettings, 'contextWindowTokens' | 'maxTokens'>, novel: Novel, input: Omit<PackInput, 'novel'> = {}) {
  return buildNovelContextPack(apiSettings, { ...input, novel });
}
