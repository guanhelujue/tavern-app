import { describe, expect, it } from 'vitest';

import type { NovelCastCharacter } from '@/types/tavern';

import {
  applyPortraitFieldProposals,
  buildPortraitFieldProposals,
} from './portrait-proposal';

function character(patch: Partial<NovelCastCharacter> = {}): NovelCastCharacter {
  return {
    id: 'char-1',
    name: '',
    profession: '',
    age: '',
    gender: '',
    height: '',
    weight: '',
    appearance: '',
    personality: '',
    speechStyle: '',
    background: '',
    ...patch,
  };
}

describe('portrait field proposals', () => {
  it('keeps observed and inferred provenance visible before applying', () => {
    const current = character({ name: '沈砚' });
    const proposed = character({ name: '沈砚', profession: '游泳队员', appearance: '短发，肩背宽阔。' });
    const changes = buildPortraitFieldProposals(current, proposed, {
      appearance: 'observed',
      profession: 'inferred',
    });

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'appearance', source: 'observed' }),
      expect.objectContaining({ path: 'profession', source: 'inferred' }),
    ]));
    expect(changes.some((change) => change.path === 'name')).toBe(false);
  });

  it('applies only selected paths and regenerates the compact AI summary', () => {
    const current = character({ name: '沈砚' });
    const proposed = character({ name: '沈砚', profession: '游泳队员', appearance: '短发，肩背宽阔。' });
    const next = applyPortraitFieldProposals(current, proposed, ['appearance']);

    expect(next.appearance).toBe('短发，肩背宽阔。');
    expect(next.profession).toBe('');
    expect(next.aiSummary?.appearanceAnchors.join('')).toContain('短发');
  });

  it('offers and applies inferred private fields without replacing existing facts', () => {
    const currentDossier = {
      version: 2 as const,
      public: {
        birthDate: '', residence: '', bodyFat: '', measurements: '', shoeSize: '',
        bodyStats: '', clothingStyle: '', personalityAndLife: '',
      },
      private: {
        variant: 'male' as const,
        penis: '作者已填写',
        testiclesAndPubicHair: '',
        anus: '',
        intimateBody: '',
        sexualResponse: '',
        intimacyProfile: '',
      },
    };
    const proposedDossier = {
      ...currentDossier,
      private: {
        ...currentDossier.private,
        penis: '作者已填写',
        intimacyProfile: '模型推演的亲密偏好',
      },
    };
    const current = character({ name: '沈砚', gender: '男', dossierV2: currentDossier });
    const proposed = character({ name: '沈砚', gender: '男', dossierV2: proposedDossier });

    const changes = buildPortraitFieldProposals(current, proposed);
    expect(changes).toEqual([
      expect.objectContaining({
        path: 'dossierV2.private.intimacyProfile',
        source: 'inferred',
      }),
    ]);

    const next = applyPortraitFieldProposals(
      current,
      proposed,
      ['dossierV2.private.intimacyProfile'],
    );
    expect(next.dossierV2?.private).toMatchObject({
      penis: '作者已填写',
      intimacyProfile: '模型推演的亲密偏好',
    });
    expect(next.aiSummary?.privateFacts.length).toBeGreaterThan(0);
  });
});
