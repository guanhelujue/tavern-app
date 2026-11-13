import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCharacterDossierV2 } from '../features/character-dossier-v2/model';
import type { ApiSettings } from '../types/tavern';

import { analyzeCharacterPortrait } from './character-portrait-analysis';

vi.mock('../utils/novel-images', () => ({
  readNovelImageAsInlineData: vi.fn(async () => ({
    base64: 'ZmFrZQ==',
    dataUri: 'data:image/jpeg;base64,ZmFrZQ==',
    mimeType: 'image/jpeg',
  })),
}));

const apiSettings: ApiSettings = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'vision-test-model',
  providerId: 'openai',
  protocol: 'openai-compatible',
  temperature: 0.4,
  maxTokens: 4096,
  contextWindowMessages: 20,
  streamingEnabled: false,
  requestTimeoutMs: 30_000,
  requestRetryCount: 0,
  debugPromptInspectorEnabled: false,
  replyLengthPreset: 'normal',
  continuationOnTruncation: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('character portrait analysis', () => {
  it('repairs a malformed vision JSON response without sending the image again', async () => {
    const current = {
      id: 'character-repair', name: '', profession: '', gender: '女', age: '22',
      height: '', weight: '', birthplace: '', affiliation: '', appearance: '',
      personality: '', speechStyle: '', background: '', motive: '', strengths: '',
      weaknesses: '', portraitUri: 'file:///portrait.jpg',
      dossierV2: createCharacterDossierV2({ gender: '女' }),
    };
    const repaired = { cast: { name: '林澈', gender: '女', appearance: '短发' }, dossierV2: { version: 2, public: {}, private: null }, aiSummary: { version: 1, privateFacts: [] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"cast":{"name":"林澈"},"dossierV2":{' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(repaired) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeCharacterPortrait({ apiSettings, imageUri: current.portraitUri, current, novelName: '测试小说' });
    expect(result.character.name).toBe('林澈');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.messages[1].content[1].type).toBe('image_url');
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('林澈') }),
    ]));
  });

  it('fills inferred private dossier fields when NSFW mode is enabled', async () => {
    const current = {
      id: 'character-1',
      name: '沈砚舟',
      profession: '',
      gender: '男',
      age: '24',
      height: '',
      weight: '',
      birthplace: '',
      affiliation: '',
      appearance: '',
      personality: '',
      speechStyle: '',
      background: '',
      motive: '',
      strengths: '',
      weaknesses: '',
      portraitUri: 'file:///portrait.jpg',
      dossierV2: createCharacterDossierV2({ gender: '男' }),
    };
    const payload = {
      cast: { name: '沈砚舟', gender: '男', age: '24', profession: '不应写入' },
      dossierV2: {
        version: 2,
        public: { clothingStyle: '不应写入公开档案' },
        private: {
          variant: 'male',
          penis: '模型生成的稳定身体记录',
          testiclesAndPubicHair: '模型生成的整理习惯',
          anus: '模型生成的健康记录',
          intimateBody: '模型生成的私密身体特征',
          sexualResponse: '模型生成的稳定敏感区域',
          intimacyProfile: '模型生成的亲密偏好',
        },
      },
      aiSummary: { version: 1, privateFacts: [] },
      fieldEvidence: { 'dossierV2.private.penis': 'inferred' },
    };
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeCharacterPortrait({
      apiSettings: { ...apiSettings, providerId: 'deepseek', model: 'deepseek-flash' },
      imageUri: current.portraitUri,
      current,
      novelName: '测试小说',
      nsfwEnabled: true,
      nsfwPrompt: 'WRITING_EXTENSION_MUST_NOT_ENTER_PORTRAIT_ANALYSIS',
      target: 'private',
    });

    expect(result.character.dossierV2?.private.variant).toBe('male');
    expect(result.character.dossierV2?.private).toMatchObject({
      penis: '模型生成的稳定身体记录',
      intimacyProfile: '模型生成的亲密偏好',
    });
    expect(result.character.profession).toBe('');
    expect(result.character.dossierV2?.public.clothingStyle).toBe('');
    expect(result.target).toBe('private');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'dossierV2.private.penis', source: 'inferred' }),
      expect.objectContaining({ path: 'dossierV2.private.intimacyProfile', source: 'inferred' }),
    ]));

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe('deepseek-flash');
    expect(requestBody.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,ZmFrZQ==', detail: 'high' },
    });
    expect(requestBody.messages[0].content).toContain('NSFW');
    expect(requestBody.messages[0].content).toContain('dossierV2.private');
    expect(requestBody.messages[0].content).toContain('角色私密档案 · V2 专用规则');
    expect(requestBody.messages[0].content).not.toContain('WRITING_EXTENSION_MUST_NOT_ENTER_PORTRAIT_ANALYSIS');
  });

  it('never fills private fields from a public portrait, even when NSFW mode is enabled', async () => {
    const current = {
      id: 'character-2',
      name: '',
      profession: '',
      gender: '女',
      age: '22',
      height: '',
      weight: '',
      birthplace: '',
      affiliation: '',
      appearance: '',
      personality: '',
      speechStyle: '',
      background: '',
      motive: '',
      strengths: '',
      weaknesses: '',
      portraitUri: 'file:///daily.jpg',
      dossierV2: createCharacterDossierV2({ gender: '女' }),
    };
    const payload = {
      cast: { name: '林澈', gender: '女', age: '22', appearance: '短发，浅色眼睛' },
      dossierV2: {
        version: 2,
        public: { clothingStyle: '日常衬衫与长裤' },
        private: {
          variant: 'female',
          breastsAndBody: '不应从日常照写入',
          vulva: '不应从日常照写入',
          vagina: '不应从日常照写入',
          anus: '不应从日常照写入',
          sexualResponse: '不应从日常照写入',
          intimacyProfile: '不应从日常照写入',
        },
      },
      aiSummary: { version: 1, privateFacts: ['不应写入'] },
      fieldEvidence: {
        appearance: 'observed',
        'dossierV2.private.breastsAndBody': 'inferred',
      },
    };
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 11, completion_tokens: 21 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeCharacterPortrait({
      apiSettings,
      imageUri: current.portraitUri,
      current,
      novelName: '测试小说',
      nsfwEnabled: true,
      target: 'public',
    });

    expect(result.character.name).toBe('林澈');
    expect(result.character.dossierV2?.public.clothingStyle).toBe('日常衬衫与长裤');
    const privateDossier = result.character.dossierV2?.private;
    expect(privateDossier?.variant).toBe('female');
    if (!privateDossier || privateDossier.variant !== 'female') {
      throw new Error('Expected a female private dossier.');
    }
    expect(privateDossier.breastsAndBody).toBe('');
    expect(result.changes.some((change) => change.path.startsWith('dossierV2.private.'))).toBe(false);
    expect(result.target).toBe('public');
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[1].content[0].text).toContain('"private":null');
    expect(requestBody.messages[1].content[0].text).not.toContain('不应从日常照写入');
  });

  it('sends OFF safety settings with a Gemini portrait analysis request', async () => {
    const current = {
      id: 'character-3', name: '', profession: '', gender: '女', age: '22',
      height: '', weight: '', birthplace: '', affiliation: '', appearance: '',
      personality: '', speechStyle: '', background: '', motive: '', strengths: '',
      weaknesses: '', portraitUri: 'file:///portrait.jpg',
      dossierV2: createCharacterDossierV2({ gender: '女' }),
    };
    const payload = { cast: { name: '林澈' }, dossierV2: { version: 2, public: {}, private: null } };
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await analyzeCharacterPortrait({
      apiSettings: {
        ...apiSettings, providerId: 'gemini', protocol: 'google-generate-content',
        baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash',
      },
      imageUri: current.portraitUri, current, novelName: '测试小说',
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.safetySettings).toEqual(expect.arrayContaining([
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
    ]));
    expect(requestBody.safetySettings.every((setting: { threshold: string }) => setting.threshold === 'OFF')).toBe(true);
  });
});
