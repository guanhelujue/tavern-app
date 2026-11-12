import { describe, expect, it } from 'vitest';

import { createCharacterDossierV2 } from './model';
import { diagnoseCharacterDossier } from './diagnostics';
import type { NovelCastCharacter } from '@/types/tavern';

function character(overrides: Partial<NovelCastCharacter> = {}): NovelCastCharacter {
  return {
    id: 'char-1',
    name: '周行',
    profession: '调查员',
    age: '26',
    gender: '男',
    height: '182cm',
    weight: '76kg',
    appearance: '短发',
    personality: '谨慎',
    speechStyle: '简短',
    background: '',
    ...overrides,
  };
}

describe('character dossier diagnostics', () => {
  it('finds age conflicts and retrieval-name collisions without changing data', () => {
    const dossier = createCharacterDossierV2({ gender: '男' });
    dossier.public.birthDate = '1990年3月17日';
    const current = character({ aliases: ['周队'] });
    const diagnostics = diagnoseCharacterDossier({
      character: current,
      dossier,
      referenceYear: 2026,
      otherCharacters: [character({ id: 'char-2', name: '林照', aliases: ['周队'] })],
    });

    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['age-birthdate-conflict', 'identity-collision']),
    );
    expect(current.age).toBe('26');
  });

  it('treats unusual fantasy measurements as notices rather than blockers', () => {
    const dossier = createCharacterDossierV2({ gender: '女' });
    const diagnostics = diagnoseCharacterDossier({
      character: character({ gender: '女', height: '310cm' }),
      dossier,
      referenceYear: 2026,
    });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'body-value-unusual',
      severity: 'notice',
    }));
  });

  it('warns about self/duplicate relations and an empty private profile with an image', () => {
    const dossier = createCharacterDossierV2({ gender: '男' });
    dossier.private.portraitUri = 'file://private.jpg';
    const diagnostics = diagnoseCharacterDossier({
      character: character({
        relations: [
          { id: 'r1', targetName: '周行', label: '本人' },
          { id: 'r2', targetName: '林照', label: '同事' },
          { id: 'r3', targetName: '林照', label: '朋友' },
        ],
      }),
      dossier,
    });
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'self-relation',
      'duplicate-relation',
      'private-image-without-profile',
    ]));
  });
});
