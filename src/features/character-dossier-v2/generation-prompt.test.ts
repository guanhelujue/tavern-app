import { describe, expect, it } from 'vitest';
import { DEFAULT_NSFW_CHARACTER_CREATE_PROMPT, DEFAULT_NSFW_PROMPT } from '../../constants/content-scale';

import {
  buildCharacterGenerationSystemPrompt,
  buildSupportingCharacterGenerationSystemPrompt,
} from './generation-prompt';

describe('character dossier v2 generation prompt', () => {
  it('requires the public dossier and compact AI summary instead of legacy privacy JSON', () => {
    const prompt = buildCharacterGenerationSystemPrompt(false);

    expect(prompt).toContain('"cast"');
    expect(prompt).toContain('"aliases"');
    expect(prompt).toContain('"dossierV2"');
    expect(prompt).toContain('"aiSummary"');
    expect(prompt).toContain('最多6个');
    expect(prompt).toContain('"bodyFat"');
    expect(prompt).toContain('"measurements"');
    expect(prompt).toContain('"shoeSize"');
    expect(prompt).not.toContain('"privacy"');
    expect(prompt).toContain('dossierV2.private 必须为 null');
  });

  it('requests a list of complete v2 records for supporting characters', () => {
    const prompt = buildSupportingCharacterGenerationSystemPrompt(true);

    expect(prompt).toContain('只输出一个合法 JSON 数组');
    expect(prompt).toContain('忽略无名路人和已有角色');
    expect(prompt).toContain('"aiSummary"');
    expect(prompt).toContain(DEFAULT_NSFW_CHARACTER_CREATE_PROMPT);
  });

  it('uses the current private field rules independently of writing extensions', () => {
    const prompt = buildCharacterGenerationSystemPrompt(true);
    expect(prompt).toContain(DEFAULT_NSFW_CHARACTER_CREATE_PROMPT);
    expect(prompt).toContain('dossierV2.private');
    for (const field of ['penis', 'testiclesAndPubicHair', 'anus', 'intimateBody',
      'breastsAndBody', 'vulva', 'vagina', 'sexualResponse', 'intimacyProfile']) {
      expect(DEFAULT_NSFW_CHARACTER_CREATE_PROMPT).toContain(field);
    }
    expect(prompt).not.toContain(DEFAULT_NSFW_PROMPT);
  });

});
