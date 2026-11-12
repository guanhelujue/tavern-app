import { describe, expect, it } from 'vitest';

import {
  mergeCharacterDossierV2,
  normalizeCharacterDossierV2,
  switchCharacterDossierVariant,
} from './model';

describe('character dossier v2 model', () => {
  it('migrates legacy public and private fields into a male dossier', () => {
    const dossier = normalizeCharacterDossierV2(undefined, {
      gender: '男',
      height: '186cm',
      weight: '80kg',
      personality: '表面随和，实际好胜。',
      speechStyle: '话少，句子短。',
      privacy: {
        genitals: '旧男性私密描述',
        chest: '旧胸部描述',
        erogenousZones: '颈侧敏感',
        scent: '运动后有汗味',
        xp: '经验很少',
        masturbationHabits: '偶尔',
      },
    });

    expect(dossier.public.bodyStats).toBe('');
    expect(dossier.public.personalityAndLife).toContain('表面随和');
    expect(dossier.private.variant).toBe('male');
    if (dossier.private.variant !== 'male') throw new Error('expected male dossier');
    expect(dossier.private.penis).toBe('旧男性私密描述');
    expect(dossier.private.sexualResponse).toContain('颈侧敏感');
  });

  it('preserves intentionally cleared v2 values instead of restoring legacy text', () => {
    const dossier = normalizeCharacterDossierV2(
      {
        version: 2,
        public: {
          birthDate: '',
          residence: '',
          bodyFat: '',
          measurements: '',
          shoeSize: '',
          bodyStats: '',
          clothingStyle: '',
          personalityAndLife: '',
        },
        private: {
          variant: 'male',
          penis: '',
          testiclesAndPubicHair: '',
          anus: '',
          intimateBody: '',
          sexualResponse: '',
          intimacyProfile: '',
        },
      },
      {
        gender: '男',
        height: '190cm',
        privacy: { genitals: '不应恢复' },
      },
    );

    expect(dossier.public.bodyStats).toBe('');
    expect(dossier.private.variant).toBe('male');
    if (dossier.private.variant !== 'male') throw new Error('expected male dossier');
    expect(dossier.private.penis).toBe('');
  });

  it('keeps the separate private image and common intimacy fields when switching card sex', () => {
    const male = normalizeCharacterDossierV2(undefined, { gender: '男' });
    male.private.portraitUri = 'novel-images/private.jpg';
    male.private.sexualResponse = '反应记录';
    male.private.intimacyProfile = '偏好记录';

    const female = switchCharacterDossierVariant(male, 'female');

    expect(female.private.variant).toBe('female');
    expect(female.private.portraitUri).toBe('novel-images/private.jpg');
    expect(female.private.sexualResponse).toBe('反应记录');
    expect(female.private.intimacyProfile).toBe('偏好记录');
  });

  it('fills empty fields without overwriting authored dossier values', () => {
    const current = createDossierForMerge();
    const merged = mergeCharacterDossierV2(
      current,
      {
        version: 2,
        public: {
          birthDate: '2004年3月17日',
          residence: '海州市',
          bodyFat: '18%',
          measurements: '100 / 78 / 96 cm',
          shoeSize: 'EU 44',
          bodyStats: '骨架偏大',
          clothingStyle: '训练时穿运动装',
          personalityAndLife: '自律、好胜',
        },
      },
      { gender: '男' },
    );

    expect(merged.public.bodyFat).toBe('12%');
    expect(merged.public.residence).toBe('海州市');
    expect(merged.public.clothingStyle).toBe('训练时穿运动装');
  });
});

function createDossierForMerge() {
  const dossier = normalizeCharacterDossierV2(undefined, { gender: '男' });
  dossier.public.bodyFat = '12%';
  return dossier;
}
