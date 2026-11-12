import { describe, expect, it } from 'vitest';

import type { NovelCastCharacter, NovelCharacterRelationship } from '@/types/tavern';

import { resolveEffectiveCharacterRelationships } from './character-relationship-context';

function cast(id: string, name: string, targetId?: string): NovelCastCharacter {
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
    relations: targetId ? [{ id: 'r-1', targetName: '乙', targetCastId: targetId, label: '旧友' }] : undefined,
  };
}

describe('effective character relationships', () => {
  it('lets current story state replace the same directed card relation', () => {
    const characters = [cast('a', '甲', 'b'), cast('b', '乙')];
    const dynamic: NovelCharacterRelationship[] = [{
      id: 'live-1',
      fromCharacter: '甲',
      toCharacter: '乙',
      relation: '决裂',
      description: '不再互相信任',
      atChapter: 12,
    }];

    const resolved = resolveEffectiveCharacterRelationships(characters, dynamic);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.relation).toBe('决裂');
  });

  it('keeps card relations when no newer state exists', () => {
    const resolved = resolveEffectiveCharacterRelationships([cast('a', '甲', 'b'), cast('b', '乙')]);
    expect(resolved[0]).toMatchObject({ fromCharacter: '甲', toCharacter: '乙', relation: '旧友' });
  });
});
