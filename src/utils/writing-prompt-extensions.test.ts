import { describe, expect, it } from 'vitest';

import {
  buildWritingPromptExtensionBlocks,
  DEFAULT_JAILBREAK_PROMPT,
  normalizeWritingPromptExtensions,
} from './writing-prompt-extensions';

describe('writing prompt extensions', () => {
  it.each([
    [false, false, []],
    [true, false, ['【破限词】\nAUTHOR_TEXT']],
    [false, true, ['【MOD】\nMOD_TEXT']],
    [true, true, ['【破限词】\nAUTHOR_TEXT', '【MOD】\nMOD_TEXT']],
  ] as const)('respects independent switches (%s, %s)', (jailbreakEnabled, modEnabled, expected) => {
    expect(buildWritingPromptExtensionBlocks({
      jailbreakEnabled, jailbreakPrompt: 'AUTHOR_TEXT', modEnabled, modPrompt: 'MOD_TEXT',
    })).toEqual(expected);
  });

  it('migrates old custom text and switch without enabling a new MOD', () => {
    const settings = normalizeWritingPromptExtensions({ nsfwEnabled: true, nsfwPrompt: '旧自定义文本' });
    expect(settings).toEqual({
      jailbreakEnabled: true, jailbreakPrompt: '旧自定义文本', modEnabled: false, modPrompt: '',
    });
    expect(normalizeWritingPromptExtensions(settings)).toEqual(settings);
  });

  it('keeps a disabled switch and intentionally empty text across a JSON round trip', () => {
    const settings = normalizeWritingPromptExtensions({
      nsfwEnabled: true, nsfwPrompt: '旧文本',
      jailbreakEnabled: false, jailbreakPrompt: '', modEnabled: true, modPrompt: '   ',
    });
    const restored = normalizeWritingPromptExtensions(JSON.parse(JSON.stringify(settings)));
    expect(restored.jailbreakEnabled).toBe(false);
    expect(restored.jailbreakPrompt).toBe('');
    expect(buildWritingPromptExtensionBlocks(restored)).toEqual([]);
  });

  it('preserves editor whitespace and saved text while disabled', () => {
    const settings = normalizeWritingPromptExtensions({
      jailbreakEnabled: false, jailbreakPrompt: '第一行\n', modEnabled: false, modPrompt: '  MOD\n',
    });
    expect(settings.jailbreakPrompt).toBe('第一行\n');
    expect(settings.modPrompt).toBe('  MOD\n');
    expect(buildWritingPromptExtensionBlocks(settings)).toEqual([]);
  });

  it('uses the previous default text but starts both extensions disabled', () => {
    expect(normalizeWritingPromptExtensions()).toEqual({
      jailbreakEnabled: false, jailbreakPrompt: DEFAULT_JAILBREAK_PROMPT, modEnabled: false, modPrompt: '',
    });
    expect(buildWritingPromptExtensionBlocks()).toEqual([]);
  });
});
