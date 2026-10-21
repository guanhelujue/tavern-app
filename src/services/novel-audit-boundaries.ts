import type { NovelOutline } from '@/types/tavern';

export type NovelAuditBoundaries = {
  scene: boolean;
  volume: boolean;
  reasons: string[];
  source: 'outline' | 'legacy-fallback';
  sceneFromChapter?: number;
  volumeFromChapter?: number;
};

/**
 * Resolves audit boundaries from the durable outline. Legacy outlines did not
 * carry sceneEnd, so they keep the old cadence until they are regenerated.
 */
export function resolveNovelAuditBoundaries(
  chapterIndex: number,
  outline?: NovelOutline | null,
): NovelAuditBoundaries {
  const volumes = outline?.volumes ?? [];
  const plannedChapters = volumes.flatMap((volume) =>
    volume.chapters.map((chapter) => ({ chapter, volume })),
  );
  const match = plannedChapters.find(({ chapter }) => chapter.index === chapterIndex);
  const hasSceneMetadata = plannedChapters.some(
    ({ chapter }) => typeof chapter.sceneEnd === 'boolean',
  );

  if (match) {
    const lastChapterIndex = Math.max(
      ...match.volume.chapters.map((chapter) => chapter.index),
    );
    const volume = chapterIndex === lastChapterIndex;
    const scene = hasSceneMetadata
      ? match.chapter.sceneEnd === true || volume
      : chapterIndex % 5 === 0 || volume;
    const reasons: string[] = [];
    if (match.chapter.sceneEnd === true) reasons.push('outline-scene-end');
    if (volume) reasons.push('outline-volume-end');
    if (!hasSceneMetadata && chapterIndex % 5 === 0) reasons.push('legacy-scene-cadence');
    const sortedVolumeChapters = match.volume.chapters.slice().sort((a, b) => a.index - b.index);
    const previousSceneEnd = sortedVolumeChapters
      .filter((chapter) => chapter.index < chapterIndex && chapter.sceneEnd === true)
      .at(-1);
    return {
      scene,
      volume,
      reasons,
      source: hasSceneMetadata || volume ? 'outline' : 'legacy-fallback',
      sceneFromChapter: scene
        ? (hasSceneMetadata
            ? (previousSceneEnd?.index ?? sortedVolumeChapters[0]?.index ?? chapterIndex) + (previousSceneEnd ? 1 : 0)
            : Math.max(1, chapterIndex - 4))
        : undefined,
      volumeFromChapter: volume ? sortedVolumeChapters[0]?.index ?? chapterIndex : undefined,
    };
  }

  const volume = chapterIndex % 25 === 0;
  const scene = chapterIndex % 5 === 0 || volume;
  return {
    scene,
    volume,
    reasons: [
      ...(scene ? ['legacy-scene-cadence'] : []),
      ...(volume ? ['legacy-volume-cadence'] : []),
    ],
    source: 'legacy-fallback',
    sceneFromChapter: scene ? Math.max(1, chapterIndex - 4) : undefined,
    volumeFromChapter: volume ? Math.max(1, chapterIndex - 24) : undefined,
  };
}
