import type { Novel, NovelOutline, NovelVolumeChapter, NovelVolumePlan } from '@/types/tavern';
import { cloneNovelOutline } from '@/utils/novel-outline-proposals';

export const emptyOutline = (): NovelOutline => ({ summary: '', volumes: [], updatedAt: new Date(0).toISOString() });

export function scopedOutline(novel: Novel | undefined, worldId?: string): NovelOutline | undefined {
  return worldId ? novel?.quickTravel?.worlds.find((world) => world.id === worldId)?.outline : novel?.outline;
}

export function volumeRanges(outline: NovelOutline) {
  let cursor = outline.baseChapterIndex ?? outline.volumes.flatMap((volume) => volume.chapters).sort((a, b) => a.index - b.index)[0]?.index ?? 1;
  return outline.volumes.map((volume) => {
    const count = Math.max(volume.plannedChapterCount ?? volume.chapters.length, volume.chapters.length, 1);
    const start = volume.chapters.length ? Math.min(...volume.chapters.map((chapter) => chapter.index)) : cursor;
    const end = Math.max(start + count - 1, ...volume.chapters.map((chapter) => chapter.index));
    cursor = Math.max(cursor, end + 1);
    return { id: volume.id, start, end, count };
  });
}

/** Saving metadata never renumbers or edits existing chapter plans. */
export function updateVolumePlan(outline: NovelOutline, volumeId: string, update: Partial<NovelVolumePlan>): NovelOutline {
  if (!outline.volumes.some((volume) => volume.id === volumeId)) throw new Error('当前卷已不存在，请重新选择。');
  const next = cloneNovelOutline(outline);
  next.volumes = next.volumes.map((volume) => volume.id === volumeId ? { ...volume, ...update, id: volume.id, chapters: volume.chapters } : volume);
  return next;
}

export function updateChapterPlan(outline: NovelOutline, volumeId: string, chapter: NovelVolumeChapter): NovelOutline {
  const next = cloneNovelOutline(outline);
  const volume = next.volumes.find((item) => item.id === volumeId);
  if (!volume?.chapters.some((item) => item.index === chapter.index)) throw new Error('当前章纲已不存在，请重新选择。');
  volume.chapters = volume.chapters.map((item) => item.index === chapter.index ? { ...chapter } : item);
  return next;
}

export function addChapterPlan(outline: NovelOutline, volumeId: string) {
  const next = cloneNovelOutline(outline);
  const volume = next.volumes.find((item) => item.id === volumeId);
  const range = volumeRanges(next).find((item) => item.id === volumeId);
  if (!volume || !range) throw new Error('请先创建一卷。');
  const occupied = new Set(next.volumes.flatMap((item) => item.chapters.map((chapter) => chapter.index)));
  // Reserve future volumes too, so an empty volume cannot silently take their chapter numbers.
  const otherRanges = volumeRanges(next).filter((item) => item.id !== volumeId);
  const index = Math.max(range.start, ...volume.chapters.map((chapter) => chapter.index + 1));
  if (occupied.has(index) || otherRanges.some((item) => index >= item.start && index <= item.end)) {
    throw new Error('下一章号已属于其他卷，请先从全书总纲调整分卷安排。');
  }
  const chapter: NovelVolumeChapter = { index, title: `第${index}章`, goal: '' };
  volume.chapters.push(chapter);
  volume.plannedChapterCount = Math.max(volume.plannedChapterCount ?? 0, volume.chapters.length);
  return { outline: next, chapter };
}

/** A chapter's numeric slots stay fixed when its plan is moved within a volume. */
export function reorderChapterPlans(outline: NovelOutline, volumeId: string, position: number, direction: -1 | 1): NovelOutline {
  const next = cloneNovelOutline(outline);
  const volume = next.volumes.find((item) => item.id === volumeId);
  if (!volume || !volume.chapters[position + direction]) return next;
  const slots = volume.chapters.map((chapter) => chapter.index);
  [volume.chapters[position], volume.chapters[position + direction]] = [volume.chapters[position + direction], volume.chapters[position]];
  volume.chapters = volume.chapters.map((chapter, index) => ({ ...chapter, index: slots[index] }));
  return next;
}

export function positiveInteger(value: string, label: string, maximum = 10000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw new Error(`${label}请输入1–${maximum}之间的整数。`);
  return number;
}

export type OutlineDifference = { key: string; label: string; before: string; after: string };

/** Include author constraints as well as chapter text in the review, including deletions. */
export function outlineDifferences(before: NovelOutline, after: NovelOutline): OutlineDifference[] {
  const changes: OutlineDifference[] = [];
  const add = (key: string, label: string, oldValue: unknown, newValue: unknown) => {
    const previous = oldValue == null ? '' : String(oldValue);
    const next = newValue == null ? '' : String(newValue);
    if (previous !== next) changes.push({ key, label, before: previous, after: next });
  };
  add('summary', '全书总纲', before.summary, after.summary);
  const ids = new Set([...before.volumes, ...after.volumes].map((volume) => volume.id));
  for (const id of ids) {
    const previous = before.volumes.find((volume) => volume.id === id);
    const next = after.volumes.find((volume) => volume.id === id);
    const name = next?.title || previous?.title || '未命名卷';
    for (const [key, label] of [['title', '卷名'], ['summary', '本卷梗概'], ['plannedChapterCount', '计划章数'], ['wordsPerChapter', '每章字数'], ['tone', '节奏基调'], ['foreshadowing', '伏笔边界']] as const) {
      add(`${id}-${key}`, `${name} · ${label}`, previous?.[key], next?.[key]);
    }
    add(`${id}-incoming`, `${name} · 前卷衔接`, previous?.handoff?.incoming, next?.handoff?.incoming);
    add(`${id}-outgoing`, `${name} · 卷末状态`, previous?.handoff?.outgoing, next?.handoff?.outgoing);
    const indexes = new Set([...(previous?.chapters ?? []), ...(next?.chapters ?? [])].map((chapter) => chapter.index));
    for (const index of indexes) {
      const oldChapter = previous?.chapters.find((chapter) => chapter.index === index);
      const chapter = next?.chapters.find((item) => item.index === index);
      for (const [key, label] of [['title', '标题'], ['goal', '情节'], ['characterChange', '人物变化'], ['foreshadowing', '伏笔'], ['endingHook', '章末衔接'], ['sceneEnd', '场景收束']] as const) {
        add(`${id}-${index}-${key}`, `${name} · 第${index}章 · ${label}`, oldChapter?.[key], chapter?.[key]);
      }
    }
  }
  return changes;
}
