import { describe, expect, it } from 'vitest';

import type { NovelCharacterState } from '@/types/tavern';
import { formatCharacterRuntimeStateForPrompt } from './character-prompt-context';

function state(overrides: Partial<NovelCharacterState> = {}): NovelCharacterState {
  return {
    characterId: 'char-1',
    currentState: '左臂受伤，行动受限',
    goal: '在天亮前找到出口',
    motive: '保护同行者',
    speakingStyle: '疼痛时句子更短',
    knows: ['钥匙在守卫身上'],
    unknown: ['同伴已经叛变'],
    atChapter: 12,
    ...overrides,
  };
}

describe('character prompt runtime context', () => {
  it('keeps mutable state and information boundaries explicit', () => {
    const result = formatCharacterRuntimeStateForPrompt(state());

    expect(result).toContain('截至第12章');
    expect(result).toContain('现状：左臂受伤，行动受限');
    expect(result).toContain('当前目标：在天亮前找到出口');
    expect(result).toContain('已知：钥匙在守卫身上');
    expect(result).toContain('未知：同伴已经叛变');
  });

  it('excludes stale state and bounds growing knowledge lists', () => {
    expect(formatCharacterRuntimeStateForPrompt(state({ stale: true }))).toBe('');

    const result = formatCharacterRuntimeStateForPrompt(state({
      knows: Array.from({ length: 10 }, (_, index) => `情报${index + 1}`),
      unknown: [],
    }));
    expect(result).toContain('情报6');
    expect(result).not.toContain('情报7');
  });
});
