import type { NovelOutline, NovelOutlinePatch } from '@/types/tavern';

/** Clone the outline before it is placed in a proposal or history snapshot. */
export function cloneNovelOutline(outline: NovelOutline): NovelOutline {
  return {
    ...outline,
    volumes: outline.volumes.map((volume) => ({
      ...volume,
      chapters: volume.chapters.map((chapter) => ({ ...chapter })),
      handoff: volume.handoff
        ? {
            ...volume.handoff,
            unresolvedThreads: volume.handoff.unresolvedThreads?.slice(),
          }
        : undefined,
    })),
  };
}

/**
 * A small deterministic fingerprint for optimistic proposal validation.
 * This is not a security hash; it only detects edits made after generation.
 */
export function hashNovelOutline(outline: NovelOutline): string {
  const serialized = JSON.stringify(cloneNovelOutline(outline));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `outline-fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Apply a validated domain patch without silently replacing unrelated data. */
export function applyNovelOutlinePatch(
  outline: NovelOutline | undefined,
  patch: NovelOutlinePatch,
): NovelOutline | undefined {
  if (patch.op === 'replace_outline') {
    return cloneNovelOutline(patch.outline);
  }

  if (!outline) {
    return undefined;
  }

  if (patch.op === 'update_volume') {
    if (!outline.volumes.some((volume) => volume.id === patch.volumeId)) {
      return undefined;
    }
    return {
      ...cloneNovelOutline(outline),
      volumes: outline.volumes.map((volume) =>
        volume.id === patch.volumeId ? { ...patch.volume, chapters: patch.volume.chapters.map((chapter) => ({ ...chapter })) } : volume,
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  if (patch.op === 'append_chapters') {
    const volume = outline.volumes.find((item) => item.id === patch.volumeId);
    if (!volume) return undefined;
    const existingIndexes = new Set(volume.chapters.map((chapter) => chapter.index));
    const lastExistingIndex = volume.chapters.reduce((max, chapter) => Math.max(max, chapter.index), -Infinity);
    if (patch.chapters.some((chapter, position) => existingIndexes.has(chapter.index)
      || chapter.index <= lastExistingIndex
      || (position > 0 && chapter.index <= patch.chapters[position - 1].index))) return undefined;
    const nextVolume = {
      ...volume,
      chapters: [
        ...volume.chapters.map((chapter) => ({ ...chapter })),
        ...patch.chapters.map((chapter) => ({ ...chapter })),
      ],
      plannedChapterCount: Math.max(volume.plannedChapterCount ?? 0, volume.chapters.length + patch.chapters.length),
    };
    return {
      ...cloneNovelOutline(outline),
      volumes: outline.volumes.map((item) => item.id === patch.volumeId ? nextVolume : item),
      updatedAt: new Date().toISOString(),
    };
  }

  if (patch.op === 'update_selected_chapters') {
    const volume = outline.volumes.find((item) => item.id === patch.volumeId);
    if (!volume) return undefined;
    const selected = new Set(patch.chapterIndexes);
    const replacements = new Map(patch.chapters.map((chapter) => [chapter.index, chapter]));
    if (patch.chapters.some((chapter) => !selected.has(chapter.index))) return undefined;
    if (volume.chapters.some((chapter) => selected.has(chapter.index) && !replacements.has(chapter.index))) return undefined;
    const nextVolume = {
      ...volume,
      chapters: volume.chapters.map((chapter) => selected.has(chapter.index)
        ? { ...(replacements.get(chapter.index) ?? chapter) }
        : { ...chapter }),
    };
    return {
      ...cloneNovelOutline(outline),
      volumes: outline.volumes.map((item) => item.id === patch.volumeId ? nextVolume : item),
      updatedAt: new Date().toISOString(),
    };
  }

  if (patch.op === 'reorder_chapters') {
    const volume = outline.volumes.find((item) => item.id === patch.volumeId);
    if (!volume) return undefined;
    const chapterByIndex = new Map(volume.chapters.map((chapter) => [chapter.index, chapter]));
    if (patch.chapterIndexes.length !== volume.chapters.length || patch.chapterIndexes.some((index) => !chapterByIndex.has(index))) {
      return undefined;
    }
    const reordered = patch.chapterIndexes.map((index) => ({ ...chapterByIndex.get(index)! }));
    return {
      ...cloneNovelOutline(outline),
      volumes: outline.volumes.map((item) => item.id === patch.volumeId ? { ...item, chapters: reordered } : item),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    ...cloneNovelOutline(outline),
    volumes: [
      ...outline.volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.map((chapter) => ({ ...chapter })),
      })),
      ...patch.volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.map((chapter) => ({ ...chapter })),
      })),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function countOutlineChanges(
  before: NovelOutline | undefined,
  after: NovelOutline,
): {
  addedVolumes: number;
  changedVolumes: number;
  deletedVolumes: number;
  addedChapters: number;
  changedChapters: number;
  deletedChapters: number;
  reorderedChapters: number;
} {
  const beforeVolumes = new Map((before?.volumes ?? []).map((volume) => [volume.id, volume]));
  let changedVolumes = 0;
  let addedVolumes = 0;
  let deletedVolumes = 0;
  let addedChapters = 0;
  let changedChapters = 0;
  let deletedChapters = 0;
  let reorderedChapters = 0;

  for (const volume of after.volumes) {
    const previous = beforeVolumes.get(volume.id);
    if (!previous) {
      addedVolumes += 1;
      addedChapters += volume.chapters.length;
      continue;
    }
    const beforeChapters = new Map(previous.chapters.map((chapter) => [chapter.index, chapter]));
    let volumeChanged = previous.title !== volume.title
      || previous.summary !== volume.summary
      || previous.plannedChapterCount !== volume.plannedChapterCount
      || previous.wordsPerChapter !== volume.wordsPerChapter
      || previous.tone !== volume.tone
      || previous.foreshadowing !== volume.foreshadowing
      || previous.handoff?.incoming !== volume.handoff?.incoming
      || previous.handoff?.outgoing !== volume.handoff?.outgoing
      || JSON.stringify(previous.handoff?.unresolvedThreads ?? []) !== JSON.stringify(volume.handoff?.unresolvedThreads ?? []);
    for (const chapter of volume.chapters) {
      const oldChapter = beforeChapters.get(chapter.index);
      if (!oldChapter) {
        addedChapters += 1;
      } else if (oldChapter.title !== chapter.title || oldChapter.goal !== chapter.goal || oldChapter.sceneEnd !== chapter.sceneEnd
        || oldChapter.characterChange !== chapter.characterChange
        || oldChapter.foreshadowing !== chapter.foreshadowing
        || oldChapter.endingHook !== chapter.endingHook) {
        changedChapters += 1;
      }
      if (!oldChapter || oldChapter.title !== chapter.title || oldChapter.goal !== chapter.goal || oldChapter.sceneEnd !== chapter.sceneEnd
        || oldChapter.characterChange !== chapter.characterChange
        || oldChapter.foreshadowing !== chapter.foreshadowing
        || oldChapter.endingHook !== chapter.endingHook) {
        volumeChanged = true;
      }
    }
    for (const chapter of previous.chapters) {
      if (!volume.chapters.some((item) => item.index === chapter.index)) deletedChapters += 1;
    }
    const previousOrder = previous.chapters.map((chapter) => chapter.index);
    const nextOrder = volume.chapters.map((chapter) => chapter.index);
    if (previousOrder.length === nextOrder.length && previousOrder.some((index, position) => nextOrder[position] !== index)) {
      reorderedChapters += nextOrder.filter((index, position) => index !== previousOrder[position]).length;
    }
    if (volumeChanged) changedVolumes += 1;
  }

  for (const volume of before?.volumes ?? []) {
    if (!after.volumes.some((item) => item.id === volume.id)) {
      deletedVolumes += 1;
      deletedChapters += volume.chapters.length;
    }
  }

  return { addedVolumes, changedVolumes, deletedVolumes, addedChapters, changedChapters, deletedChapters, reorderedChapters };
}
