import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_NSFW_CHARACTER_CREATE_PROMPT } from '../constants/content-scale';
import { createCharacterDossierV2 } from '../features/character-dossier-v2/model';
import type { ApiSettings } from '../types/tavern';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '../utils/novel-player';
import { requestCompletionWithUsage } from './llm';
import { createEmptyCastCharacter, generateNovelCastCharacter } from './novel-create-ai';

vi.mock('./llm', () => ({ requestCompletionWithUsage: vi.fn(), requestPlainCompletion: vi.fn() }));

describe('private dossier creation', () => {
  it('uses the dedicated prompt, fills missing private data and preserves existing values', async () => {
    const current = createEmptyCastCharacter();
    current.name = '林舟';
    current.gender = '男';
    current.age = '25';
    current.dossierV2 = createCharacterDossierV2(current);
    current.dossierV2.private.intimacyProfile = 'AUTHOR_LOCKED_PROFILE';
    vi.mocked(requestCompletionWithUsage).mockResolvedValueOnce({
      content: JSON.stringify({
        cast: { name: '林舟', gender: '男', age: '25' },
        dossierV2: {
          version: 2, public: {}, private: {
            variant: 'male', intimateBody: 'GENERATED_PRIVATE_RECORD', intimacyProfile: 'DO_NOT_OVERWRITE',
          },
        },
      }),
      promptTokens: 10, completionTokens: 20, model: 'mock', finishReason: 'stop',
    });

    const result = await generateNovelCastCharacter({
      apiSettings: { temperature: 0.7 } as ApiSettings,
      novelName: '测试小说', current, nsfwEnabled: true,
      nsfwPrompt: 'WRITING_PROMPT_MUST_NOT_APPLY',
      framework: {
        ...EMPTY_PLAYER_PROFILE_FIELDS,
        playerName: '', playerPersona: '', playerMotive: '',
        worldName: '当代', worldEra: '', worldTone: '', worldConflict: '',
        gameRules: '', mainPlot: '', initialStoryState: '',
      },
    });
    const request = vi.mocked(requestCompletionWithUsage).mock.calls[0]?.[0];
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain(DEFAULT_NSFW_CHARACTER_CREATE_PROMPT);
    expect(prompt).not.toContain('WRITING_PROMPT_MUST_NOT_APPLY');
    expect(result.dossierV2?.private).toMatchObject({
      intimateBody: 'GENERATED_PRIVATE_RECORD', intimacyProfile: 'AUTHOR_LOCKED_PROFILE',
    });
    expect(result.aiSummary?.privateFacts.join('\n')).toContain('GENERATED_PRIVATE_RECORD');
  });
});
