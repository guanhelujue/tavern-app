import { buildCharacterAiSummarySourceHash } from './ai-summary';
import type { CharacterDossierV2 } from '@/types/character-dossier-v2';
import type { NovelCastCharacter } from '@/types/tavern';
import { normalizeAliases } from '../../utils/helpers';

export type CharacterDossierDiagnostic = {
  code:
    | 'age-birthdate-conflict'
    | 'gender-private-conflict'
    | 'identity-collision'
    | 'body-value-unusual'
    | 'duplicate-relation'
    | 'self-relation'
    | 'private-image-without-profile'
    | 'stale-ai-summary';
  severity: 'warning' | 'notice';
  message: string;
};

type DiagnosticInput = {
  character: NovelCastCharacter;
  dossier: CharacterDossierV2;
  otherCharacters?: NovelCastCharacter[];
  referenceYear?: number;
};

function firstNumber(value: string | undefined): number | null {
  const match = value?.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function privateProfileHasText(dossier: CharacterDossierV2) {
  return Object.entries(dossier.private).some(([key, value]) =>
    !['variant', 'portraitUri', 'portraitFocus'].includes(key) &&
    typeof value === 'string' &&
    Boolean(value.trim()),
  );
}

function normalizedIdentityKeys(character: NovelCastCharacter) {
  return [character.name, ...normalizeAliases(character.aliases)]
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function diagnoseCharacterDossier({
  character,
  dossier,
  otherCharacters = [],
  referenceYear = new Date().getFullYear(),
}: DiagnosticInput): CharacterDossierDiagnostic[] {
  const results: CharacterDossierDiagnostic[] = [];
  const age = firstNumber(character.age);
  const birthYear = firstNumber(dossier.public.birthDate);
  if (age !== null && birthYear !== null && birthYear >= 1000) {
    const possibleAges = new Set([referenceYear - birthYear, referenceYear - birthYear - 1]);
    if (!possibleAges.has(Math.round(age))) {
      results.push({
        code: 'age-birthdate-conflict',
        severity: 'warning',
        message: `年龄“${character.age}”与出生日期“${dossier.public.birthDate}”无法同时成立。`,
      });
    }
  }

  const gender = character.gender.trim();
  const expectedVariant = /女|female|woman|girl/i.test(gender)
    ? 'female'
    : /男|male|man|boy/i.test(gender)
      ? 'male'
      : null;
  if (expectedVariant && dossier.private.variant !== expectedVariant) {
    results.push({
      code: 'gender-private-conflict',
      severity: 'warning',
      message: '性别与当前私密档案结构不一致，请切换性别后重新确认私密字段。',
    });
  }

  const ownKeys = new Set(normalizedIdentityKeys(character));
  for (const other of otherCharacters) {
    if (other.id === character.id) continue;
    const collision = normalizedIdentityKeys(other).find((key) => ownKeys.has(key));
    if (!collision) continue;
    results.push({
      code: 'identity-collision',
      severity: 'warning',
      message: `称呼“${collision}”也属于角色“${other.name || '未命名角色'}”，可能触发错误人物卡。`,
    });
    break;
  }

  const unusualBodyValues = [
    { label: '身高', value: firstNumber(character.height), min: 80, max: 260 },
    { label: '体重', value: firstNumber(character.weight), min: 20, max: 350 },
    { label: '体脂率', value: firstNumber(dossier.public.bodyFat), min: 2, max: 70 },
    { label: '鞋码', value: firstNumber(dossier.public.shoeSize), min: 15, max: 60 },
  ].filter((item) => item.value !== null && (item.value < item.min || item.value > item.max));
  if (unusualBodyValues.length) {
    results.push({
      code: 'body-value-unusual',
      severity: 'notice',
      message: `${unusualBodyValues.map((item) => item.label).join('、')}超出常见人体范围；若属于特殊世界观可保留。`,
    });
  }

  const relationKeys = new Set<string>();
  for (const relation of character.relations ?? []) {
    const targetKey = (relation.targetCastId || relation.targetName).trim().toLocaleLowerCase();
    if (!targetKey) continue;
    if (
      targetKey === character.id.trim().toLocaleLowerCase() ||
      targetKey === character.name.trim().toLocaleLowerCase()
    ) {
      results.push({
        code: 'self-relation',
        severity: 'warning',
        message: '关系表中存在指向角色自己的关系。',
      });
    } else if (relationKeys.has(targetKey)) {
      results.push({
        code: 'duplicate-relation',
        severity: 'notice',
        message: `关系对象“${relation.targetName || targetKey}”出现多次，正文可能收到重复立场。`,
      });
    }
    relationKeys.add(targetKey);
  }

  if (dossier.private.portraitUri?.trim() && !privateProfileHasText(dossier)) {
    results.push({
      code: 'private-image-without-profile',
      severity: 'notice',
      message: '已有私密图片，但私密身体档案仍为空。',
    });
  }

  if (
    character.aiSummary?.sourceHash &&
    character.aiSummary.sourceHash !== buildCharacterAiSummarySourceHash(character, dossier)
  ) {
    results.push({
      code: 'stale-ai-summary',
      severity: 'notice',
      message: '角色卡已变化，旧 AI 摘要将在保存时自动重建。',
    });
  }

  return results;
}
