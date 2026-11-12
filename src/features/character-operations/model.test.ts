import { describe, expect, it } from 'vitest';

import type { NovelCastCharacter, NovelCharacterDossier } from '@/types/tavern';

import {
  diagnoseCharacterRelations,
  filterCharacterLibrary,
  mergeCastCharacters,
  normalizeCharacterWorkspace,
  setCharacterTags,
} from './model';

function character(id: string, name: string, patch: Partial<NovelCastCharacter> = {}): NovelCastCharacter {
  return {
    id,
    name,
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

function dossier(id: string, castId: string, name: string): NovelCharacterDossier {
  return {
    id,
    castId,
    name,
    aliases: [],
    content: '',
    experience: '',
    experienceDraft: '',
    enabled: true,
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

describe('character operations model', () => {
  it('filters a tagged large library without mutating cards', () => {
    const cast = [
      character('a', '沈砚', { profession: '学生', isProtagonist: true }),
      character('b', '周野', { profession: '篮球队员' }),
    ];
    const workspace = setCharacterTags(normalizeCharacterWorkspace(undefined), ['b'], ['东体', '体育生']);
    const result = filterCharacterLibrary(
      [dossier('da', 'a', '沈砚'), dossier('db', 'b', '周野')],
      cast,
      workspace,
      '东体',
      'supporting',
    );
    expect(result.map((item) => item.castId)).toEqual(['b']);
  });

  it('detects duplicate identities and dangling linked relations', () => {
    const cast = [
      character('a', '沈砚', { aliases: ['阿砚'], relations: [{ id: 'r', targetName: '旧人', targetCastId: 'gone', label: '旧友' }] }),
      character('b', '周野', { aliases: ['阿砚'] }),
    ];
    const issues = diagnoseCharacterRelations(cast, []);
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['identity', 'dangling']));
  });

  it('merges duplicate cards and redirects linked relations', () => {
    const cast = [
      character('a', '沈砚', { aliases: ['阿砚'] }),
      character('b', '沈同学', { profession: '学生' }),
      character('c', '周野', { relations: [{ id: 'r', targetName: '沈同学', targetCastId: 'b', label: '队友' }] }),
    ];
    const merged = mergeCastCharacters(cast, 'a', 'b');
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.id === 'a')?.profession).toBe('学生');
    expect(merged.find((item) => item.id === 'c')?.relations?.[0]).toMatchObject({ targetCastId: 'a', targetName: '沈砚' });
  });
});
