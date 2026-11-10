const NOVEL_METADATA_KEYS = [
  'id',
  'name',
  'shortIntro',
  'detailedIntro',
  'systemPrompt',
  'writingStyle',
  'shortTermMemoryPrompt',
  'midTermMemoryPrompt',
  'longTermMemoryPrompt',
  'playerName',
  'worldName',
  'worldEra',
  'worldConflict',
  'worldTone',
  'gameRules',
  'autoSuggestRoutes',
  'relationGraphEnabled',
  'characterCardAppearanceId',
  'defaultModelId',
  'defaultProviderId',
  'coverImageUri',
  'chatBackgroundUri',
  'chatBackgroundOpacity',
  'isDraft',
  'createStep',
  'isContinuationProject',
  'foundationPrompt',
  'creationBlueprint',
  // Outline state is canonical novel metadata. Keep it in the native
  // database as well as the Zustand backup so outline edits survive reloads
  // and are available to exports/imports on another device.
  'outline',
  'outlineVersions',
  'outlineProposals',
  'quickTravel',
  'createdAt',
  'updatedAt',
] as const;

/** Stores only bounded novel metadata; chapters and message bodies live in tables. */
export function serializeNovelMetadata(value: Record<string, unknown>) {
  const metadata: Record<string, unknown> = { schema: 'novel-metadata-v2' };
  for (const key of NOVEL_METADATA_KEYS) {
    if (key in value) {
      metadata[key] = value[key];
    }
  }
  return JSON.stringify(metadata);
}

export function serializeChapterMetadata(value: Record<string, unknown>) {
  const keys = ['id', 'index', 'chapterIndex', 'title', 'summary', 'goal', 'planning', 'targetWords', 'status', 'createdAt', 'updatedAt'];
  const metadata: Record<string, unknown> = { schema: 'chapter-metadata-v2' };
  for (const key of keys) {
    if (key in value) {
      metadata[key] = value[key];
    }
  }
  return JSON.stringify(metadata);
}
