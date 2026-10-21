import type { ChatSessionExportBundle } from '@/utils/chat-session-io';

/** Restore a portable backup as a new book, never merge two canonical histories. */
export function copyNovelBackup(bundle: ChatSessionExportBundle, suffix = false): ChatSessionExportBundle {
  const prefix = `restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ids = new Map<string, string>([[bundle.sessionId, `${prefix}-novel`]]);
  const add = (id: string) => { if (!ids.has(id)) ids.set(id, `${prefix}-${ids.size}`); };
  const registerCollection = (items: unknown, key: string, primaryKey = 'id') => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>)[primaryKey] === 'string') {
        add((item as Record<string, string>)[primaryKey]);
      }
      if (key === 'chapters' && item && typeof item === 'object') {
        const nested = (item as Record<string, unknown>).chapters;
        registerCollection(nested, key);
      }
    }
  };
  for (const chapter of bundle.novel?.chapters ?? []) add(chapter.id);
  for (const backup of bundle.novel?.chapterBackups ?? []) add(backup.id);
  for (const key of [
    'novelForecasts', 'novelContinuationPlans', 'novelBranches', 'novelStorySnapshots',
    'novelGenerationJobs', 'novelRewriteAudits', 'audits',
  ] as const) {
    const primaryKey = key === 'novelForecasts' ? 'forecastId'
      : key === 'novelContinuationPlans' ? 'planId'
      : key === 'novelBranches' ? 'branchId'
      : key === 'novelStorySnapshots' ? 'snapshotId'
      : key === 'novelGenerationJobs' ? 'jobId'
      : key === 'novelRewriteAudits' ? 'auditId'
      : 'id';
    registerCollection(bundle.novel?.[key], key, primaryKey);
  }
  const registerNestedChapterIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) registerNestedChapterIds(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'chapters') registerCollection(child, key);
      registerNestedChapterIds(child);
    }
  };
  registerNestedChapterIds(bundle.novel);
  for (const message of bundle.messages) add(message.id);
  for (const world of Object.values(bundle.worldSessions ?? {})) {
    for (const message of world.messages) add(message.id);
    for (const slot of [...(world.slotBook?.slots ?? []), ...(world.slotBook?.previousSnapshot ? [world.slotBook.previousSnapshot] : [])]) {
      for (const message of slot.messages) add(message.id);
    }
  }
  for (const entries of Object.values(bundle.characterBiographies ?? {})) for (const entry of entries) add(entry.id);
  const remap = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return /(^id$|Ids?$)/.test(key) ? ids.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map((item) => remap(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, remap(child, childKey)]),
    );
    return value;
  };
  const copy = remap(bundle) as ChatSessionExportBundle;
  for (const job of copy.novel?.novelGenerationJobs ?? []) {
    if (job.status === 'running') job.status = 'paused';
  }
  if (copy.novel && suffix) copy.novel.name = `${copy.novel.name}（导入副本）`;
  return copy;
}
