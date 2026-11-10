import type { NovelOutline, NovelVolumePlan } from '@/types/tavern';
import type { StoryBlueprint } from '@/features/novel-creation/domain';

const clean = (value: string) => value.trim();
const key = (value: string) => clean(value).toLocaleLowerCase().replace(/\s+/g, ' ');

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function mergeLegacyStoryIntoSummary(summary: string, blueprint: StoryBlueprint): string {
  const sections = [
    ['故事前提', blueprint.premise],
    ['长期方向', blueprint.direction],
    ['开篇状态', blueprint.opening],
    ['长篇故事引擎', blueprint.longForm.engine],
    ['核心阻力', blueprint.protagonist.obstacle],
    ['失败代价', blueprint.stakes],
  ].filter(([, value]) => clean(value));
  const existing = clean(summary);
  const additions = sections
    .filter(([, value]) => !existing.includes(clean(value)))
    .map(([label, value]) => `【${label}】\n${clean(value)}`);
  return [existing, ...additions].filter(Boolean).join('\n\n');
}

export function buildLegacyVolumeSeeds(
  outline: NovelOutline | undefined,
  blueprint: StoryBlueprint,
  scopeId: string,
): NovelVolumePlan[] {
  const existing = outline?.volumes ?? [];
  const existingKeys = new Set(existing.flatMap((volume) => [key(volume.title), key(volume.summary)]).filter(Boolean));
  const seenKeys = new Set<string>();
  return blueprint.longForm.arcs
    .map(clean)
    .filter(Boolean)
    .filter((arc) => {
      const arcKey = key(arc);
      const stableId = `${scopeId}-legacy-seed-${stableHash(arc)}`;
      if (existingKeys.has(arcKey) || seenKeys.has(arcKey) || existing.some((volume) => volume.id === stableId)) return false;
      seenKeys.add(arcKey);
      return true;
    })
    .map((arc, index) => ({
      id: `${scopeId}-legacy-seed-${stableHash(arc)}`,
      title: `阶段 ${existing.length + index + 1}`,
      summary: arc,
      chapters: [],
      plannedChapterCount: 20,
      status: 'draft' as const,
    }));
}
