import { describe, expect, it } from 'vitest';

import { createCharacterDossierV2 } from './model';
import {
  buildCharacterAiSummarySourceHash,
  formatCharacterAiSummaryForPrompt,
  normalizeCharacterAiSummary,
} from './ai-summary';

describe('character AI summary', () => {
  it('takes fixed facts from the canonical character and dossier instead of model duplicates', () => {
    const dossier = createCharacterDossierV2({ gender: '男' });
    dossier.public.bodyFat = '12%';
    dossier.public.measurements = '102 / 78 / 96 cm';
    dossier.public.shoeSize = 'EU 44';

    const summary = normalizeCharacterAiSummary(
      {
        fixedFacts: {
          name: '错误姓名',
          height: '170cm',
          weight: '60kg',
          bodyFat: '30%',
          measurements: '错误三围',
          shoeSize: 'EU 39',
        },
      },
      {
        name: '沈砚舟',
        gender: '男',
        age: '20',
        profession: '大学生',
        affiliation: '东川大学田径队',
        height: '188cm',
        weight: '82kg',
      },
      dossier,
    );

    expect(summary.fixedFacts).toEqual({
      name: '沈砚舟',
      gender: '男',
      age: '20',
      profession: '大学生',
      affiliation: '东川大学田径队',
      height: '188cm',
      weight: '82kg',
      bodyFat: '12%',
      measurements: '102 / 78 / 96 cm',
      shoeSize: 'EU 44',
    });
  });

  it('bounds model-authored rules and only injects private facts when requested', () => {
    const dossier = createCharacterDossierV2({ gender: '男' });
    if (dossier.private.variant !== 'male') throw new Error('expected male dossier');
    dossier.private.penis = '私密身体常量';
    const summary = normalizeCharacterAiSummary(
      {
        appearanceAnchors: ['1', '2', '3', '4', '5'],
        clothingAnchors: ['1', '2', '3', '4'],
        personalityCore: ['1', '2', '3', '4', '5'],
        behaviorRules: ['1', '2', '3', '4', '5'],
        speechRules: ['1', '2', '3', '4'],
        relationshipStances: ['1', '2', '3', '4', '5'],
        hardLimits: ['1', '2', '3', '4'],
        privateFacts: ['模型自行编造的私密事实'],
      },
      { name: '沈砚舟', gender: '男' },
      dossier,
    );

    expect(summary.appearanceAnchors).toHaveLength(4);
    expect(summary.clothingAnchors).toHaveLength(3);
    expect(summary.personalityCore).toHaveLength(4);
    expect(summary.behaviorRules).toHaveLength(4);
    expect(summary.speechRules).toHaveLength(3);
    expect(summary.relationshipStances).toHaveLength(4);
    expect(summary.hardLimits).toHaveLength(3);
    expect(summary.privateFacts).toEqual(['阴茎：私密身体常量']);

    const sfwPrompt = formatCharacterAiSummaryForPrompt(summary);
    const nsfwPrompt = formatCharacterAiSummaryForPrompt(summary, { includePrivate: true });
    expect(sfwPrompt).not.toContain('私密常量');
    expect(sfwPrompt).not.toContain('私密身体常量');
    expect(nsfwPrompt).toContain('私密常量：阴茎：私密身体常量');
  });

  it('drops stale semantic anchors after the canonical character changes', () => {
    const dossier = createCharacterDossierV2({ gender: '女' });
    const original = { name: '林照', appearance: '黑色长发', personality: '寡言谨慎' };
    const sourceHash = buildCharacterAiSummarySourceHash(original, dossier);

    const summary = normalizeCharacterAiSummary(
      {
        sourceHash,
        appearanceAnchors: ['黑色长发'],
        personalityCore: ['寡言谨慎'],
        behaviorRules: ['绝不主动求助'],
      },
      { ...original, appearance: '银色短发', personality: '坦率果断' },
      dossier,
    );

    expect(summary.appearanceAnchors).toEqual(['银色短发']);
    expect(summary.personalityCore).toEqual(['坦率果断']);
    expect(summary.behaviorRules).toEqual([]);
    expect(summary.sourceHash).not.toBe(sourceHash);
  });

  it('keeps fresh authored anchors while exact measurements change independently', () => {
    const dossier = createCharacterDossierV2({ gender: '男' });
    const character = { name: '周行', appearance: '短发', height: '180cm' };
    const sourceHash = buildCharacterAiSummarySourceHash(character, dossier);
    const summary = normalizeCharacterAiSummary(
      { sourceHash, behaviorRules: ['遇事先观察出口'] },
      { ...character, height: '182cm' },
      dossier,
    );

    expect(summary.behaviorRules).toEqual(['遇事先观察出口']);
    expect(summary.fixedFacts.height).toBe('182cm');
    expect(summary.sourceHash).toBe(sourceHash);
  });
});
