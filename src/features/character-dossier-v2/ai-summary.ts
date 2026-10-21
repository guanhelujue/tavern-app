import type {
  CharacterAiSummary,
  CharacterAiSummaryFixedFacts,
  CharacterDossierV2,
} from '@/types/character-dossier-v2';
import type { NovelCastCharacter } from '@/types/tavern';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(text)
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, limit);
}

function fixedFacts(
  character: Partial<Pick<
    NovelCastCharacter,
    'name' | 'gender' | 'age' | 'profession' | 'affiliation' | 'height' | 'weight'
  >>,
  dossier: CharacterDossierV2,
): CharacterAiSummaryFixedFacts {
  return {
    name: text(character.name),
    gender: text(character.gender),
    age: text(character.age),
    profession: text(character.profession),
    affiliation: text(character.affiliation),
    height: text(character.height),
    weight: text(character.weight),
    bodyFat: text(dossier.public.bodyFat),
    measurements: text(dossier.public.measurements),
    shoeSize: text(dossier.public.shoeSize),
  };
}

function deterministicPrivateFacts(dossier: CharacterDossierV2): string[] {
  const privateDossier = dossier.private;
  const common = [
    text(privateDossier.sexualResponse) ? `身体反应：${text(privateDossier.sexualResponse)}` : '',
    text(privateDossier.intimacyProfile) ? `亲密倾向：${text(privateDossier.intimacyProfile)}` : '',
  ];
  const variant = privateDossier.variant === 'female'
    ? [
        text(privateDossier.breastsAndBody) ? `胸部与身体：${text(privateDossier.breastsAndBody)}` : '',
        text(privateDossier.vulva) ? `外阴：${text(privateDossier.vulva)}` : '',
        text(privateDossier.vagina) ? `阴道：${text(privateDossier.vagina)}` : '',
        text(privateDossier.anus) ? `后庭：${text(privateDossier.anus)}` : '',
      ]
    : [
        text(privateDossier.penis) ? `阴茎：${text(privateDossier.penis)}` : '',
        text(privateDossier.testiclesAndPubicHair)
          ? `睾丸与体毛：${text(privateDossier.testiclesAndPubicHair)}`
          : '',
        text(privateDossier.anus) ? `后庭：${text(privateDossier.anus)}` : '',
        text(privateDossier.intimateBody) ? `私密身体：${text(privateDossier.intimateBody)}` : '',
      ];
  return [...variant, ...common].filter(Boolean).slice(0, 7);
}

function hashText(value: string): string {
  // FNV-1a is deliberately small and synchronous: this fingerprint is only for
  // staleness detection, not security or persisted identity.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fingerprint only the canonical fields that semantic AI anchors are derived
 * from. Exact measurements and private facts are rebuilt independently, so a
 * shoe-size edit does not throw away still-valid behavior rules.
 */
export function buildCharacterAiSummarySourceHash(
  character: Partial<NovelCastCharacter>,
  dossier: CharacterDossierV2,
): string {
  const relations = (character.relations ?? [])
    .map((relation) => [
      text(relation.targetName),
      text(relation.label),
      text(relation.note),
    ].join('\u001f'))
    .filter(Boolean)
    .sort();
  const source = [
    text(character.name),
    text(character.appearance),
    text(character.personality),
    text(character.speechStyle),
    text(character.background),
    text(character.motive),
    text(character.strengths),
    text(character.weaknesses),
    text(dossier.public.clothingStyle),
    text(dossier.public.personalityAndLife),
    relations.join('\u001e'),
  ].join('\u001d');
  return `v1-${hashText(source)}`;
}

export function normalizeCharacterAiSummary(
  value: unknown,
  character: Partial<NovelCastCharacter>,
  dossier: CharacterDossierV2,
): CharacterAiSummary {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sourceHash = buildCharacterAiSummarySourceHash(character, dossier);
  // Old summaries have no fingerprint and may be fresh AI output, so accept
  // them once and stamp them. A known mismatched fingerprint is definitely
  // stale and must not override the current card.
  const semanticSource = text(source.sourceHash) && text(source.sourceHash) !== sourceHash
    ? {}
    : source;
  const relationships = (character.relations ?? [])
    .map((relation) =>
      [text(relation.targetName), text(relation.label), text(relation.note)]
        .filter(Boolean)
        .join('｜'),
    )
    .filter(Boolean)
    .slice(0, 4);

  return {
    version: 1,
    sourceHash,
    // Never trust duplicated model output for canonical measurements.
    fixedFacts: fixedFacts(character, dossier),
    appearanceAnchors: list(semanticSource.appearanceAnchors, 4).length
      ? list(semanticSource.appearanceAnchors, 4)
      : [text(character.appearance)].filter(Boolean),
    clothingAnchors: list(semanticSource.clothingAnchors, 3).length
      ? list(semanticSource.clothingAnchors, 3)
      : [text(dossier.public.clothingStyle)].filter(Boolean),
    personalityCore: list(semanticSource.personalityCore, 4).length
      ? list(semanticSource.personalityCore, 4)
      : [text(character.personality)].filter(Boolean),
    behaviorRules: list(semanticSource.behaviorRules, 4),
    speechRules: list(semanticSource.speechRules, 3).length
      ? list(semanticSource.speechRules, 3)
      : [text(character.speechStyle)].filter(Boolean),
    motivation: text(semanticSource.motivation) || text(character.motive),
    relationshipStances: list(semanticSource.relationshipStances, 4).length
      ? list(semanticSource.relationshipStances, 4)
      : relationships,
    hardLimits: list(semanticSource.hardLimits, 3),
    // Private exact facts also come from the canonical dossier, never a duplicated summary.
    privateFacts: deterministicPrivateFacts(dossier),
  };
}

export function formatCharacterAiSummaryForPrompt(
  summary: CharacterAiSummary,
  options?: { includePrivate?: boolean },
): string {
  const facts = summary.fixedFacts;
  const lines = [
    `【AI角色锚点·${facts.name || '未命名'}】`,
    `身份：${[facts.gender, facts.age, facts.profession, facts.affiliation].filter(Boolean).join('｜')}`,
    `身体常量：${[
      facts.height && `身高${facts.height}`,
      facts.weight && `体重${facts.weight}`,
      facts.bodyFat && `体脂${facts.bodyFat}`,
      facts.measurements && `三围${facts.measurements}`,
      facts.shoeSize && `鞋码${facts.shoeSize}`,
    ].filter(Boolean).join('｜')}`,
    summary.appearanceAnchors.length ? `外观锚点：${summary.appearanceAnchors.join('；')}` : '',
    summary.clothingAnchors.length ? `衣着锚点：${summary.clothingAnchors.join('；')}` : '',
    summary.personalityCore.length ? `性格核心：${summary.personalityCore.join('；')}` : '',
    summary.behaviorRules.length ? `行为规则：${summary.behaviorRules.join('；')}` : '',
    summary.speechRules.length ? `语言规则：${summary.speechRules.join('；')}` : '',
    summary.motivation ? `动机与底线：${summary.motivation}` : '',
    summary.relationshipStances.length
      ? `关系立场：${summary.relationshipStances.join('；')}`
      : '',
    summary.hardLimits.length ? `禁止漂移：${summary.hardLimits.join('；')}` : '',
    options?.includePrivate && summary.privateFacts.length
      ? `私密常量：${summary.privateFacts.join('；')}`
      : '',
  ];
  return lines.filter((line) => line && !line.endsWith('：')).join('\n');
}
