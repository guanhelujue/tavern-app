export type NovelRow = {
  id: string;
  name: string;
  worldName: string;
  worldEra: string;
  worldConflict: string;
  worldTone: string;
  writingStyle: string;
  createdAt: string;
  updatedAt: string;
  jsonExtra: string;
  storyAnalysisJson?: string;
  canonRevision?: number;
};

export type MessageRow = {
  id: string;
  novelId: string;
  role: string;
  content: string;
  reasoningContent?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  promptTokens: number | null;
  completionTokens: number | null;
  modelId: string | null;
  sequenceNo: number;
  worldId?: string;
};

export type ChapterRow = {
  id: string;
  novelId: string;
  chapterIndex: number;
  title: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  jsonExtra: string;
};

export type MemoryRow = {
  id: string;
  novelId: string;
  memoryType: string;
  content: string;
  sourceMessageId: string | null;
  sourceChapterId: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  stateVersion?: number;
  confidence?: number;
  stale: number;
  createdAt: string;
  updatedAt: string;
  worldId?: string;
};

export type StoryEventRow = {
  id: string;
  novelId: string;
  chapterId: string | null;
  sequence: number;
  eventType: string;
  payloadJson: string;
  sourceMessageId: string | null;
  createdAt: string;
  canonRevision?: number;
  chapterRevisionId?: string | null;
  causationId?: string | null;
  correlationId?: string | null;
  supersedesEventId?: string | null;
};

export type ChapterRevisionRow = {
  id: string;
  novelId: string;
  chapterId: string;
  revisionNo: number;
  title: string;
  content: string;
  contentHash: string;
  status: string;
  supersedesRevisionId: string | null;
  createdAt: string;
};

export type CanonCommitRow = {
  id: string;
  novelId: string;
  canonRevision: number;
  idempotencyKey: string;
  commandType: string;
  chapterRevisionId: string | null;
  createdAt: string;
};

export type StoryFactRow = {
  id: string;
  novelId: string;
  factType: string;
  subjectId: string | null;
  contentJson: string;
  sourceEventId: string;
  stateVersion: number;
  confidence: number;
  locked: number;
  stale: number;
  updatedAt: string;
  projectionGeneration?: number;
  canonRevision?: number;
};

export type DatabaseMigrationReport = {
  fromVersion: number;
  toVersion: number;
  appliedVersions: number[];
};

export type MigrationMarkerStatus = 'pending' | 'running' | 'validated' | 'failed';

export type MigrationMarkerRow = {
  id: string;
  status: MigrationMarkerStatus;
  sourceVersion: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  reportJson: string | null;
};
