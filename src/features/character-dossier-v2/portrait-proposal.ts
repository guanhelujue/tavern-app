import { normalizeCharacterAiSummary } from './ai-summary';
import { normalizeCharacterDossierV2 } from './model';

import type { NovelCastCharacter } from '@/types/tavern';

export type PortraitProposalSource = 'observed' | 'inferred';
export type PortraitProposalScope = 'public' | 'private';

export type PortraitFieldProposal = {
  path: string;
  label: string;
  before: string;
  after: string;
  source: PortraitProposalSource;
};

const FIELDS: { path: string; label: string; defaultSource: PortraitProposalSource }[] = [
  { path: 'name', label: '姓名', defaultSource: 'inferred' },
  { path: 'profession', label: '身份 / 职业', defaultSource: 'inferred' },
  { path: 'age', label: '年龄', defaultSource: 'observed' },
  { path: 'gender', label: '性别', defaultSource: 'observed' },
  { path: 'height', label: '身高', defaultSource: 'inferred' },
  { path: 'weight', label: '体重', defaultSource: 'inferred' },
  { path: 'birthplace', label: '籍贯 / 出生地', defaultSource: 'inferred' },
  { path: 'affiliation', label: '所属', defaultSource: 'inferred' },
  { path: 'appearance', label: '外貌', defaultSource: 'observed' },
  { path: 'personality', label: '性格', defaultSource: 'inferred' },
  { path: 'speechStyle', label: '说话方式', defaultSource: 'inferred' },
  { path: 'background', label: '背景', defaultSource: 'inferred' },
  { path: 'motive', label: '动机', defaultSource: 'inferred' },
  { path: 'strengths', label: '优势', defaultSource: 'inferred' },
  { path: 'weaknesses', label: '弱点', defaultSource: 'inferred' },
  { path: 'dossierV2.public.birthDate', label: '出生日期', defaultSource: 'inferred' },
  { path: 'dossierV2.public.residence', label: '当前居住地', defaultSource: 'inferred' },
  { path: 'dossierV2.public.bodyFat', label: '体脂率', defaultSource: 'inferred' },
  { path: 'dossierV2.public.measurements', label: '三围', defaultSource: 'inferred' },
  { path: 'dossierV2.public.shoeSize', label: '鞋码', defaultSource: 'inferred' },
  { path: 'dossierV2.public.bodyStats', label: '其他身体记录', defaultSource: 'observed' },
  { path: 'dossierV2.public.clothingStyle', label: '穿衣风格', defaultSource: 'observed' },
  { path: 'dossierV2.public.personalityAndLife', label: '性格与生活', defaultSource: 'inferred' },
  { path: 'dossierV2.private.penis', label: '阴茎', defaultSource: 'inferred' },
  { path: 'dossierV2.private.testiclesAndPubicHair', label: '睾丸、阴囊与体毛', defaultSource: 'inferred' },
  { path: 'dossierV2.private.breastsAndBody', label: '乳房与私密身体', defaultSource: 'inferred' },
  { path: 'dossierV2.private.vulva', label: '外阴', defaultSource: 'inferred' },
  { path: 'dossierV2.private.vagina', label: '阴道', defaultSource: 'inferred' },
  { path: 'dossierV2.private.anus', label: '肛门与会阴', defaultSource: 'inferred' },
  { path: 'dossierV2.private.intimateBody', label: '其他私密身体特征', defaultSource: 'inferred' },
  { path: 'dossierV2.private.sexualResponse', label: '敏感区域与身体反应', defaultSource: 'inferred' },
  { path: 'dossierV2.private.intimacyProfile', label: '亲密偏好与习惯', defaultSource: 'inferred' },
];

function readPath(character: NovelCastCharacter, path: string): string {
  let value: unknown = character;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value.trim() : '';
}

export function buildPortraitFieldProposals(
  current: NovelCastCharacter,
  proposed: NovelCastCharacter,
  evidence: Record<string, PortraitProposalSource | undefined> = {},
  scope?: PortraitProposalScope,
): PortraitFieldProposal[] {
  const scopedFields = scope === 'private'
    ? FIELDS.filter((field) => field.path.startsWith('dossierV2.private.'))
    : scope === 'public'
      ? FIELDS.filter((field) => !field.path.startsWith('dossierV2.private.'))
      : FIELDS;

  return scopedFields.flatMap((field) => {
    const before = readPath(current, field.path);
    const after = readPath(proposed, field.path);
    if (!after || before === after) return [];
    return [{
      path: field.path,
      label: field.label,
      before,
      after,
      source: evidence[field.path] ?? field.defaultSource,
    }];
  });
}

export function applyPortraitFieldProposals(
  current: NovelCastCharacter,
  proposed: NovelCastCharacter,
  selectedPaths: Iterable<string>,
): NovelCastCharacter {
  const selected = new Set(selectedPaths);
  const currentDossier = normalizeCharacterDossierV2(current.dossierV2, current);
  const next: NovelCastCharacter = {
    ...current,
    dossierV2: {
      ...currentDossier,
      public: { ...currentDossier.public },
      private: { ...currentDossier.private },
    },
  };

  for (const field of FIELDS) {
    if (!selected.has(field.path)) continue;
    const value = readPath(proposed, field.path);
    if (!value) continue;
    if (field.path.startsWith('dossierV2.public.')) {
      const key = field.path.slice('dossierV2.public.'.length) as keyof typeof currentDossier.public;
      next.dossierV2!.public[key] = value;
    } else if (field.path.startsWith('dossierV2.private.')) {
      const key = field.path.slice('dossierV2.private.'.length);
      (next.dossierV2!.private as unknown as Record<string, string>)[key] = value;
    } else {
      const key = field.path as keyof NovelCastCharacter;
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }

  const dossierV2 = normalizeCharacterDossierV2(next.dossierV2, next);
  return {
    ...next,
    dossierV2,
    aiSummary: normalizeCharacterAiSummary(undefined, next, dossierV2),
  };
}
