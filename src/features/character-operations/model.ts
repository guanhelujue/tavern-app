import type {
  NovelCastCharacter,
  NovelCharacterArcPlan,
  NovelCharacterDossier,
  NovelCharacterRelationship,
  NovelCharacterWorkspace,
} from '@/types/tavern';

export type CharacterLibraryFilter = 'all' | 'protagonist' | 'supporting' | 'enabled' | 'disabled';

export type CharacterRelationIssue = {
  id: string;
  kind: 'identity' | 'dangling' | 'duplicate-relation' | 'dynamic-missing';
  severity: 'warning' | 'notice';
  message: string;
  characterIds: string[];
};

export function normalizeCharacterWorkspace(value: NovelCharacterWorkspace | undefined): NovelCharacterWorkspace {
  const tagsByCharacterId = value?.tagsByCharacterId && typeof value.tagsByCharacterId === 'object'
    ? Object.fromEntries(Object.entries(value.tagsByCharacterId).map(([id, tags]) => [
        id,
        [...new Set((Array.isArray(tags) ? tags : []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
      ]))
    : {};
  return {
    version: 1,
    tagsByCharacterId,
    arcs: Array.isArray(value?.arcs) ? value.arcs.filter((arc) => arc?.characterId) : [],
  };
}

function identityKeys(character: NovelCastCharacter) {
  return [character.name, ...(character.aliases ?? [])]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function filterCharacterLibrary(
  dossiers: NovelCharacterDossier[],
  cast: NovelCastCharacter[],
  workspace: NovelCharacterWorkspace,
  query: string,
  filter: CharacterLibraryFilter,
  tag?: string,
) {
  const byId = new Map(cast.map((character) => [character.id, character]));
  const needle = query.trim().toLocaleLowerCase();
  return dossiers.filter((dossier) => {
    const character = dossier.castId ? byId.get(dossier.castId) : cast.find((item) => item.name === dossier.name);
    const tags = character ? workspace.tagsByCharacterId[character.id] ?? [] : [];
    if (tag && !tags.includes(tag)) return false;
    if (filter === 'protagonist' && !character?.isProtagonist) return false;
    if (filter === 'supporting' && character?.isProtagonist) return false;
    if (filter === 'enabled' && dossier.enabled === false) return false;
    if (filter === 'disabled' && dossier.enabled !== false) return false;
    if (!needle) return true;
    return [
      dossier.name,
      dossier.content,
      character?.profession,
      character?.affiliation,
      ...(character?.aliases ?? []),
      ...tags,
    ].some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function setCharacterTags(
  workspace: NovelCharacterWorkspace,
  characterIds: string[],
  tags: string[],
): NovelCharacterWorkspace {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
  return {
    ...workspace,
    tagsByCharacterId: {
      ...workspace.tagsByCharacterId,
      ...Object.fromEntries(characterIds.map((id) => [id, normalized])),
    },
  };
}

export function upsertCharacterArc(
  workspace: NovelCharacterWorkspace,
  arc: NovelCharacterArcPlan,
): NovelCharacterWorkspace {
  const existing = workspace.arcs.findIndex((item) => item.characterId === arc.characterId);
  const arcs = [...workspace.arcs];
  if (existing >= 0) arcs[existing] = arc;
  else arcs.push(arc);
  return { ...workspace, arcs };
}

export function diagnoseCharacterRelations(
  cast: NovelCastCharacter[],
  dynamicRelations: NovelCharacterRelationship[],
): CharacterRelationIssue[] {
  const issues: CharacterRelationIssue[] = [];
  const names = new Map<string, NovelCastCharacter>();
  for (const character of cast) {
    for (const key of identityKeys(character)) {
      const existing = names.get(key);
      if (existing && existing.id !== character.id) {
        issues.push({
          id: `identity:${key}`,
          kind: 'identity',
          severity: 'warning',
          message: `“${key}”同时指向「${existing.name}」与「${character.name}」，会造成触发混淆。`,
          characterIds: [existing.id, character.id],
        });
      } else names.set(key, character);
    }
  }
  const ids = new Set(cast.map((character) => character.id));
  for (const character of cast) {
    const seen = new Set<string>();
    for (const relation of character.relations ?? []) {
      const key = (relation.targetCastId || relation.targetName).trim().toLocaleLowerCase();
      if (relation.targetCastId && !ids.has(relation.targetCastId)) {
        issues.push({
          id: `dangling:${character.id}:${relation.id}`,
          kind: 'dangling',
          severity: 'warning',
          message: `「${character.name}」的关系“${relation.label}”在当前角色库中找不到对应卡片。`,
          characterIds: [character.id],
        });
      }
      if (seen.has(key)) {
        issues.push({
          id: `duplicate:${character.id}:${key}`,
          kind: 'duplicate-relation',
          severity: 'notice',
          message: `「${character.name}」对「${relation.targetName}」保存了多条初始关系。`,
          characterIds: [character.id, relation.targetCastId ?? ''].filter(Boolean),
        });
      }
      seen.add(key);
    }
  }
  for (const relation of dynamicRelations.filter((item) => !item.stale)) {
    const from = names.get(relation.fromCharacter.trim().toLocaleLowerCase());
    const to = names.get(relation.toCharacter.trim().toLocaleLowerCase());
    if (!from || !to) {
      issues.push({
        id: `dynamic-missing:${relation.id}`,
        kind: 'dynamic-missing',
        severity: 'notice',
        message: `剧情关系「${relation.fromCharacter} → ${relation.toCharacter}」有一端尚未建档。`,
        characterIds: [from?.id ?? '', to?.id ?? ''].filter(Boolean),
      });
    }
  }
  return [...new Map(issues.map((issue) => [issue.id, issue])).values()];
}

export function mergeCastCharacters(
  cast: NovelCastCharacter[],
  primaryId: string,
  secondaryId: string,
): NovelCastCharacter[] {
  const primary = cast.find((item) => item.id === primaryId);
  const secondary = cast.find((item) => item.id === secondaryId);
  if (!primary || !secondary || primary.id === secondary.id) return cast;
  const fill = (left: string | undefined, right: string | undefined) => left?.trim() ? left : right ?? '';
  const merged: NovelCastCharacter = {
    ...secondary,
    ...primary,
    profession: fill(primary.profession, secondary.profession),
    age: fill(primary.age, secondary.age),
    gender: fill(primary.gender, secondary.gender),
    height: fill(primary.height, secondary.height),
    weight: fill(primary.weight, secondary.weight),
    birthplace: fill(primary.birthplace, secondary.birthplace),
    affiliation: fill(primary.affiliation, secondary.affiliation),
    appearance: fill(primary.appearance, secondary.appearance),
    personality: fill(primary.personality, secondary.personality),
    speechStyle: fill(primary.speechStyle, secondary.speechStyle),
    background: fill(primary.background, secondary.background),
    motive: fill(primary.motive, secondary.motive),
    strengths: fill(primary.strengths, secondary.strengths),
    weaknesses: fill(primary.weaknesses, secondary.weaknesses),
    aliases: [...new Set([
      ...(primary.aliases ?? []),
      secondary.name,
      ...(secondary.aliases ?? []),
    ].map((item) => item.trim()).filter((item) => item && item.toLocaleLowerCase() !== primary.name.trim().toLocaleLowerCase()))],
    relations: [...(primary.relations ?? []), ...(secondary.relations ?? [])],
    isProtagonist: primary.isProtagonist === true || secondary.isProtagonist === true,
  };
  return cast
    .filter((item) => item.id !== secondaryId)
    .map((item) => {
      const character = item.id === primaryId ? merged : item;
      return {
        ...character,
        relations: character.relations?.map((relation) => relation.targetCastId === secondaryId
          ? { ...relation, targetCastId: primaryId, targetName: primary.name }
          : relation),
      };
    });
}

export function syncDynamicRelationToCard(
  cast: NovelCastCharacter[],
  dynamic: NovelCharacterRelationship,
): NovelCastCharacter[] {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const from = cast.find((item) => identityKeys(item).includes(normalize(dynamic.fromCharacter)));
  const to = cast.find((item) => identityKeys(item).includes(normalize(dynamic.toCharacter)));
  if (!from || !to) return cast;
  return cast.map((character) => {
    if (character.id !== from.id) return character;
    const relations = [...(character.relations ?? [])];
    const index = relations.findIndex((relation) => relation.targetCastId === to.id || normalize(relation.targetName) === normalize(to.name));
    const next = {
      id: index >= 0 ? relations[index]!.id : `relation-${Date.now()}`,
      targetName: to.name,
      targetCastId: to.id,
      label: dynamic.relation,
      note: dynamic.description,
      source: 'ai' as const,
      updatedAt: Date.now(),
    };
    if (index >= 0) relations[index] = next;
    else relations.push(next);
    return { ...character, relations };
  });
}
