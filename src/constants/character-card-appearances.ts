/** The only visual systems supported by the V2 character dossier. */
export type CharacterCardAppearance = {
  id: string;
  name: string;
};

export const DEFAULT_CHARACTER_CARD_APPEARANCE_ID = 'character-card-collection';

export const CHARACTER_CARD_APPEARANCES: readonly CharacterCardAppearance[] = [
  { id: 'character-card-collection', name: '馆藏人物志' },
  { id: 'character-card-nocturne', name: '夜幕密档' },
];

export function normalizeCharacterCardAppearanceId(id?: string | null): string {
  const candidate = typeof id === 'string' ? id.trim() : '';
  return CHARACTER_CARD_APPEARANCES.some((item) => item.id === candidate)
    ? candidate
    : DEFAULT_CHARACTER_CARD_APPEARANCE_ID;
}

export function getCharacterCardAppearance(id?: string | null): CharacterCardAppearance {
  const normalized = normalizeCharacterCardAppearanceId(id);
  return (
    CHARACTER_CARD_APPEARANCES.find((item) => item.id === normalized) ??
    CHARACTER_CARD_APPEARANCES[0]
  );
}
