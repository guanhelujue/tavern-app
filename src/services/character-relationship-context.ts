import type {
  NovelCastCharacter,
  NovelCharacterRelationship,
} from '@/types/tavern';

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

/**
 * Resolve one effective relationship stream for prompt assembly.
 * Story-state relations win over the card's initial relation for the same direction.
 */
export function resolveEffectiveCharacterRelationships(
  cast: NovelCastCharacter[],
  dynamicRelations: NovelCharacterRelationship[] = [],
  options: { includeStaticFallback?: boolean } = {},
): NovelCharacterRelationship[] {
  const identity = new Map<string, string>();
  for (const character of cast) {
    const name = character.name.trim() || character.id;
    identity.set(normalized(character.id), name);
    identity.set(normalized(name), name);
    for (const alias of character.aliases ?? []) identity.set(normalized(alias), name);
  }
  const canonical = (value: string) => identity.get(normalized(value)) ?? value.trim();
  const pairKey = (from: string, to: string) => `${normalized(canonical(from))}->${normalized(canonical(to))}`;

  const liveDynamic = dynamicRelations.filter((relation) => !relation.stale);
  const dynamicPairs = new Set(liveDynamic.map((relation) => pairKey(
    relation.fromCharacter,
    relation.toCharacter,
  )));
  const staticRelations = options.includeStaticFallback === false
    ? []
    : cast.flatMap((character) => (character.relations ?? []).flatMap((relation) => {
    const target = relation.targetCastId
      ? cast.find((candidate) => candidate.id === relation.targetCastId)?.name ?? relation.targetName
      : relation.targetName;
    if (!character.name.trim() || !target.trim() || !relation.label.trim()) return [];
    if (dynamicPairs.has(pairKey(character.name, target))) return [];
    return [{
      id: `card:${character.id}:${relation.id}`,
      fromCharacter: character.name,
      toCharacter: target,
      relation: relation.label,
      description: ['初始关系', relation.note?.trim()].filter(Boolean).join('；'),
      atChapter: 0,
    } satisfies NovelCharacterRelationship];
      }));

  return [...liveDynamic, ...staticRelations];
}
