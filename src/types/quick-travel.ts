import type {
  NovelCastCharacter,
  NovelCharacterDossier,
  NovelLoreEntry,
  NovelOutline,
} from './tavern';

export type QuickTravelConfig = {
  enabled: boolean;
  systemName: string;
  systemPersonality: string;
  globalRules: string;
  rewardRules: string;
  itemRules: string;
  memoryRules: string;
  carriedItems: string[];
  carriedFlags: string[];
};

export type OriginalPlotBeat = {
  id: string;
  order: number;
  title: string;
  summary: string;
  involvedCharacters: string[];
  originalResult: string;
  importance: 'minor' | 'major' | 'critical';
  status: 'pending' | 'changed' | 'fulfilled' | 'skipped';
};

export type OriginalPlot = {
  premise: string;
  knownToProtagonist: string;
  beats: OriginalPlotBeat[];
  originalEnding: string;
};

export type WorldDeviation = {
  id: string;
  createdAt: string;
  originalEvent: string;
  actualEvent: string;
  consequence: string;
  affectedBeatIds: string[];
  status: 'open' | 'absorbed' | 'resolved';
};

export type WorldRuntimeState = {
  currentScene: string;
  currentChapter: number;
  mission: string;
  missionStatus: 'not_started' | 'active' | 'success' | 'failed';
  completedObjectives: string[];
  deviations: WorldDeviation[];
  currentEnding: string;
  /** Derived chapter-driven runtime flag; retained for persisted-data compatibility. */
  novelGenerationEnabled?: boolean;
  /** Target Chinese-character count for one generated world-outline chapter. */
  novelGenerationTargetWords?: number;
};

export type WorldSettlement = {
  id: string;
  worldId: string;
  createdAt: string;
  result: 'success' | 'failure' | 'abandoned';
  summary: string;
  rewards: string[];
  penalties: string[];
  carriedForward: string[];
};

export type WorldPack = {
  id: string;
  /** True only for the hierarchy's first, lightweight main world. */
  isMainWorld?: boolean;
  name: string;
  /** User-authored concept used as the primary seed for world completion. */
  generationBrief?: string;
  worldEra: string;
  worldRules: string;
  protagonistIdentity: string;
  entryScene: string;
  mission: string;
  cast: NovelCastCharacter[];
  characterDossiers: NovelCharacterDossier[];
  loreEntries: NovelLoreEntry[];
  originalPlot: OriginalPlot;
  /** Author-owned plan for this world only; does not replace the novel-level outline. */
  outline?: NovelOutline;
  runtime: WorldRuntimeState;
  status: 'draft' | 'active' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
};

export type QuickTravelArchive = {
  config: QuickTravelConfig;
  worlds: WorldPack[];
  activeWorldId?: string;
  settlements: WorldSettlement[];
};
